import { describe, it, expect } from "vitest";
import { GapSchema } from "../gap";

describe("GapSchema", () => {
  it("accepts a well-formed Gap record", () => {
    const gap = {
      claim_type: "hackathon_wins",
      category: "low_confidence",
      reason: "Organizer reputability score 2 < threshold 4",
      missing_evidence: ["third_party_coverage", "follower_count"],
    };
    expect(GapSchema.safeParse(gap).success).toBe(true);
  });

  it("accepts employer-side Gap", () => {
    const gap = {
      claim_type: "reputable_company",
      category: "unreachable_url",
      reason: "Companies House lookup returned 404",
      missing_evidence: ["entity_real"],
    };
    expect(GapSchema.safeParse(gap).success).toBe(true);
  });

  it("rejects when required fields are missing", () => {
    expect(GapSchema.safeParse({ claim_type: "hackathon_wins" }).success).toBe(false);
    expect(
      GapSchema.safeParse({
        reason: "x",
        missing_evidence: [],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown claim_type", () => {
    const bad = {
      claim_type: "is_cool",
      category: "low_confidence",
      reason: "n/a",
      missing_evidence: [],
    };
    expect(GapSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown category", () => {
    const bad = {
      claim_type: "hackathon_wins",
      category: "made_up_category",
      reason: "n/a",
      missing_evidence: [],
    };
    expect(GapSchema.safeParse(bad).success).toBe(false);
  });
});
