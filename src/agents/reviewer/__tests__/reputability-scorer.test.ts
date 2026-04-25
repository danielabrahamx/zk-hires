import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  getReputabilityThreshold,
  scoreEvidence,
  scoreTier,
} from "@/agents/reviewer/reputability-scorer";
import type { Evidence, OrganizerProfile } from "@/types/evidence";

function profile(overrides: Partial<OrganizerProfile> = {}): OrganizerProfile {
  return {
    handle: "@test",
    platform: "x",
    follower_count: 0,
    account_age_months: 0,
    cross_platform_handles: [],
    third_party_coverage_urls: [],
    ...overrides,
  };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
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
    confidence_tier: "low",
    ...overrides,
  };
}

describe("scoreEvidence — individual signals", () => {
  it("signal 1: follower_count_host_platform passes at 5000+", () => {
    const result = scoreEvidence(
      evidence({ organizer_profile: profile({ follower_count: 5000 }) })
    );
    expect(result.signalsPassed).toContain("follower_count_host_platform");
  });

  it("signal 2: follower_count_primary_handle passes at 10000+", () => {
    const passing = scoreEvidence(
      evidence({ organizer_profile: profile({ follower_count: 10000 }) })
    );
    expect(passing.signalsPassed).toContain("follower_count_primary_handle");

    const failing = scoreEvidence(
      evidence({ organizer_profile: profile({ follower_count: 9999 }) })
    );
    expect(failing.signalsFailed).toContain("follower_count_primary_handle");
  });

  it("signal 3: account_age passes at 12+ months", () => {
    const passing = scoreEvidence(
      evidence({ organizer_profile: profile({ account_age_months: 24 }) })
    );
    expect(passing.signalsPassed).toContain("account_age");

    const failing = scoreEvidence(
      evidence({ organizer_profile: profile({ account_age_months: 6 }) })
    );
    expect(failing.signalsFailed).toContain("account_age");
  });

  it("signal 4: cross_platform_consistency requires 2+ handles", () => {
    const passing = scoreEvidence(
      evidence({
        organizer_profile: profile({
          cross_platform_handles: ["@a", "@b"],
        }),
      })
    );
    expect(passing.signalsPassed).toContain("cross_platform_consistency");

    const failing = scoreEvidence(
      evidence({
        organizer_profile: profile({ cross_platform_handles: ["@a"] }),
      })
    );
    expect(failing.signalsFailed).toContain("cross_platform_consistency");
  });

  it("signal 5: public_coverage requires 1+ URL", () => {
    const passing = scoreEvidence(
      evidence({
        organizer_profile: profile({
          third_party_coverage_urls: ["https://techcrunch.com/x"],
        }),
      })
    );
    expect(passing.signalsPassed).toContain("public_coverage");

    const failing = scoreEvidence(
      evidence({
        organizer_profile: profile({ third_party_coverage_urls: [] }),
      })
    );
    expect(failing.signalsFailed).toContain("public_coverage");
  });

  it("signal 6: win_post_authenticity requires 2+ matched_data_points", () => {
    const passing = scoreEvidence(
      evidence({ matched_data_points: ["Encode Club", "Encode Hack 2024"] })
    );
    expect(passing.signalsPassed).toContain("win_post_authenticity");

    const failing = scoreEvidence(
      evidence({ matched_data_points: ["Encode Club"] })
    );
    expect(failing.signalsFailed).toContain("win_post_authenticity");
  });
});

describe("scoreEvidence — integration", () => {
  it("Encode Club (high rep): score = 6", () => {
    const result = scoreEvidence(
      evidence({
        organizer_profile: profile({
          handle: "@EncodeClub",
          platform: "x",
          follower_count: 45000,
          account_age_months: 48,
          cross_platform_handles: ["@EncodeClub", "encode.club"],
          third_party_coverage_urls: ["https://techcrunch.com/x"],
        }),
        matched_data_points: ["Encode Club", "Encode Hack 2024"],
      })
    );
    expect(result.score).toBe(6);
  });

  it("FakeOrgX (low rep): null profile, no matched points → score = 0", () => {
    const result = scoreEvidence(
      evidence({
        organizer_profile: null,
        matched_data_points: [],
      })
    );
    expect(result.score).toBe(0);
  });

  it("scoreTier maps score → tier using threshold (default 4)", () => {
    expect(scoreTier(6)).toBe("high");
    expect(scoreTier(getReputabilityThreshold())).toBe("high");
    expect(scoreTier(3)).toBe("medium");
    expect(scoreTier(2)).toBe("medium");
    expect(scoreTier(1)).toBe("low");
    expect(scoreTier(0)).toBe("low");
  });
});
