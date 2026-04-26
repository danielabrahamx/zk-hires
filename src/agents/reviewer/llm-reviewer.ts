import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";

import { emitEvent } from "@/trace/store";
import type { Evidence } from "@/types/evidence";
import {
  HackathonWinsFindingSchema,
  ReputableCompanyFindingSchema,
} from "@/types/finding";
import type { Finding } from "@/types/finding";
import { GapSchema } from "@/types/gap";
import type { Gap } from "@/types/gap";
import { MODEL_REVIEWER } from "@/config/runtime";

/**
 * LLM Reviewer — replaces the deterministic claim-derivation + grounded-reasoning pipeline.
 *
 * Claude (Opus) receives the full evidence bag as document blocks via the
 * Citations API, reasons through the due-diligence process live (streaming to
 * the dashboard), then calls one of three finalization tools to emit a
 * structured Finding or Gap. The reasoning text and citations are visible in
 * the trace timeline before the proof button appears.
 */

export type ReviewerFlow = "candidate" | "employer";

export interface ReviewerResult {
  findings: Finding[];
  gaps: Gap[];
}

// ─── Evidence → Document block ────────────────────────────────────────────────

function evidenceToDocument(ev: Evidence): { title: string; text: string } {
  const lines: string[] = [
    `SOURCE: ${ev.source}`,
    `CONFIDENCE: ${ev.confidence_tier}`,
    `SIGNAL TYPE: ${ev.signal_type}`,
    `URL: ${ev.source_url ?? "—"}`,
    `RETRIEVED: ${ev.retrieved_at}`,
    "",
    "MATCHED DATA POINTS:",
    ...ev.matched_data_points.map((d) => `  • ${d}`),
  ];

  if (ev.organizer_profile) {
    const p = ev.organizer_profile;
    lines.push(
      "",
      "ORGANIZER PROFILE:",
      `  handle: ${p.handle}`,
      `  platform: ${p.platform}`,
      `  followers: ${p.follower_count ?? "unknown"}`,
      `  account_age_months: ${p.account_age_months ?? "unknown"}`,
      `  cross_platform_handles: ${p.cross_platform_handles.join(", ") || "none"}`,
      `  third_party_coverage_urls: ${p.third_party_coverage_urls.length} found`,
    );
  }

  let title = ev.source as string;
  if (ev.source_url) {
    try {
      title = `${ev.source}: ${new URL(ev.source_url).hostname}`;
    } catch {
      /* leave title as bare source */
    }
  }

  return { title, text: lines.join("\n") };
}

// ─── System prompts ───────────────────────────────────────────────────────────

const CANDIDATE_SYSTEM = `You are a senior due diligence reviewer for a zero-knowledge credential system. Your task is to assess whether the provided evidence is sufficient to issue a verified hackathon wins credential to a candidate.

## Your Job

Examine the evidence documents carefully, then make a final determination by calling one of the provided tools.

## Evidence Assessment Guide

### What makes strong evidence

**Certificate** (source: certificate)
- Must have organizer_name, event_name, candidate_name, year extracted
- Higher confidence_tier (high/very_high) means the document was verified by the OCR pipeline
- Matched data points show what was extracted

**Win Announcement** (source: web_lookup, x, linkedin)
- Posts on LinkedIn or X from the candidate or organizer announcing a win, prize, or builder award
- "is_win_announcement:true" in matched_data_points is a strong positive signal
- Organizers often post builder spotlights ("Great work @handle, here's $1,000") — these ARE win announcements even without the word "winner"
- If an established organizer account (high authority) mentions a prize amount tied to a project or person, treat that as sufficient evidence of a win
- authority level (high for LinkedIn/X, medium for press, low for unknown)

**Organizer Profile** (in certificate evidence)
- follower_count > 10,000 and account_age_months > 12 → established organizer
- third_party_coverage_urls → external validation the organizer is real

**Tweet Author X Profile** (organizer_profile populated on win_announcement evidence)
- The candidate may submit only a tweet URL (no certificate). The tweet author's X profile is verified by the verify_tweet_author tool and attached to the win_announcement Evidence.
- follower_count > 1000 AND account_age_months > 12 → established account, strong legitimacy signal
- follower_count > 100 AND account_age_months > 6 → plausible, moderate signal
- follower_count < 50 OR account_age_months < 3 → suspicious, treat as low confidence
- All-null profile fields (Firecrawl unavailable or account suspended) → cannot verify the author; do not block on this alone if the tweet content itself is strong, but lower confidence accordingly

### Confidence Tiers (you must choose high or very_high for a Finding)

- **very_high**: Certificate from verified organizer (strong profile) + win announcement from trusted source; OR tweet win announcement from established X author (>1k followers AND >12mo account age) with clear extracted fields; multiple corroborating signals.
- **high**: Strong certificate alone from recognizable organizer, OR verified tweet win announcement from a plausible X author (>100 followers AND >6mo account age, OR profile fields unverifiable but tweet content itself is strong and authority is high).
- **Cannot issue**: Evidence is weak, unverifiable, conflicting, OR the tweet author profile shows clear suspicion signals (very new account, near-zero followers, suspended) → call emit_gap instead.

### Gap Categories
- ocr_failure: Certificate couldn't be read or extracted fields are garbled
- irrelevant_content: Evidence doesn't relate to hackathon wins
- insufficient_evidence: Some signals present but too weak to verify
- verification_failure: Evidence contradicts itself or failed cross-check
- low_confidence: Signals present but confidence tier is too low
- missing_input: No evidence was provided

## Process

1. Read each evidence document carefully
2. Reason through what it tells you about the candidate's hackathon win(s)
3. Check whether the evidence meets the threshold for a verifiable credential
4. Call emit_hackathon_finding if evidence is sufficient, or emit_gap if not

Cite specific evidence in your reasoning. Be honest — if evidence is weak, say so clearly.`;

const EMPLOYER_SYSTEM = `You are a senior due diligence reviewer for a zero-knowledge credential system. Your task is to assess whether the provided evidence is sufficient to issue a verified reputable company credential.

## Your Job

Examine the evidence documents carefully, then make a final determination by calling one of the provided tools.

## Evidence Assessment Guide

### Evidence Types

**Companies House** (source: companies_house)
- This is the UK official company registry — highly authoritative
- company_status: "active" = very strong signal
- "active" in matched_data_points confirms the company is registered and operating
- very_high confidence_tier means the registry confirmed active status

**Web Evidence** (source: web_lookup)
- Company website, news articles, funding databases
- funding_bracket:XXX in matched_data_points shows detected funding level
- employee_count, founding_year, press signals add confidence
- verified_field_count shows how many signals were cross-checked

### Funding Brackets (assign the minimum bracket you can confidently verify)
- **lt_500k**: Bootstrap/pre-seed, very early stage, <10 employees, no notable external funding
- **500k_2m**: Seed stage, 10-50 employees, some angel or seed funding mentioned
- **2m_10m**: Series A, 50-200 employees, VC or significant grant funding confirmed
- **gt_10m**: Series B+, 200+ employees, major institutional funding confirmed

**Default**: If the company has an active Companies House record but no clear funding signals, use **500k_2m** — legitimate operating companies typically meet this minimum.

### Confidence Tiers (you must choose high or very_high for a Finding)
- **very_high**: Active CH record confirmed + corroborating web evidence
- **high**: Active CH record alone (registry is authoritative), OR very strong web signals with verified funding proof
- **Cannot issue**: No active CH record, or evidence is irrelevant/insufficient → call emit_gap

### Gap Categories
- registry_inactive: CH record exists but company is not "active"
- insufficient_evidence: Evidence present but doesn't establish legitimacy
- irrelevant_content: Web content is about a different company or unrelated topic
- verification_failure: Evidence contradicts itself
- unreachable_url: The provided URL could not be fetched
- missing_input: No evidence was provided

## Process

1. Read each evidence document carefully
2. Assess the company's legitimacy from the official registry and web signals
3. Determine the most accurate funding bracket based on available signals
4. Decide confidence tier based on evidence strength and corroboration
5. Call emit_company_finding if evidence is sufficient, or emit_gap if not

Be conservative on funding brackets — only claim a higher bracket if the evidence explicitly supports it. When in doubt between brackets, use the lower one.`;

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const CANDIDATE_TOOLS: Anthropic.Tool[] = [
  {
    name: "emit_hackathon_finding",
    description:
      "Issue a verified hackathon wins credential. Call this ONLY when evidence sufficiently proves the candidate won at least one hackathon with high confidence.",
    input_schema: {
      type: "object" as const,
      properties: {
        count: {
          type: "integer",
          minimum: 1,
          description: "Number of verified hackathon wins found across all evidence",
        },
        confidence_tier: {
          type: "string",
          enum: ["high", "very_high"],
          description:
            "high: strong single-source evidence; very_high: multiple corroborating sources with verified organizer reputability",
        },
      },
      required: ["count", "confidence_tier"],
    },
  },
  {
    name: "emit_gap",
    description:
      "Signal that evidence is insufficient to issue a hackathon wins credential. Call this when you cannot verify a win to the required confidence level.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: [
            "ocr_failure",
            "irrelevant_content",
            "insufficient_evidence",
            "verification_failure",
            "low_confidence",
            "missing_input",
          ],
          description: "Primary reason the credential cannot be issued",
        },
        reason: {
          type: "string",
          description: "Clear, user-facing explanation of why the credential cannot be issued",
        },
        what_we_tried: {
          type: "array",
          items: { type: "string" },
          description: "Steps the review agent took (e.g. 'OCR certificate', 'Check win announcement')",
        },
        why_not_found: {
          type: "array",
          items: { type: "string" },
          description: "Specific reason each step was inconclusive or failed",
        },
        sources_checked: {
          type: "array",
          items: { type: "string" },
          description: "Sources that were examined",
        },
        missing_evidence: {
          type: "array",
          items: { type: "string" },
          description: "What additional evidence would allow the credential to be issued",
        },
      },
      required: [
        "category",
        "reason",
        "what_we_tried",
        "why_not_found",
        "sources_checked",
        "missing_evidence",
      ],
    },
  },
];

const EMPLOYER_TOOLS: Anthropic.Tool[] = [
  {
    name: "emit_company_finding",
    description:
      "Issue a verified reputable company credential. Call this ONLY when evidence sufficiently establishes the company is legitimate with high confidence.",
    input_schema: {
      type: "object" as const,
      properties: {
        bracket_at_least: {
          type: "string",
          enum: ["lt_500k", "500k_2m", "2m_10m", "gt_10m"],
          description: "Minimum funding bracket the evidence supports",
        },
        confidence_tier: {
          type: "string",
          enum: ["high", "very_high"],
          description:
            "high: CH record OR strong web signals; very_high: CH record + corroborating web evidence",
        },
      },
      required: ["bracket_at_least", "confidence_tier"],
    },
  },
  {
    name: "emit_gap",
    description:
      "Signal that evidence is insufficient to issue a reputable company credential. Call this when you cannot verify company legitimacy to the required confidence level.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: [
            "registry_inactive",
            "insufficient_evidence",
            "irrelevant_content",
            "verification_failure",
            "unreachable_url",
            "missing_input",
          ],
          description: "Primary reason the credential cannot be issued",
        },
        reason: {
          type: "string",
          description: "Clear, user-facing explanation of why the credential cannot be issued",
        },
        what_we_tried: {
          type: "array",
          items: { type: "string" },
          description: "Steps taken (e.g. 'Companies House lookup', 'Web content extraction')",
        },
        why_not_found: {
          type: "array",
          items: { type: "string" },
          description: "Specific reason each step was inconclusive or failed",
        },
        sources_checked: {
          type: "array",
          items: { type: "string" },
          description: "Sources examined",
        },
        missing_evidence: {
          type: "array",
          items: { type: "string" },
          description: "What additional evidence would allow issuance",
        },
      },
      required: [
        "category",
        "reason",
        "what_we_tried",
        "why_not_found",
        "sources_checked",
        "missing_evidence",
      ],
    },
  },
];

// ─── Main function ────────────────────────────────────────────────────────────

const THROTTLE_MS = 250;
const MAX_REVIEW_TOKENS = 4096;

export async function runLLMReviewer(
  evidence: Evidence[],
  flow: ReviewerFlow,
  runId: string,
  _anthropicClient?: Anthropic
): Promise<ReviewerResult> {
  const claimType = flow === "candidate" ? "hackathon_wins" : "reputable_company";
  const evidenceIds = evidence.map((e) => e.id);

  emitEvent({
    run_id: runId,
    agent: "reviewer.derivation",
    kind: "plan",
    message: `LLM reviewer starting (${flow} flow, ${evidence.length} evidence record(s))`,
    data: { flow, evidenceCount: evidence.length, model: MODEL_REVIEWER },
    evidence_ids: evidenceIds,
  });

  if (evidence.length === 0) {
    const gap = GapSchema.parse({
      claim_type: claimType,
      category: "missing_input",
      reason: "No evidence was provided. Please supply a certificate, company number, or URL.",
      what_we_tried: [],
      why_not_found: [],
      sources_checked: [],
      missing_evidence:
        flow === "candidate"
          ? ["Hackathon certificate (PDF or image)", "LinkedIn/X post confirming the win"]
          : ["Companies House registration number", "Company website URL"],
    });
    emitEvent({
      run_id: runId,
      agent: "reviewer.derivation",
      kind: "decision",
      message: "Gap: missing_input — no evidence provided",
      data: { gap },
    });
    return { findings: [], gaps: [gap] };
  }

  const client = _anthropicClient ?? new Anthropic();
  const tools = flow === "candidate" ? CANDIDATE_TOOLS : EMPLOYER_TOOLS;
  const systemPrompt = flow === "candidate" ? CANDIDATE_SYSTEM : EMPLOYER_SYSTEM;

  // Build document blocks from evidence (Citations API)
  const documents = evidence.map(evidenceToDocument);
  const userContent: Anthropic.ContentBlockParam[] = [
    ...documents.map((d) => ({
      type: "document" as const,
      source: { type: "text" as const, media_type: "text/plain" as const, data: d.text },
      title: d.title,
      citations: { enabled: true },
    })),
    {
      type: "text" as const,
      text:
        flow === "candidate"
          ? `Review the above evidence and determine whether it is sufficient to issue a hackathon wins credential. Reason through each piece of evidence carefully, then call either emit_hackathon_finding or emit_gap.`
          : `Review the above evidence and determine whether it is sufficient to issue a reputable company credential. Reason through each piece of evidence carefully, then call either emit_company_finding or emit_gap.`,
    },
  ];

  try {
    const stream = client.messages.stream({
      model: MODEL_REVIEWER,
      max_tokens: MAX_REVIEW_TOKENS,
      system: systemPrompt,
      tools,
      tool_choice: { type: "any" }, // model MUST call a tool to finalize
      messages: [{ role: "user", content: userContent }],
    });

    // Stream reasoning text to the dashboard live
    let buffered = "";
    let lastEmit = 0;
    stream.on("text", (delta) => {
      buffered += delta;
      const now = Date.now();
      if (now - lastEmit >= THROTTLE_MS) {
        lastEmit = now;
        emitEvent({
          run_id: runId,
          agent: "reviewer.derivation",
          kind: "tool_result",
          message: "Reviewer reasoning",
          data: {
            streaming: true,
            partial_text: buffered.slice(-600),
            chars_so_far: buffered.length,
          },
        });
      }
    });

    const response = await stream.finalMessage();

    // Extract citations from any text blocks
    const citations: unknown[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        const maybe = block as unknown as { citations?: unknown[] };
        if (Array.isArray(maybe.citations)) {
          citations.push(...maybe.citations);
        }
      }
    }

    // Locate the finalization tool call
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (!toolUse) {
      throw new Error("LLM reviewer did not call a finalization tool");
    }

    const input = toolUse.input as Record<string, unknown>;

    emitEvent({
      run_id: runId,
      agent: "reviewer.derivation",
      kind: "decision",
      message: `Reviewer decision: ${toolUse.name}`,
      data: {
        tool: toolUse.name,
        input,
        citation_count: citations.length,
        reasoning_chars: buffered.length,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      evidence_ids: evidenceIds,
    });

    // ── Parse hackathon finding ───────────────────────────────────────────────
    if (toolUse.name === "emit_hackathon_finding") {
      const finding = HackathonWinsFindingSchema.parse({
        id: randomUUID(),
        run_id: runId,
        type: "hackathon_wins",
        count: input.count,
        confidence_tier: input.confidence_tier,
        evidence_ids: evidenceIds,
      });
      return { findings: [finding], gaps: [] };
    }

    // ── Parse employer finding ────────────────────────────────────────────────
    if (toolUse.name === "emit_company_finding") {
      const finding = ReputableCompanyFindingSchema.parse({
        id: randomUUID(),
        run_id: runId,
        type: "reputable_company",
        value: true,
        bracket_at_least: input.bracket_at_least,
        jurisdiction: "uk",
        confidence_tier: input.confidence_tier,
        evidence_ids: evidenceIds,
      });
      return { findings: [finding], gaps: [] };
    }

    // ── Parse gap ─────────────────────────────────────────────────────────────
    if (toolUse.name === "emit_gap") {
      const gap = GapSchema.parse({
        claim_type: claimType,
        category: input.category,
        reason: input.reason,
        what_we_tried: input.what_we_tried ?? [],
        why_not_found: input.why_not_found ?? [],
        sources_checked: input.sources_checked ?? [],
        missing_evidence: input.missing_evidence ?? [],
      });
      return { findings: [], gaps: [gap] };
    }

    throw new Error(`Unexpected tool name: ${toolUse.name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitEvent({
      run_id: runId,
      agent: "reviewer.derivation",
      kind: "error",
      message: `LLM reviewer failed: ${message}`,
      data: { flow, model: MODEL_REVIEWER },
      error: message,
    });
    // Hard failure — surface as gap so the pipeline doesn't silently issue
    const gap = GapSchema.parse({
      claim_type: claimType,
      category: "verification_failure",
      reason: "The automated review process encountered an error. Please try again.",
      what_we_tried: ["LLM-based evidence synthesis"],
      why_not_found: [message],
      sources_checked: evidence.map((e) => e.source_url ?? e.source),
      missing_evidence: [],
    });
    return { findings: [], gaps: [gap] };
  }
}
