import Anthropic from "@anthropic-ai/sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { Evidence } from "@/types/evidence";
import { emitEvent } from "@/trace/store";
import {
  WEB_LOOKUP_TIMEOUT_MS,
  WEB_LOOKUP_FIRECRAWL_TIMEOUT_MS,
  WEB_LOOKUP_MAX_CONTENT_CHARS,
  WEB_LOOKUP_NATIVE_MAX_CONTENT_CHARS,
  WEB_LOOKUP_MAX_PRESS_SIGNALS,
  MODEL_EXTRACT,
  MODEL_VERIFY,
  MIN_CONTENT_CHARS,
  UNREACHABLE_STATUS_CODES,
  authorityForDomain,
  deriveConfidenceTier,
} from "@/config/runtime";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const WebSignalsSchema = z.object({
  company_name: z.string().nullable(),
  funding_bracket: z
    .enum(["lt_500k", "500k_2m", "2m_10m", "gt_10m"])
    .nullable(),
  employee_count: z.number().nullable(),
  founding_year: z.number().nullable(),
  press_signals: z.array(z.string()),
});

type WebSignals = z.infer<typeof WebSignalsSchema>;

const VerificationSchema = z.object({
  funding_bracket_verified: z.boolean(),
  company_name_verified: z.boolean(),
  verified_field_count: z.number().int().min(0),
  confidence: z.enum(["high", "medium", "low"]),
  rejection_reason: z.string().nullable(),
});

type Verification = z.infer<typeof VerificationSchema>;

// ─── Prompts ──────────────────────────────────────────────────────────────────

const EXTRACT_PROMPT = `Extract company legitimacy signals from this web page content.
Return ONLY a JSON object with these exact fields:
{
  "company_name": "<name or null>",
  "funding_bracket": "<lt_500k|500k_2m|2m_10m|gt_10m|null>",
  "employee_count": <integer or null>,
  "founding_year": <integer or null>,
  "press_signals": ["<coverage mention>", ...]
}

Funding bracket guide:
- lt_500k: bootstrap/pre-seed, <10 employees, no notable external funding
- 500k_2m: seed stage, 10-50 employees, some angel/seed funding mentioned
- 2m_10m: Series A, 50-200 employees, notable VC or grant funding
- gt_10m: Series B+, 200+ employees, major institutional funding
Use null for funding_bracket if content gives no signal either way.
press_signals: list any mentions of press coverage, awards, or notable clients (max 5).`;

// Stable verifier system prompt - cache_control marker set on the system block
// at call site. Today the prompt is too short to actually cache (<2048 tokens
// for Sonnet) but the marker is free and lights up if the prompt grows.
const VERIFY_SYSTEM_PROMPT = `You are a verification agent. Determine whether each extracted signal is actually supported by the source content.

Funding-bracket meanings:
- lt_500k: bootstrap / pre-seed, <10 employees, no notable external funding
- 500k_2m: seed stage, 10-50 employees, angel/seed funding
- 2m_10m: Series A, 50-200 employees, VC or grant funding
- gt_10m: Series B+, 200+ employees, major institutional funding

For each extracted signal, decide whether the page content supports it. Be strict: do not verify a claim unless the content provides direct evidence for it.

Return ONLY this JSON object (no preamble, no commentary):
{
  "funding_bracket_verified": true or false,
  "company_name_verified": true or false,
  "verified_field_count": <integer 0-5 - count of all fields verified, including the two booleans above>,
  "confidence": "high" or "medium" or "low",
  "rejection_reason": "<short explanation if low, else null>"
}

confidence rules:
- "high": funding_bracket verified AND 2+ other fields verified
- "medium": funding_bracket verified OR 2+ other fields verified
- "low": funding_bracket not verified AND fewer than 2 fields verified

If the content is empty, parked, or irrelevant to the company, set confidence: "low" and supply a rejection_reason.`;

function buildVerifyUserMessage(content: string, signals: WebSignals): string {
  return `Page content:
${content}

Extracted signals to verify:
- company_name: ${signals.company_name ?? "null"}
- funding_bracket: ${signals.funding_bracket ?? "null"}
- employee_count: ${signals.employee_count ?? "null"}
- founding_year: ${signals.founding_year ?? "null"}
- press_signals: ${signals.press_signals.join("; ") || "none"}`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Only HTTPS URLs are allowed (got ${parsed.protocol})`);
  }
  const h = parsed.hostname.toLowerCase();
  const blocked = [
    "localhost", "127.", "0.0.0.0", "::1",
    "169.254.", "metadata.google.",
    "10.", "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.", "172.24.",
    "172.25.", "172.26.", "172.27.", "172.28.", "172.29.",
    "172.30.", "172.31.", "192.168.",
    // IPv6-mapped IPv4 and link-local ranges
    "::ffff:127.", "::ffff:10.", "::ffff:192.168.",
    "::ffff:169.254.",
    "::ffff:172.16.", "::ffff:172.17.", "::ffff:172.18.", "::ffff:172.19.",
    "::ffff:172.20.", "::ffff:172.21.", "::ffff:172.22.", "::ffff:172.23.",
    "::ffff:172.24.", "::ffff:172.25.", "::ffff:172.26.", "::ffff:172.27.",
    "::ffff:172.28.", "::ffff:172.29.", "::ffff:172.30.", "::ffff:172.31.",
    "fe80:", "fc00:", "fd",
  ];
  if (blocked.some((b) => h === b.replace(/\.$/, "") || h.startsWith(b))) {
    throw new Error(`URL points to a blocked internal address: ${h}`);
  }
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response");
  }
  return trimmed.slice(start, end + 1);
}

/**
 * Quality-check a fetched page body. A page is "empty" if it's too short,
 * mostly whitespace, or comprises only HTML tags / boilerplate (parked-page
 * heuristic). Used to mark URLs unreachable even on a 200 OK.
 */
function isContentEmpty(text: string): boolean {
  if (!text) return true;
  if (text.length < MIN_CONTENT_CHARS) return true;
  const whitespaceRatio = (text.match(/\s/g)?.length ?? 0) / text.length;
  if (whitespaceRatio > 0.9) return true;
  // 90%+ tag-like content (after stripHtml this means heavy markup leftovers)
  const nonAlpha = text.replace(/[A-Za-z0-9]/g, "");
  if (nonAlpha.length / text.length > 0.9) return true;
  return false;
}

// Authority is delegated to runtime.ts (configurable whitelists).
function getAuthorityLevel(url: string): "high" | "medium" | "low" {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return authorityForDomain(hostname);
  } catch {
    return "low";
  }
}

// ─── Fetch layer (Firecrawl → native) ────────────────────────────────────────

interface FetchResult {
  text: string;
  resolvedUrl: string;
  statusCode: number | null;
  unreachable: boolean;
  via: "firecrawl" | "native";
}

async function fetchWithFirecrawl(
  url: string,
  runId: string
): Promise<FetchResult | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;

  emitEvent({
    run_id: runId,
    agent: "researcher.web_lookup",
    kind: "tool_call",
    message: `Fetching ${url} via Firecrawl`,
    data: { url, fetcher: "firecrawl" },
  });

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(WEB_LOOKUP_FIRECRAWL_TIMEOUT_MS),
    });
    if (!response.ok) {
      emitEvent({
        run_id: runId,
        agent: "researcher.web_lookup",
        kind: "tool_result",
        message: `Firecrawl returned ${response.status}`,
        data: { url, fetcher: "firecrawl", http_status: response.status, ok: false },
      });
      return null;
    }
    const data = (await response.json()) as {
      success: boolean;
      data?: { markdown?: string };
    };
    const markdown =
      data.success && data.data?.markdown
        ? data.data.markdown.slice(0, WEB_LOOKUP_MAX_CONTENT_CHARS)
        : null;

    if (!markdown) {
      emitEvent({
        run_id: runId,
        agent: "researcher.web_lookup",
        kind: "tool_result",
        message: "Firecrawl returned empty content",
        data: { url, fetcher: "firecrawl", http_status: response.status, content_length: 0 },
      });
      return null;
    }

    const unreachable = isContentEmpty(markdown);
    emitEvent({
      run_id: runId,
      agent: "researcher.web_lookup",
      kind: "tool_result",
      message: `Firecrawl fetched ${markdown.length} chars`,
      data: {
        url,
        fetcher: "firecrawl",
        http_status: response.status,
        content_length: markdown.length,
        unreachable,
      },
    });

    return {
      text: markdown,
      resolvedUrl: url,
      statusCode: response.status,
      unreachable,
      via: "firecrawl",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitEvent({
      run_id: runId,
      agent: "researcher.web_lookup",
      kind: "error",
      message: `Firecrawl fetch failed: ${message}`,
      data: { url, fetcher: "firecrawl" },
      error: message,
    });
    return null;
  }
}

async function fetchNative(url: string, runId: string): Promise<FetchResult> {
  emitEvent({
    run_id: runId,
    agent: "researcher.web_lookup",
    kind: "tool_call",
    message: `Fetching ${url} natively`,
    data: { url, fetcher: "native" },
  });

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; zk-hires/1.0; credential-verification)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS),
    });
    const html = await res.text();
    const text = stripHtml(html).slice(0, WEB_LOOKUP_NATIVE_MAX_CONTENT_CHARS);
    const unreachable =
      !res.ok ||
      UNREACHABLE_STATUS_CODES.includes(res.status) ||
      isContentEmpty(text);

    emitEvent({
      run_id: runId,
      agent: "researcher.web_lookup",
      kind: "tool_result",
      message: `Native fetch returned ${res.status}, ${text.length} chars`,
      data: {
        url,
        fetcher: "native",
        http_status: res.status,
        content_length: text.length,
        unreachable,
        ok: res.ok,
      },
    });

    return {
      text,
      resolvedUrl: res.url ?? url,
      statusCode: res.status,
      unreachable,
      via: "native",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitEvent({
      run_id: runId,
      agent: "researcher.web_lookup",
      kind: "error",
      message: `Native fetch failed: ${message}`,
      data: { url, fetcher: "native" },
      error: message,
    });
    return {
      text: `URL: ${url} (fetch failed or timed out)`,
      resolvedUrl: url,
      statusCode: null,
      unreachable: true,
      via: "native",
    };
  }
}

// Twitter/X syndication endpoint - the same path react-tweet uses to render
// embedded tweets without auth. Returns structured JSON with the full tweet
// text, author name/handle, and timestamp. Far more reliable than scraping
// x.com's JS-disabled bot wall (which yields ~493 chars of error page).
function tweetIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("twitter.com") && !host.includes("x.com")) return null;
    const m = parsed.pathname.match(/\/status\/(\d{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function syndicationToken(id: string): string {
  // Algorithm lifted from X's own embed widget (and react-tweet).
  // Deterministic hash keyed off the numeric tweet id.
  return ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, "");
}

async function fetchWithSyndication(
  url: string,
  runId: string
): Promise<FetchResult | null> {
  const id = tweetIdFromUrl(url);
  if (!id) return null;
  const token = syndicationToken(id);
  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`;

  emitEvent({
    run_id: runId,
    agent: "researcher.web_lookup",
    kind: "tool_call",
    message: `Fetching tweet ${id} via syndication`,
    data: { url, fetcher: "syndication", tweet_id: id },
  });

  try {
    const res = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(WEB_LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) {
      emitEvent({
        run_id: runId,
        agent: "researcher.web_lookup",
        kind: "tool_result",
        message: `Syndication returned ${res.status}`,
        data: { url, fetcher: "syndication", http_status: res.status, ok: false },
      });
      return null;
    }
    const data = (await res.json()) as {
      text?: string;
      full_text?: string;
      user?: { name?: string; screen_name?: string };
      created_at?: string;
    };
    const tweetText = data.full_text ?? data.text ?? "";
    if (!tweetText) {
      emitEvent({
        run_id: runId,
        agent: "researcher.web_lookup",
        kind: "tool_result",
        message: "Syndication returned no tweet text",
        data: { url, fetcher: "syndication", http_status: res.status },
      });
      return null;
    }
    const author = data.user?.name ?? "unknown";
    const handle = data.user?.screen_name ?? "unknown";
    const composed = [
      `Tweet by ${author} (@${handle})`,
      data.created_at ? `Posted: ${data.created_at}` : null,
      "",
      tweetText,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, WEB_LOOKUP_MAX_CONTENT_CHARS);

    emitEvent({
      run_id: runId,
      agent: "researcher.web_lookup",
      kind: "tool_result",
      message: `Syndication fetched tweet (${composed.length} chars)`,
      data: {
        url,
        fetcher: "syndication",
        http_status: res.status,
        content_length: composed.length,
        author_handle: handle,
      },
    });

    return {
      text: composed,
      resolvedUrl: url,
      statusCode: res.status,
      unreachable: false,
      via: "native",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitEvent({
      run_id: runId,
      agent: "researcher.web_lookup",
      kind: "error",
      message: `Syndication fetch failed: ${message}`,
      data: { url, fetcher: "syndication" },
      error: message,
    });
    return null;
  }
}

async function fetchPageContent(url: string, runId: string): Promise<FetchResult> {
  assertSafeUrl(url);
  const fc = await fetchWithFirecrawl(url, runId);
  if (fc) return fc;
  // Twitter/X-only path: official syndication endpoint before falling back to
  // native fetch (which gets a JS-disabled bot wall on x.com).
  const syn = await fetchWithSyndication(url, runId);
  if (syn) return syn;
  return fetchNative(url, runId);
}

// ─── Claude passes ────────────────────────────────────────────────────────────

async function extractSignals(
  client: Anthropic,
  content: string,
  runId: string
): Promise<WebSignals> {
  emitEvent({
    run_id: runId,
    agent: "researcher.web_lookup",
    kind: "tool_call",
    message: `Extracting signals via ${MODEL_EXTRACT}`,
    data: { model: MODEL_EXTRACT, content_length: content.length },
  });

  const msg = await client.messages.create({
    model: MODEL_EXTRACT,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: EXTRACT_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: `Page content:\n${content}` }],
  });
  const block = msg.content.find((b) => b.type === "text");
  const text = (block && "text" in block ? block.text : "").trim();
  const parsed = WebSignalsSchema.parse(JSON.parse(extractJsonObject(text)));

  emitEvent({
    run_id: runId,
    agent: "researcher.web_lookup",
    kind: "tool_result",
    message: "Signal extraction complete",
    data: {
      model: MODEL_EXTRACT,
      company_name: parsed.company_name,
      funding_bracket: parsed.funding_bracket,
      press_signal_count: parsed.press_signals.length,
    },
  });

  return parsed;
}

// Barcelona pattern: second-pass Sonnet verifies Haiku's extractions against raw content.
async function verifySignals(
  client: Anthropic,
  content: string,
  signals: WebSignals,
  runId: string
): Promise<Verification> {
  emitEvent({
    run_id: runId,
    agent: "researcher.web_lookup",
    kind: "tool_call",
    message: `Verifying signals via ${MODEL_VERIFY}`,
    data: { model: MODEL_VERIFY },
  });

  // Stream the verifier so the dashboard can render reasoning live instead
  // of staring at a spinner for ~5-8 seconds. Throttled at ~250ms per chunk
  // to keep the SSE stream responsive without flooding it.
  const stream = client.messages.stream({
    model: MODEL_VERIFY,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: VERIFY_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: buildVerifyUserMessage(content, signals) },
    ],
  });

  let buffered = "";
  let lastEmit = 0;
  const THROTTLE_MS = 250;
  stream.on("text", (delta) => {
    buffered += delta;
    const now = Date.now();
    if (now - lastEmit >= THROTTLE_MS) {
      lastEmit = now;
      emitEvent({
        run_id: runId,
        agent: "researcher.web_lookup",
        kind: "tool_result",
        message: "Verifier streaming",
        data: {
          model: MODEL_VERIFY,
          streaming: true,
          partial_text: buffered.slice(-400),
          chars_so_far: buffered.length,
        },
      });
    }
  });

  const final = await stream.finalMessage();
  const block = final.content.find((b) => b.type === "text");
  const text = (block && "text" in block ? block.text : "").trim();
  const parsed = VerificationSchema.parse(JSON.parse(extractJsonObject(text)));

  emitEvent({
    run_id: runId,
    agent: "researcher.web_lookup",
    kind: "tool_result",
    message: `Verification confidence: ${parsed.confidence}`,
    data: {
      model: MODEL_VERIFY,
      streaming: false,
      confidence: parsed.confidence,
      verified_field_count: parsed.verified_field_count,
      rejection_reason: parsed.rejection_reason,
      cache_read_input_tokens: final.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: final.usage.cache_creation_input_tokens ?? 0,
      input_tokens: final.usage.input_tokens,
      output_tokens: final.usage.output_tokens,
    },
  });

  return parsed;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function webLookup(url: string, runId: string): Promise<Evidence> {
  const fetchResult = await fetchPageContent(url, runId);
  const { text: pageText, resolvedUrl, statusCode, unreachable, via } = fetchResult;
  const rawArtifactHash = toHex(sha256(utf8ToBytes(pageText)));
  const authority = getAuthorityLevel(url);
  const evidenceId = randomUUID();

  // Link-quality short-circuit: a dead/parked URL deserves a low-confidence
  // record that the Reviewer can categorise correctly. Skip Claude entirely.
  if (unreachable) {
    emitEvent({
      run_id: runId,
      agent: "researcher.web_lookup",
      kind: "decision",
      message: `URL unreachable (status ${statusCode ?? "n/a"}, ${pageText.length} chars) - skipping verification`,
      data: {
        url,
        http_status: statusCode,
        content_length: pageText.length,
        unreachable: true,
        confidence_tier: "low",
        evidence_id: evidenceId,
      },
      evidence_ids: [evidenceId],
    });

    const matchedDataPoints: string[] = [
      `unreachable:true`,
      `http_status:${statusCode ?? "null"}`,
      `content_length:${pageText.length}`,
      `authority:${authority}`,
      `fetcher:${via}`,
    ];

    return {
      id: evidenceId,
      run_id: runId,
      source: "web_lookup",
      source_url: resolvedUrl,
      retrieved_at: new Date().toISOString(),
      raw_artifact_hash: rawArtifactHash,
      matched_data_points: matchedDataPoints,
      signal_type: "funding_round",
      organizer_profile: null,
      reputability_score: null,
      confidence_tier: "low",
    };
  }

  const client = new Anthropic();

  let signals: WebSignals = {
    company_name: null,
    funding_bracket: null,
    employee_count: null,
    founding_year: null,
    press_signals: [],
  };

  let verification: Verification = {
    funding_bracket_verified: false,
    company_name_verified: false,
    verified_field_count: 0,
    confidence: "low",
    rejection_reason: "Extraction failed",
  };

  try {
    signals = await extractSignals(client, pageText, runId);
    verification = await verifySignals(client, pageText, signals, runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitEvent({
      run_id: runId,
      agent: "researcher.web_lookup",
      kind: "error",
      message: `Claude extract/verify failed: ${message}`,
      data: { url },
      error: message,
    });
    // Non-fatal: emit low-confidence record so the Reviewer emits an explanatory Gap.
  }

  // Detect "extraction returned nothing useful" - the page was reachable
  // but no company signals were extractable. This is distinct from
  // "extracted lt_500k bracket" (a real, low signal). Don't fall back to
  // a fake bracket here - leave it null so the Reviewer can route to
  // category=irrelevant_content instead of category=insufficient_evidence.
  const noSignalsAtAll =
    signals.company_name === null &&
    signals.funding_bracket === null &&
    signals.employee_count === null &&
    signals.founding_year === null &&
    signals.press_signals.length === 0;

  const matchedDataPoints: string[] = [];
  if (signals.funding_bracket) {
    matchedDataPoints.push(`funding_bracket:${signals.funding_bracket}`);
  }
  if (signals.company_name) matchedDataPoints.push(`company_name:${signals.company_name}`);
  if (signals.employee_count !== null) matchedDataPoints.push(`employee_count:${signals.employee_count}`);
  if (signals.founding_year !== null) matchedDataPoints.push(`founding_year:${signals.founding_year}`);
  for (const sig of signals.press_signals.slice(0, WEB_LOOKUP_MAX_PRESS_SIGNALS)) {
    matchedDataPoints.push(`press:${sig}`);
  }
  matchedDataPoints.push(`authority:${authority}`);
  matchedDataPoints.push(`verified_field_count:${verification.verified_field_count}`);
  matchedDataPoints.push(`unreachable:false`);
  matchedDataPoints.push(`http_status:${statusCode ?? "null"}`);
  matchedDataPoints.push(`content_length:${pageText.length}`);
  matchedDataPoints.push(`fetcher:${via}`);
  if (noSignalsAtAll) {
    matchedDataPoints.push(`no_company_signals`);
  }
  if (verification.rejection_reason) {
    // Both prefixes - claim-derivation reads `rejection_reason:` for the
    // irrelevant-content gate; the verifier-specific `verification_rejection:`
    // is kept for the audit trail and downstream consumers.
    matchedDataPoints.push(`rejection_reason:${verification.rejection_reason}`);
    matchedDataPoints.push(`verification_rejection:${verification.rejection_reason}`);
  }

  const tier = deriveConfidenceTier(verification.confidence, authority);

  emitEvent({
    run_id: runId,
    agent: "researcher.web_lookup",
    kind: "decision",
    message: `web_lookup confidence: ${tier} (verification=${verification.confidence}, authority=${authority})`,
    data: {
      url,
      verification_confidence: verification.confidence,
      authority,
      confidence_tier: tier,
      evidence_id: evidenceId,
    },
    evidence_ids: [evidenceId],
  });

  return {
    id: evidenceId,
    run_id: runId,
    source: "web_lookup",
    source_url: resolvedUrl,
    retrieved_at: new Date().toISOString(),
    raw_artifact_hash: rawArtifactHash,
    matched_data_points: matchedDataPoints,
    signal_type: "funding_round",
    organizer_profile: null,
    reputability_score: null,
    confidence_tier: tier,
  };
}
