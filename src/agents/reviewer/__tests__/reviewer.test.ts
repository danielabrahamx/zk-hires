import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runReviewer } from "@/agents/reviewer";
import type { Evidence } from "@/types/evidence";

vi.mock("@/trace/store", () => ({
  recordEvent: vi.fn(),
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

describe("runReviewer — integration", () => {
  const originalThreshold = process.env.FUNDING_BRACKET_THRESHOLD;

  beforeEach(() => {
    process.env.FUNDING_BRACKET_THRESHOLD = "500k_2m";
  });

  afterEach(() => {
    if (originalThreshold === undefined) {
      delete process.env.FUNDING_BRACKET_THRESHOLD;
    } else {
      process.env.FUNDING_BRACKET_THRESHOLD = originalThreshold;
    }
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

    const { findings, gaps } = await runReviewer([cert], "candidate", runId);

    expect(gaps).toHaveLength(0);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("hackathon_wins");
    if (findings[0].type === "hackathon_wins") {
      expect(findings[0].count).toBe(1);
      expect(findings[0].evidence_ids).toContain(cert.id);
    }
  });

  it("employer flow: CH + CB with adequate funding yields reputable_company finding", async () => {
    const runId = randomUUID();
    const ch = makeEvidence({
      source: "companies_house",
      signal_type: "company_record",
      confidence_tier: "very_high",
      matched_data_points: ["SIBROX LTD", "active"],
    });
    const cb = makeEvidence({
      source: "web_lookup",
      signal_type: "funding_round",
      confidence_tier: "high",
      matched_data_points: ["funding_bracket:500k_2m"],
    });

    const { findings, gaps } = await runReviewer(
      [ch, cb],
      "employer",
      runId
    );

    expect(gaps).toHaveLength(0);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("reputable_company");
    if (findings[0].type === "reputable_company") {
      expect(findings[0].bracket_at_least).toBe("500k_2m");
      expect(findings[0].jurisdiction).toBe("uk");
      expect(findings[0].evidence_ids).toEqual([ch.id, cb.id]);
    }
  });
});
