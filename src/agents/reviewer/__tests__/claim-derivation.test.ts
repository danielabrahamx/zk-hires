import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deriveCandidateFinding,
  deriveEmployerFinding,
} from "@/agents/reviewer/claim-derivation";
import type { Evidence } from "@/types/evidence";

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

describe("deriveCandidateFinding", () => {
  it("returns hackathon_wins finding with count=1 for one valid certificate", () => {
    const cert = makeEvidence({
      source: "certificate",
      confidence_tier: "high",
    });
    const runId = randomUUID();

    const result = deriveCandidateFinding([cert], runId);

    expect("type" in result).toBe(true);
    if ("type" in result && result.type === "hackathon_wins") {
      expect(result.count).toBe(1);
      expect(result.evidence_ids).toEqual([cert.id]);
      expect(result.run_id).toBe(runId);
    } else {
      throw new Error("expected hackathon_wins finding");
    }
  });

  it("returns hackathon_wins finding with count=2 for two valid certificates", () => {
    const cert1 = makeEvidence({
      source: "certificate",
      confidence_tier: "high",
    });
    const cert2 = makeEvidence({
      source: "certificate",
      confidence_tier: "very_high",
    });
    const runId = randomUUID();

    const result = deriveCandidateFinding([cert1, cert2], runId);

    expect("type" in result).toBe(true);
    if ("type" in result && result.type === "hackathon_wins") {
      expect(result.count).toBe(2);
      expect(result.evidence_ids).toEqual([cert1.id, cert2.id]);
    } else {
      throw new Error("expected hackathon_wins finding");
    }
  });

  it("returns Gap when all certificates fail confidence threshold", () => {
    const cert = makeEvidence({
      source: "certificate",
      confidence_tier: "low",
    });

    const result = deriveCandidateFinding([cert], randomUUID());

    expect("type" in result).toBe(false);
    if (!("type" in result)) {
      expect(result.claim_type).toBe("hackathon_wins");
      // Structured Gap: low-confidence certificate maps to "low_confidence"
      // category; the reason is the user-facing message for that category.
      expect(result.category).toBe("low_confidence");
      expect(result.reason.toLowerCase()).toMatch(/weak|confidence/);
      expect(result.missing_evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("deriveEmployerFinding", () => {
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

  it("returns reputable_company finding when CH active + CB funding meets threshold", () => {
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
    const runId = randomUUID();

    const result = deriveEmployerFinding([ch, cb], runId);

    expect("type" in result).toBe(true);
    if ("type" in result) {
      expect(result.type).toBe("reputable_company");
      if (result.type === "reputable_company") {
        expect(result.bracket_at_least).toBe("500k_2m");
        expect(result.jurisdiction).toBe("uk");
        expect(result.evidence_ids).toEqual([ch.id, cb.id]);
      }
    }
  });

  it("issues credential from web evidence alone when bracket meets threshold", () => {
    const cb = makeEvidence({
      source: "web_lookup",
      signal_type: "funding_round",
      matched_data_points: ["funding_bracket:500k_2m"],
    });

    const result = deriveEmployerFinding([cb], randomUUID());

    expect("type" in result).toBe(true);
    if ("type" in result && result.type === "reputable_company") {
      expect(result.bracket_at_least).toBe("500k_2m");
      expect(result.confidence_tier).toBe("high");
    }
  });

  it("returns Gap when web-only evidence has bracket below threshold", () => {
    const cb = makeEvidence({
      source: "web_lookup",
      signal_type: "funding_round",
      confidence_tier: "high",
      matched_data_points: ["funding_bracket:lt_500k"],
    });

    const result = deriveEmployerFinding([cb], randomUUID());

    expect("type" in result).toBe(false);
    if (!("type" in result)) {
      expect(result.claim_type).toBe("reputable_company");
      expect(result.reason).toContain("below");
    }
  });

  it("issues credential when CH present even if web bracket is below threshold", () => {
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
      matched_data_points: ["funding_bracket:lt_500k"],
    });

    const result = deriveEmployerFinding([ch, cb], randomUUID());

    expect("type" in result).toBe(true);
    if ("type" in result) {
      expect(result.type).toBe("reputable_company");
      expect(result.confidence_tier).toBe("very_high");
    }
  });
});
