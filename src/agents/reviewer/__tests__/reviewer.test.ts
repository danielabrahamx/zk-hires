import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import { runReviewer } from "@/agents/reviewer";
import type { Evidence } from "@/types/evidence";

vi.mock("@/trace/store", () => ({
  recordEvent: vi.fn(),
  emitEvent: vi.fn(),
}));

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: randomUUID(),
    run_id: randomUUID(),
    source: "certificate",
    retrieved_at: new Date().toISOString(),
    raw_artifact_hash: "0xabc",
    matched_data_points: [],
    signal_type: "certificate",
    organizer_profile: null,
    reputability_score: null,
    confidence_tier: "high",
    ...overrides,
  };
}

function toolUseResponse(name: string, input: Record<string, unknown>) {
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    content: [
      { type: "text", text: "Reviewing the evidence..." },
      { type: "tool_use", id: `toolu_${randomUUID()}`, name, input },
    ],
    stop_reason: "tool_use",
    model: "claude-opus-4-7",
    usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

describe("runReviewer — LLM integration", () => {
  let mockFinalMessage: ReturnType<typeof vi.fn>;
  let mockStream: { on: ReturnType<typeof vi.fn>; finalMessage: ReturnType<typeof vi.fn> };
  let mockClient: { messages: { stream: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFinalMessage = vi.fn();
    mockStream = { on: vi.fn().mockReturnThis(), finalMessage: mockFinalMessage };
    mockClient = { messages: { stream: vi.fn().mockReturnValue(mockStream) } };
  });

  it("candidate flow: a strong certificate yields a hackathon_wins finding", async () => {
    const runId = randomUUID();
    const cert = makeEvidence({
      source: "certificate",
      signal_type: "certificate",
      confidence_tier: "high",
      matched_data_points: ["Encode Club", "Encode Hack 2024"],
      organizer_profile: {
        handle: "@EncodeClub",
        platform: "x",
        follower_count: 45000,
        account_age_months: 48,
        cross_platform_handles: ["@EncodeClub", "encode.club"],
        third_party_coverage_urls: ["https://techcrunch.com/x"],
      },
    });

    mockFinalMessage.mockResolvedValueOnce(
      toolUseResponse("emit_hackathon_finding", { count: 1, confidence_tier: "high" })
    );

    const { findings, gaps } = await runReviewer(
      [cert],
      "candidate",
      runId,
      mockClient as unknown as Anthropic
    );

    expect(gaps).toHaveLength(0);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("hackathon_wins");
    if (findings[0].type === "hackathon_wins") {
      expect(findings[0].count).toBe(1);
      expect(findings[0].evidence_ids).toContain(cert.id);
    }
  });

  it("employer flow: CH + web evidence yields reputable_company finding", async () => {
    const runId = randomUUID();
    const ch = makeEvidence({
      source: "companies_house",
      signal_type: "company_record",
      confidence_tier: "very_high",
      matched_data_points: ["SIBROX LTD", "active"],
    });
    const web = makeEvidence({
      source: "web_lookup",
      signal_type: "funding_round",
      confidence_tier: "high",
      matched_data_points: ["funding_bracket:500k_2m"],
    });

    mockFinalMessage.mockResolvedValueOnce(
      toolUseResponse("emit_company_finding", {
        bracket_at_least: "500k_2m",
        confidence_tier: "very_high",
      })
    );

    const { findings, gaps } = await runReviewer(
      [ch, web],
      "employer",
      runId,
      mockClient as unknown as Anthropic
    );

    expect(gaps).toHaveLength(0);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("reputable_company");
    if (findings[0].type === "reputable_company") {
      expect(findings[0].bracket_at_least).toBe("500k_2m");
      expect(findings[0].jurisdiction).toBe("uk");
      expect(findings[0].evidence_ids).toEqual([ch.id, web.id]);
    }
  });

  it("emits a gap when the model calls emit_gap", async () => {
    const runId = randomUUID();
    const weakEvidence = makeEvidence({ confidence_tier: "low" });

    mockFinalMessage.mockResolvedValueOnce(
      toolUseResponse("emit_gap", {
        category: "low_confidence",
        reason: "The certificate could not be verified with sufficient confidence.",
        what_we_tried: ["Certificate OCR"],
        why_not_found: ["Extracted fields present but confidence tier is low"],
        sources_checked: ["certificate"],
        missing_evidence: ["High-quality certificate scan or LinkedIn win announcement"],
      })
    );

    const { findings, gaps } = await runReviewer(
      [weakEvidence],
      "candidate",
      runId,
      mockClient as unknown as Anthropic
    );

    expect(findings).toHaveLength(0);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].category).toBe("low_confidence");
  });

  it("returns missing_input gap immediately without calling the model when no evidence provided", async () => {
    const runId = randomUUID();
    const { findings, gaps } = await runReviewer(
      [],
      "candidate",
      runId,
      mockClient as unknown as Anthropic
    );

    expect(findings).toHaveLength(0);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].category).toBe("missing_input");
    // Model should NOT be called — no evidence means immediate gap
    expect(mockClient.messages.stream).not.toHaveBeenCalled();
  });
});
