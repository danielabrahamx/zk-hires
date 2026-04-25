import Anthropic from "@anthropic-ai/sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { Evidence } from "@/types/evidence";

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

const EXTRACT_PROMPT = `Extract company legitimacy signals from this web page content.
Return ONLY a JSON object with these exact fields:
{
  "company_name": "<name or null>",
  "funding_bracket": "<lt_500k|500k_2m|2m_10m|gt_10m|null>",
  "employee_count": <integer or null>,
  "founding_year": <integer or null>,
  "press_signals": ["<coverage mention>", ...]
}

Funding bracket guide — estimate from any size or funding signals in the page:
- lt_500k: bootstrap/pre-seed, <10 employees, no notable external funding
- 500k_2m: seed stage, 10-50 employees, some angel/seed funding mentioned
- 2m_10m: Series A territory, 50-200 employees, notable VC or grant funding
- gt_10m: Series B+, 200+ employees, major institutional funding
Use null for funding_bracket if content gives no signal either way.
press_signals: list any mentions of press coverage, awards, or notable clients (max 5).`;

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

export async function webLookup(url: string, runId: string): Promise<Evidence> {
  let pageText = "";
  let resolvedUrl = url;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; zk-hires/1.0; credential-verification)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15_000),
    });
    resolvedUrl = response.url ?? url;
    const html = await response.text();
    pageText = stripHtml(html).slice(0, 8_000);
  } catch {
    // Fetch failed or timed out - proceed with empty content so Claude
    // can still emit a low-confidence evidence record.
    pageText = `URL: ${url} (fetch failed or timed out)`;
  }

  const rawArtifactHash = toHex(sha256(utf8ToBytes(pageText)));

  let signals: WebSignals = {
    company_name: null,
    funding_bracket: null,
    employee_count: null,
    founding_year: null,
    press_signals: [],
  };

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `${EXTRACT_PROMPT}\n\nPage content:\n${pageText}`,
        },
      ],
    });
    const textBlock = msg.content.find((b) => b.type === "text");
    const text = (
      textBlock && "text" in textBlock ? textBlock.text : ""
    ).trim();
    signals = WebSignalsSchema.parse(JSON.parse(extractJsonObject(text)));
  } catch {
    // Extraction failure is non-fatal: emit a low-confidence record so the
    // reviewer can emit a Gap with a clear explanation.
  }

  const bracket = signals.funding_bracket ?? "lt_500k";
  const matchedDataPoints: string[] = [`funding_bracket:${bracket}`];
  if (signals.company_name)
    matchedDataPoints.push(`company_name:${signals.company_name}`);
  if (signals.employee_count !== null)
    matchedDataPoints.push(`employee_count:${signals.employee_count}`);
  if (signals.founding_year !== null)
    matchedDataPoints.push(`founding_year:${signals.founding_year}`);
  for (const sig of signals.press_signals.slice(0, 5)) {
    matchedDataPoints.push(`press:${sig}`);
  }

  const evidence: Evidence = {
    id: randomUUID(),
    run_id: runId,
    source: "web_lookup",
    source_url: resolvedUrl,
    retrieved_at: new Date().toISOString(),
    raw_artifact_hash: rawArtifactHash,
    matched_data_points: matchedDataPoints,
    signal_type: "funding_round",
    organizer_profile: null,
    reputability_score: null,
    confidence_tier: signals.funding_bracket !== null ? "medium" : "low",
  };

  return evidence;
}
