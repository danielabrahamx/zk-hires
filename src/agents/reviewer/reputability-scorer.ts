import type { Evidence } from "@/types/evidence";
import { emitEvent } from "@/trace/store";
import {
  REPUTABILITY_THRESHOLD,
  REPUTABILITY_MEDIUM_THRESHOLD,
  REPUTABILITY_FOLLOWERS_HOST,
  REPUTABILITY_FOLLOWERS_PRIMARY,
  REPUTABILITY_ACCOUNT_AGE_MONTHS,
  REPUTABILITY_CROSS_PLATFORM_HANDLES,
  REPUTABILITY_THIRD_PARTY_COVERAGE,
  REPUTABILITY_MATCHED_DATA_POINTS,
} from "@/config/runtime";

/**
 * Reputability scorer.
 *
 * Six binary signals over an Evidence record (mainly hackathon
 * certificates). Each signal contributes 0 or 1; the sum is mapped to a
 * confidence_tier downstream. Thresholds are funnelled through
 * `src/config/runtime.ts` so ops can tune without a code push.
 *
 * Spec §6 / §8 (reputability heuristics).
 *
 * Tracing: each signal evaluation emits a `tool_call` event under the
 * `reviewer.scorer` agent. After all signals are scored a single
 * `decision` event reports the final score, tier, and which signals
 * passed/failed.
 */

export type ScoreResult = {
  score: number;
  signalsPassed: string[];
  signalsFailed: string[];
};

export function getReputabilityThreshold(): number {
  return REPUTABILITY_THRESHOLD;
}

const SIGNAL_NAMES = [
  "follower_count_host_platform",
  "follower_count_primary_handle",
  "account_age",
  "cross_platform_consistency",
  "public_coverage",
  "win_post_authenticity",
] as const;

type ScoreOptions = { runId?: string; evidenceId?: string };

function emitSignalCall(
  opts: ScoreOptions,
  signal: string,
  passed: boolean,
  data: Record<string, unknown>
): void {
  if (!opts.runId) return;
  emitEvent({
    run_id: opts.runId,
    agent: "reviewer.scorer",
    kind: "tool_call",
    message: `signal:${signal} ${passed ? "pass" : "fail"}`,
    data: { signal, passed, ...data },
    evidence_ids: opts.evidenceId ? [opts.evidenceId] : [],
  });
}

export function scoreEvidence(
  evidence: Evidence,
  opts: ScoreOptions = {}
): ScoreResult {
  const passed: string[] = [];
  const failed: string[] = [];
  const evidenceId = opts.evidenceId ?? evidence.id;
  const traceOpts: ScoreOptions = { ...opts, evidenceId };

  const profile = evidence.organizer_profile;

  // Signal 1: follower_count_host_platform
  {
    const value = profile?.follower_count ?? null;
    const ok =
      profile !== null &&
      value !== null &&
      value >= REPUTABILITY_FOLLOWERS_HOST;
    if (ok) passed.push(SIGNAL_NAMES[0]);
    else failed.push(SIGNAL_NAMES[0]);
    emitSignalCall(traceOpts, SIGNAL_NAMES[0], ok, {
      threshold: REPUTABILITY_FOLLOWERS_HOST,
      observed: value,
    });
  }

  // Signal 2: follower_count_primary_handle (higher bar)
  {
    const value = profile?.follower_count ?? null;
    const ok =
      profile !== null &&
      value !== null &&
      value >= REPUTABILITY_FOLLOWERS_PRIMARY;
    if (ok) passed.push(SIGNAL_NAMES[1]);
    else failed.push(SIGNAL_NAMES[1]);
    emitSignalCall(traceOpts, SIGNAL_NAMES[1], ok, {
      threshold: REPUTABILITY_FOLLOWERS_PRIMARY,
      observed: value,
    });
  }

  // Signal 3: account_age
  {
    const value = profile?.account_age_months ?? null;
    const ok =
      profile !== null &&
      value !== null &&
      value >= REPUTABILITY_ACCOUNT_AGE_MONTHS;
    if (ok) passed.push(SIGNAL_NAMES[2]);
    else failed.push(SIGNAL_NAMES[2]);
    emitSignalCall(traceOpts, SIGNAL_NAMES[2], ok, {
      threshold: REPUTABILITY_ACCOUNT_AGE_MONTHS,
      observed: value,
    });
  }

  // Signal 4: cross_platform_consistency
  {
    const count = profile?.cross_platform_handles.length ?? 0;
    const ok =
      profile !== null && count >= REPUTABILITY_CROSS_PLATFORM_HANDLES;
    if (ok) passed.push(SIGNAL_NAMES[3]);
    else failed.push(SIGNAL_NAMES[3]);
    emitSignalCall(traceOpts, SIGNAL_NAMES[3], ok, {
      threshold: REPUTABILITY_CROSS_PLATFORM_HANDLES,
      observed: count,
    });
  }

  // Signal 5: public_coverage
  {
    const count = profile?.third_party_coverage_urls.length ?? 0;
    const ok =
      profile !== null && count >= REPUTABILITY_THIRD_PARTY_COVERAGE;
    if (ok) passed.push(SIGNAL_NAMES[4]);
    else failed.push(SIGNAL_NAMES[4]);
    emitSignalCall(traceOpts, SIGNAL_NAMES[4], ok, {
      threshold: REPUTABILITY_THIRD_PARTY_COVERAGE,
      observed: count,
    });
  }

  // Signal 6: win_post_authenticity (independent of organizer_profile)
  {
    const count = evidence.matched_data_points.length;
    const ok = count >= REPUTABILITY_MATCHED_DATA_POINTS;
    if (ok) passed.push(SIGNAL_NAMES[5]);
    else failed.push(SIGNAL_NAMES[5]);
    emitSignalCall(traceOpts, SIGNAL_NAMES[5], ok, {
      threshold: REPUTABILITY_MATCHED_DATA_POINTS,
      observed: count,
    });
  }

  const score = passed.length;
  const tier = scoreTier(score);

  if (opts.runId) {
    emitEvent({
      run_id: opts.runId,
      agent: "reviewer.scorer",
      kind: "decision",
      message: `score=${score} tier=${tier}`,
      data: {
        score,
        tier,
        signalsPassed: passed,
        signalsFailed: failed,
      },
      evidence_ids: evidenceId ? [evidenceId] : [],
    });
  }

  return {
    score,
    signalsPassed: passed,
    signalsFailed: failed,
  };
}

export function scoreTier(score: number): Evidence["confidence_tier"] {
  if (score >= REPUTABILITY_THRESHOLD) return "high";
  if (score >= REPUTABILITY_MEDIUM_THRESHOLD) return "medium";
  return "low";
}
