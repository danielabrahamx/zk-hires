import Anthropic from "@anthropic-ai/sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { Evidence } from "@/types/evidence";
import { MODEL_EXTRACT, MODEL_VERIFY } from "@/config/runtime";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const WinSignalsSchema = z.object({
  event_name: z.string().nullable(),
  organizer_name: z.string().nullable(),
  winner_name: z.string().nullable(),
  year: z.number().int().nullable(),
  is_win_announcement: z.boolean(),
});

type WinSignals = z.infer<typeof WinSignalsSchema>;

const WinVerificationSchema = z.object({
  is_win_announcement_verified: z.boolean(),
  winner_name_verified: z.boolean(),
  event_name_verified: z.boolean(),
  verified_field_count: z.number().int().min(0),
  confidence: z.enum(["high", "medium", "low"]),
  rejection_reason: z.string().nullable(),
});

type WinVerification = z.infer<typeof WinVerificationSchema>;

// ─── Prompts ──────────────────────────────────────────────────────────────────

const EXTRACT_PROMPT = `Extract hackathon win signals from this web page or social post content.
Return ONLY a JSON object with these exact fields:
{
  "event_name": "<hackathon or competition name, or null>",
  "organizer_name": "<organization that ran the event, or null>",
  "winner_name": "<name of the winner/person who placed, or null>",
  "year": <4-digit year as integer, or null>,
  "is_win_announcement": <true if this content announces or confirms a hackathon/competition win, else false>
}

is_win_announcement should be true only if the content explicitly states someone won, placed, or was awarded in a competition.
Set all string fields to null if the content is not a win announcement.`;

// Stable verifier system prompt — cached when length permits.
const VERIFY_SYSTEM_PROMPT = `You are a verification agent. Determine whether the extracted win signals are actually supported by the source content.

Be strict: only verify a field if the page content provides direct evidence.

Return ONLY this JSON object (no preamble):
{
  "is_win_announcement_verified": true or false,
  "winner_name_verified": true or false,
  "event_name_verified": true or false,
  "verified_field_count": <integer 0-4>,
  "confidence": "high" or "medium" or "low",
  "rejection_reason": "<short explanation if low, else null>"
}

confidence rules:
- "high": is_win_announcement verified AND event_name verified AND winner_name verified
- "medium": is_win_announcement verified AND (event_name OR winner_name verified)
- "low": is_win_announcement not verified OR neither event_name nor winner_name verified

If the content is empty or irrelevant, set confidence: "low" with a rejection_reason.`;

function buildVerifyUserMessage(content: string, signals: WinSignals): string {
  return `Page content:
${content}

Extracted signals to verify:
- event_name: ${signals.event_name ?? "null"}
- organizer_name: ${signals.organizer_name ?? "null"}
- winner_name: ${signals.winner_name ?? "null"}
- year: ${signals.year ?? "null"}
- is_win_announcement: ${signals.is_win_announcement}`;
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

// Social platforms are high authority — public posts with identity backing are harder to fake.
function getSourceAndAuthority(url: string): {
  source: Evidence["source"];
  authority: "high" | "medium" | "low";
} {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("linkedin.com")) return { source: "linkedin", authority: "high" };
    if (hostname.includes("twitter.com") || hostname.includes("x.com"))
      return { source: "x", authority: "high" };
    const knownPress = [
      "techcrunch.com", "devpost.com", "hackernews", "medium.com",
      "github.com", "dev.to", "indiehackers.com",
    ];
    if (knownPress.some((h) => hostname.includes(h))) return { source: "web_lookup", authority: "medium" };
    return { source: "web_lookup", authority: "low" };
  } catch {
    return { source: "web_lookup", authority: "low" };
  }
}

// ─── Fetch layer (Firecrawl → native) ────────────────────────────────────────

async function fetchWithFirecrawl(url: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      success: boolean;
      data?: { markdown?: string };
    };
    return data.success && data.data?.markdown
      ? data.data.markdown.slice(0, 10_000)
      : null;
  } catch {
    return null;
  }
}

// Twitter/X oEmbed fallback. Free, no auth, returns the rendered tweet HTML
// including author handle and tweet text. Reliable for x.com / twitter.com
// where native fetch hits a JS shell or bot wall.
async function fetchWithOEmbed(url: string): Promise<string | null> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!hostname.includes("twitter.com") && !hostname.includes("x.com")) return null;
  try {
    const res = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { html?: string; author_name?: string };
    const text = stripHtml(data.html ?? "");
    if (text.length < 20) return null;
    return `Author: ${data.author_name ?? "unknown"}\n\n${text}`;
  } catch {
    return null;
  }
}

async function fetchPageContent(url: string): Promise<{ text: string; resolvedUrl: string }> {
  assertSafeUrl(url);
  const md = await fetchWithFirecrawl(url);
  if (md) return { text: md, resolvedUrl: url };
  const oembed = await fetchWithOEmbed(url);
  if (oembed) return { text: oembed, resolvedUrl: url };
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; zk-hires/1.0; credential-verification)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    return { text: stripHtml(html).slice(0, 8_000), resolvedUrl: res.url ?? url };
  } catch {
    return { text: `URL: ${url} (fetch failed or timed out)`, resolvedUrl: url };
  }
}

// ─── Claude passes ────────────────────────────────────────────────────────────

async function extractSignals(client: Anthropic, content: string): Promise<WinSignals> {
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
    messages: [{ role: "user", content: `Content:\n${content}` }],
  });
  const block = msg.content.find((b) => b.type === "text");
  const text = (block && "text" in block ? block.text : "").trim();
  return WinSignalsSchema.parse(JSON.parse(extractJsonObject(text)));
}

// Barcelona pattern: Sonnet verifies Haiku's extractions against raw content.
async function verifySignals(
  client: Anthropic,
  content: string,
  signals: WinSignals
): Promise<WinVerification> {
  const msg = await client.messages.create({
    model: MODEL_VERIFY,
    max_tokens: 512,
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
  const block = msg.content.find((b) => b.type === "text");
  const text = (block && "text" in block ? block.text : "").trim();
  return WinVerificationSchema.parse(JSON.parse(extractJsonObject(text)));
}

// ─── Confidence derivation ────────────────────────────────────────────────────

function deriveConfidenceTier(
  verification: WinVerification,
  authority: "high" | "medium" | "low"
): Evidence["confidence_tier"] {
  if (verification.confidence === "high" && authority === "high") return "very_high";
  if (verification.confidence === "high") return "high";
  if (verification.confidence === "medium" && authority === "high") return "high";
  if (verification.confidence === "medium") return "medium";
  return "low";
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function winAnnouncementLookup(url: string, runId: string): Promise<Evidence> {
  const { text: pageText, resolvedUrl } = await fetchPageContent(url);
  const rawArtifactHash = toHex(sha256(utf8ToBytes(pageText)));
  const { source, authority } = getSourceAndAuthority(url);
  const client = new Anthropic();

  let signals: WinSignals = {
    event_name: null,
    organizer_name: null,
    winner_name: null,
    year: null,
    is_win_announcement: false,
  };

  let verification: WinVerification = {
    is_win_announcement_verified: false,
    winner_name_verified: false,
    event_name_verified: false,
    verified_field_count: 0,
    confidence: "low",
    rejection_reason: "Extraction failed",
  };

  try {
    signals = await extractSignals(client, pageText);
    verification = await verifySignals(client, pageText, signals);
  } catch {
    // Non-fatal: emit low-confidence record so Reviewer emits an explanatory Gap.
  }

  const matchedDataPoints: string[] = [];
  if (signals.event_name) matchedDataPoints.push(`event_name:${signals.event_name}`);
  if (signals.organizer_name) matchedDataPoints.push(`organizer_name:${signals.organizer_name}`);
  if (signals.winner_name) matchedDataPoints.push(`winner_name:${signals.winner_name}`);
  if (signals.year !== null) matchedDataPoints.push(`year:${signals.year}`);
  matchedDataPoints.push(`is_win_announcement:${signals.is_win_announcement}`);
  matchedDataPoints.push(`authority:${authority}`);
  matchedDataPoints.push(`verified_field_count:${verification.verified_field_count}`);
  if (verification.rejection_reason) {
    matchedDataPoints.push(`verification_rejection:${verification.rejection_reason}`);
  }

  return {
    id: randomUUID(),
    run_id: runId,
    source,
    source_url: resolvedUrl,
    retrieved_at: new Date().toISOString(),
    raw_artifact_hash: rawArtifactHash,
    matched_data_points: matchedDataPoints,
    signal_type: "win_announcement",
    organizer_profile: null,
    reputability_score: null,
    confidence_tier: deriveConfidenceTier(verification, authority),
    notes: signals.organizer_name ?? undefined,
  };
}
