import { describe, it, expect } from "vitest";
import { FindingSchema } from "../finding";

const RUN_ID = "22222222-2222-4222-8222-222222222222";
const EV_ID = "11111111-1111-4111-8111-111111111111";

describe("FindingSchema", () => {
  it("accepts hackathon_wins variant for candidate flow", () => {
    const finding = {
      id: "33333333-3333-4333-8333-333333333333",
      run_id: RUN_ID,
      type: "hackathon_wins",
      count: 4,
      evidence_ids: [EV_ID],
      confidence_tier: "high",
    };
    expect(FindingSchema.safeParse(finding).success).toBe(true);
  });

  it("accepts reputable_company variant for employer flow", () => {
    const finding = {
      id: "33333333-3333-4333-8333-333333333333",
      run_id: RUN_ID,
      type: "reputable_company",
      value: true,
      bracket_at_least: "500k_2m",
      jurisdiction: "uk",
      evidence_ids: [EV_ID],
      confidence_tier: "very_high",
    };
    expect(FindingSchema.safeParse(finding).success).toBe(true);
  });

  it("rejects hackathon_wins missing required count", () => {
    const missingCount = {
      id: "33333333-3333-4333-8333-333333333333",
      run_id: RUN_ID,
      type: "hackathon_wins",
      evidence_ids: [EV_ID],
      confidence_tier: "high",
    };
    expect(FindingSchema.safeParse(missingCount).success).toBe(false);
  });

  it("rejects reputable_company missing required bracket", () => {
    const bad = {
      id: "33333333-3333-4333-8333-333333333333",
      run_id: RUN_ID,
      type: "reputable_company",
      value: true,
      jurisdiction: "uk",
      evidence_ids: [EV_ID],
      confidence_tier: "very_high",
    };
    expect(FindingSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown type discriminator", () => {
    const bad = {
      id: "33333333-3333-4333-8333-333333333333",
      run_id: RUN_ID,
      type: "something_else",
      evidence_ids: [EV_ID],
      confidence_tier: "high",
    };
    expect(FindingSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects empty evidence_ids array", () => {
    const bad = {
      id: "33333333-3333-4333-8333-333333333333",
      run_id: RUN_ID,
      type: "hackathon_wins",
      count: 0,
      evidence_ids: [],
      confidence_tier: "high",
    };
    expect(FindingSchema.safeParse(bad).success).toBe(false);
  });
});
