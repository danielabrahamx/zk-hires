import { runResearcher, type ResearcherInput, type StepEmitter } from "@/agents/researcher";
import { runReviewer } from "@/agents/reviewer";
import { emitEvent } from "@/trace/store";
import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";
import type { Gap, GapCategory } from "@/types/gap";

const MAX_ITERATIONS = 2;
const RETRYABLE_GAPS = new Set<GapCategory>(["insufficient_evidence", "low_confidence"]);

export interface CoordinatorInput {
  flow: "candidate" | "employer";
  researcherInput: ResearcherInput;
  runId: string;
  emit: StepEmitter;
}

export interface CoordinatorResult {
  evidence: Evidence[];
  findings: Finding[];
  gaps: Gap[];
  iterations: number;
}

export async function runCoordinator(input: CoordinatorInput): Promise<CoordinatorResult> {
  const { flow, runId, emit } = input;
  const allEvidence: Evidence[] = [];
  let lastGap: Gap | null = null;
  let researcherInput = input.researcherInput;
  let completedIterations = 0;

  emitEvent({
    run_id: runId,
    agent: "coordinator",
    kind: "plan",
    message: `Coordinator starting — ${flow} flow, max ${MAX_ITERATIONS} iteration(s)`,
    data: { flow, maxIterations: MAX_ITERATIONS },
  });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    completedIterations = iteration + 1;
    emitEvent({
      run_id: runId,
      agent: "coordinator",
      kind: "plan",
      message: `Iteration ${iteration + 1}: dispatching Researcher`,
      data: { iteration },
    });

    const research = await runResearcher(researcherInput, emit, runId);

    const seen = new Set(allEvidence.map((e) => e.id));
    for (const ev of research.evidence) {
      if (!seen.has(ev.id)) {
        allEvidence.push(ev);
        seen.add(ev.id);
      }
    }

    emitEvent({
      run_id: runId,
      agent: "coordinator",
      kind: "tool_result",
      message: `Iteration ${iteration + 1}: Researcher complete — ${allEvidence.length} evidence record(s) accumulated`,
      data: { iteration, evidenceCount: allEvidence.length },
    });

    emitEvent({
      run_id: runId,
      agent: "coordinator",
      kind: "plan",
      message: `Iteration ${iteration + 1}: dispatching Reviewer with ${allEvidence.length} evidence record(s)`,
      data: { iteration, evidenceCount: allEvidence.length },
    });

    const review = await runReviewer(allEvidence, flow, runId);

    if (review.findings.length > 0) {
      emitEvent({
        run_id: runId,
        agent: "coordinator",
        kind: "decision",
        message: `Coordinator done — Finding produced after ${iteration + 1} iteration(s)`,
        data: { iterations: iteration + 1, findingType: review.findings[0]?.type },
      });
      return { evidence: allEvidence, findings: review.findings, gaps: [], iterations: iteration + 1 };
    }

    lastGap = review.gaps[0] ?? null;
    const isRetryable = lastGap !== null && RETRYABLE_GAPS.has(lastGap.category);

    emitEvent({
      run_id: runId,
      agent: "coordinator",
      kind: "decision",
      message: `Iteration ${iteration + 1}: Gap — ${lastGap?.category}. ${isRetryable && iteration < MAX_ITERATIONS - 1 ? "Will retry." : "Stopping."}`,
      data: { iteration, gapCategory: lastGap?.category, isRetryable },
    });

    if (!isRetryable || iteration >= MAX_ITERATIONS - 1) break;

    const contextHints = lastGap?.missing_evidence ?? [];
    emit(`Reviewer needs more evidence — retrying with ${contextHints.length} hint(s)...`);
    researcherInput = { ...researcherInput, contextHints };
  }

  emitEvent({
    run_id: runId,
    agent: "coordinator",
    kind: "decision",
    message: `Coordinator done — Gap after ${completedIterations} iteration(s): ${lastGap?.category}`,
    data: { iterations: completedIterations, gapCategory: lastGap?.category },
  });

  return {
    evidence: allEvidence,
    findings: [],
    gaps: lastGap ? [lastGap] : [],
    iterations: completedIterations,
  };
}
