import { recordEvent } from "@/trace/store";
import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";
import type { Gap } from "@/types/gap";

import { enforceCitations } from "@/agents/reviewer/cite-or-drop";
import {
  deriveCandidateFinding,
  deriveEmployerFinding,
} from "@/agents/reviewer/claim-derivation";
import {
  scoreEvidence,
  scoreTier,
} from "@/agents/reviewer/reputability-scorer";

/**
 * Reviewer orchestrator.
 *
 * Spec §5.2 / §6. Takes the Researcher's Evidence bag and:
 *   1. Re-scores reputability for hackathon-style evidence and recomputes
 *      confidence_tier from the score. Company-record evidence keeps the
 *      tier the source assigned (reputability heuristics don't apply).
 *   2. Derives a single Finding or Gap depending on flow.
 *   3. Enforces cite-or-drop: any Finding whose citations don't resolve
 *      against the Evidence set becomes a Gap.
 *
 * Every step bookended by TraceEvents so the audit trail is complete.
 */

export type ReviewerFlow = "candidate" | "employer";

export interface ReviewerResult {
  findings: Finding[];
  gaps: Gap[];
}

function shouldRescore(evidence: Evidence): boolean {
  return (
    evidence.source === "certificate" ||
    evidence.source === "linkedin" ||
    evidence.source === "x"
  );
}

export async function runReviewer(
  evidence: Evidence[],
  flow: ReviewerFlow,
  runId: string
): Promise<ReviewerResult> {
  const startTs = Date.now();

  recordEvent({
    ts: startTs,
    run_id: runId,
    agent: "reviewer",
    action: "reviewer_start",
    input: { flow, evidenceCount: evidence.length },
    output: null,
    latency_ms: 0,
    evidence_ids: evidence.map((e) => e.id),
  });

  const scored: Evidence[] = evidence.map((item) => {
    if (!shouldRescore(item)) return item;
    const result = scoreEvidence(item);
    return {
      ...item,
      reputability_score: result.score,
      confidence_tier: scoreTier(result.score),
    };
  });

  const claimType: Gap["claim_type"] =
    flow === "candidate" ? "hackathon_wins" : "reputable_company";

  const derived =
    flow === "candidate"
      ? deriveCandidateFinding(scored, runId)
      : deriveEmployerFinding(scored, runId);

  const isGap = !("type" in derived);

  if (isGap) {
    const result: ReviewerResult = { findings: [], gaps: [derived] };
    recordEvent({
      ts: Date.now(),
      run_id: runId,
      agent: "reviewer",
      action: "reviewer_done",
      input: { flow, evidenceCount: evidence.length },
      output: { findingsCount: 0, gapsCount: 1 },
      latency_ms: Date.now() - startTs,
      evidence_ids: evidence.map((e) => e.id),
    });
    return result;
  }

  const survivors = enforceCitations([derived], scored);

  if (survivors.length === 0) {
    const gap: Gap = {
      claim_type: claimType,
      reason: "Finding dropped by citation check",
      missing_evidence: [],
    };
    recordEvent({
      ts: Date.now(),
      run_id: runId,
      agent: "reviewer",
      action: "reviewer_done",
      input: { flow, evidenceCount: evidence.length },
      output: { findingsCount: 0, gapsCount: 1 },
      latency_ms: Date.now() - startTs,
      evidence_ids: evidence.map((e) => e.id),
    });
    return { findings: [], gaps: [gap] };
  }

  recordEvent({
    ts: Date.now(),
    run_id: runId,
    agent: "reviewer",
    action: "reviewer_done",
    input: { flow, evidenceCount: evidence.length },
    output: { findingsCount: survivors.length, gapsCount: 0 },
    latency_ms: Date.now() - startTs,
    evidence_ids: evidence.map((e) => e.id),
  });

  return { findings: survivors, gaps: [] };
}
