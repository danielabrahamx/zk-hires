import { describe, it, expect } from "vitest";
import { EvidenceSchema } from "../evidence";

const goodFixture = {
  id: "11111111-1111-4111-8111-111111111111",
  run_id: "22222222-2222-4222-8222-222222222222",
  source: "certificate",
  source_url: "https://example.com/cert.pdf",
  retrieved_at: "2026-04-25T12:00:00.000Z",
  raw_artifact_hash: "deadbeef",
  matched_data_points: ["organizer:Encode Club", "year:2025"],
  signal_type: "certificate",
  organizer_profile: {
    handle: "encode_club",
    platform: "x",
    follower_count: 50000,
    account_age_months: 60,
    cross_platform_handles: ["encode.club", "linkedin.com/company/encode-club"],
    third_party_coverage_urls: ["https://techcrunch.com/encode-2024"],
  },
  reputability_score: 6,
  confidence_tier: "very_high",
  notes: "Encode Club London 2025 winner",
};

describe("EvidenceSchema", () => {
  it("accepts a well-formed Evidence record matching spec §6", () => {
    const result = EvidenceSchema.safeParse(goodFixture);
    expect(result.success).toBe(true);
  });

  it("accepts null organizer_profile for non-hackathon evidence", () => {
    const employerEvidence = {
      ...goodFixture,
      source: "companies_house",
      signal_type: "company_record",
      organizer_profile: null,
      reputability_score: null,
      confidence_tier: "very_high",
    };
    expect(EvidenceSchema.safeParse(employerEvidence).success).toBe(true);
  });

  it("rejects a record missing required fields", () => {
    const bad = { id: "not-a-uuid", source: "certificate" };
    expect(EvidenceSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a reputability_score outside 0-6", () => {
    const bad = { ...goodFixture, reputability_score: 99 };
    expect(EvidenceSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown source enum value", () => {
    const bad = { ...goodFixture, source: "myspace" };
    expect(EvidenceSchema.safeParse(bad).success).toBe(false);
  });
});
