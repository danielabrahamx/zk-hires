import { randomUUID } from "node:crypto";

import type { Evidence } from "@/types/evidence";

/**
 * Researcher orchestrator.
 *
 * Two flavours:
 *  - "hackathon_wins": certificate file, social/web links, or both. Either path alone is sufficient.
 *  - "reputable_company": Companies House + web-lookup (any URL) run in parallel.
 */

export type StepEmitter = (label: string) => void;

export type ResearcherInput =
  | { claim_type: "hackathon_wins"; file: Buffer; mimeType: string; postLinks?: string[]; contextHints?: string[] }
  | { claim_type: "hackathon_wins"; postLinks: string[]; contextHints?: string[] }
  | {
      claim_type: "reputable_company";
      companyNumber?: string;
      supplementaryUrl?: string;
      contextHints?: string[];
    };

export interface ResearcherResult {
  evidence: Evidence[];
  runId: string;
}

export async function runResearcher(
  input: ResearcherInput,
  presetRunId?: string
): Promise<ResearcherResult> {
  const runId = presetRunId ?? randomUUID();

  const { runResearcherWithToolUse } = await import("./tool-loop");
  if (input.claim_type === "hackathon_wins") {
    const candidateInputs = {
      file: "file" in input ? input.file : undefined,
      mimeType: "file" in input ? input.mimeType : undefined,
      postLinks: input.postLinks,
    };
    const result = await runResearcherWithToolUse({ candidateInputs, flow: "candidate", runId, contextHints: input.contextHints });
    return { ...result, runId };
  } else {
    const result = await runResearcherWithToolUse({
      employerInputs: {
        companyNumber: input.companyNumber,
        supplementaryUrl: input.supplementaryUrl,
      },
      flow: "employer",
      runId,
      contextHints: input.contextHints,
    });
    return { ...result, runId };
  }
}
