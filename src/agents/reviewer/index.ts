import Anthropic from "@anthropic-ai/sdk";
import { recordEvent } from "@/trace/store";
import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";
import type { Gap } from "@/types/gap";

import { runLLMReviewer } from "@/agents/reviewer/llm-reviewer";

/**
 * Reviewer orchestrator.
 *
 * Delegates to the LLM reviewer which uses Claude Opus with the Citations API
 * to reason through evidence and produce a structured Finding or Gap. The model
 * streams its reasoning to the trace dashboard before finalizing a decision via
 * tool-use.
 */

export type ReviewerFlow = "candidate" | "employer";

export interface ReviewerResult {
  findings: Finding[];
  gaps: Gap[];
}

export async function runReviewer(
  evidence: Evidence[],
  flow: ReviewerFlow,
  runId: string,
  /** Test injection — omit in production; the function creates its own client. */
  _anthropicClient?: Anthropic
): Promise<ReviewerResult> {
  const startTs = Date.now();

  recordEvent({
    ts: startTs,
    run_id: runId,
    agent: "reviewer",
    action: "reviewer_start",
    kind: "plan",
    message: `LLM reviewer starting — ${evidence.length} evidence record(s), ${flow} flow`,
    data: { flow, evidenceCount: evidence.length },
    input: { flow, evidenceCount: evidence.length },
    output: null,
    latency_ms: 0,
    evidence_ids: evidence.map((e) => e.id),
  });

  const result = await runLLMReviewer(evidence, flow, runId, _anthropicClient);

  const isGap = result.gaps.length > 0;
  recordEvent({
    ts: Date.now(),
    run_id: runId,
    agent: "reviewer",
    action: "reviewer_done",
    kind: "decision",
    message: isGap
      ? `Gap emitted: ${result.gaps[0]?.category} — ${result.gaps[0]?.reason}`
      : `Finding produced: ${result.findings[0]?.type}`,
    data: {
      flow,
      findingsCount: result.findings.length,
      gapsCount: result.gaps.length,
      ...(isGap
        ? { gap_category: result.gaps[0]?.category }
        : { finding_type: result.findings[0]?.type }),
    },
    input: { flow, evidenceCount: evidence.length },
    output: {
      findingsCount: result.findings.length,
      gapsCount: result.gaps.length,
    },
    latency_ms: Date.now() - startTs,
    evidence_ids: evidence.map((e) => e.id),
  });

  return result;
}
