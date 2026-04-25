import type { Evidence } from "@/types/evidence";

/**
 * Reputability scorer.
 *
 * Six binary signals over an Evidence record (mainly hackathon
 * certificates). Each signal contributes 0 or 1; the sum is mapped to a
 * confidence_tier downstream. Thresholds are env-tunable so tests can
 * pin them and ops can rebalance without code changes.
 *
 * Spec §6 / §8 (reputability heuristics).
 */

export type ScoreResult = {
  score: number;
  signalsPassed: string[];
  signalsFailed: string[];
};

export function getReputabilityThreshold(): number {
  return parseInt(process.env.REPUTABILITY_THRESHOLD ?? "4", 10);
}

function getFollowersHostPlatform(): number {
  return parseInt(process.env.FOLLOWERS_HOST_PLATFORM ?? "5000", 10);
}

function getFollowersPrimaryHandle(): number {
  return parseInt(process.env.FOLLOWERS_PRIMARY_HANDLE ?? "10000", 10);
}

function getAccountAgeMonths(): number {
  return parseInt(process.env.ACCOUNT_AGE_MONTHS ?? "12", 10);
}

const SIGNAL_NAMES = [
  "follower_count_host_platform",
  "follower_count_primary_handle",
  "account_age",
  "cross_platform_consistency",
  "public_coverage",
  "win_post_authenticity",
] as const;

export function scoreEvidence(evidence: Evidence): ScoreResult {
  const passed: string[] = [];
  const failed: string[] = [];

  const profile = evidence.organizer_profile;

  // Signal 1: follower_count_host_platform
  if (
    profile !== null &&
    profile.follower_count !== null &&
    profile.follower_count >= getFollowersHostPlatform()
  ) {
    passed.push(SIGNAL_NAMES[0]);
  } else {
    failed.push(SIGNAL_NAMES[0]);
  }

  // Signal 2: follower_count_primary_handle (higher bar)
  if (
    profile !== null &&
    profile.follower_count !== null &&
    profile.follower_count >= getFollowersPrimaryHandle()
  ) {
    passed.push(SIGNAL_NAMES[1]);
  } else {
    failed.push(SIGNAL_NAMES[1]);
  }

  // Signal 3: account_age
  if (
    profile !== null &&
    profile.account_age_months !== null &&
    profile.account_age_months >= getAccountAgeMonths()
  ) {
    passed.push(SIGNAL_NAMES[2]);
  } else {
    failed.push(SIGNAL_NAMES[2]);
  }

  // Signal 4: cross_platform_consistency
  if (profile !== null && profile.cross_platform_handles.length >= 2) {
    passed.push(SIGNAL_NAMES[3]);
  } else {
    failed.push(SIGNAL_NAMES[3]);
  }

  // Signal 5: public_coverage
  if (profile !== null && profile.third_party_coverage_urls.length >= 1) {
    passed.push(SIGNAL_NAMES[4]);
  } else {
    failed.push(SIGNAL_NAMES[4]);
  }

  // Signal 6: win_post_authenticity (independent of organizer_profile)
  if (evidence.matched_data_points.length >= 2) {
    passed.push(SIGNAL_NAMES[5]);
  } else {
    failed.push(SIGNAL_NAMES[5]);
  }

  return {
    score: passed.length,
    signalsPassed: passed,
    signalsFailed: failed,
  };
}

export function scoreTier(score: number): Evidence["confidence_tier"] {
  if (score >= getReputabilityThreshold()) return "high";
  if (score >= 2) return "medium";
  return "low";
}
