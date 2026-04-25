import { randomUUID } from "node:crypto";

import { companiesHouseLookup } from "@/agents/researcher/sources/companies-house";
import { webLookup } from "@/agents/researcher/sources/web-lookup";
import { certificateUpload } from "@/agents/researcher/sources/certificate";
import { lookupOrganizerProfile } from "@/agents/researcher/sources/organizer-profile";
import { recordEvent } from "@/trace/store";
import { EvidenceSchema, type Evidence } from "@/types/evidence";

/**
 * Researcher orchestrator.
 *
 * Two flavours:
 *  - "hackathon_wins": certificate OCR then optional organizer profile enrichment.
 *  - "reputable_company": Companies House + web-lookup (any URL) run in parallel.
 */

export type ResearcherInput =
  | { claim_type: "hackathon_wins"; file: Buffer; mimeType: string }
  | {
      claim_type: "reputable_company";
      companyNumber: string;
      supplementaryUrl: string;
    };

export interface ResearcherResult {
  evidence: Evidence[];
  runId: string;
}

export async function runResearcher(
  input: ResearcherInput
): Promise<ResearcherResult> {
  const runId = randomUUID();
  if (input.claim_type === "hackathon_wins") {
    return runCandidateFlow(input, runId);
  }
  return runEmployerFlow(input, runId);
}

async function runCandidateFlow(
  input: Extract<ResearcherInput, { claim_type: "hackathon_wins" }>,
  runId: string
): Promise<ResearcherResult> {
  const certStart = Date.now();
  recordEvent({
    ts: certStart,
    run_id: runId,
    agent: "researcher",
    action: "certificate_start",
    input: { mimeType: input.mimeType },
    output: null,
    latency_ms: 0,
    evidence_ids: [],
  });

  let certEvidence: Evidence;
  try {
    certEvidence = await certificateUpload(input.file, input.mimeType, runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordEvent({
      ts: Date.now(),
      run_id: runId,
      agent: "researcher",
      action: "certificate_done",
      input: { mimeType: input.mimeType },
      output: null,
      latency_ms: Date.now() - certStart,
      error: message,
      evidence_ids: [],
    });
    throw err;
  }

  recordEvent({
    ts: Date.now(),
    run_id: runId,
    agent: "researcher",
    action: "certificate_done",
    input: { mimeType: input.mimeType },
    output: { id: certEvidence.id, signal_type: certEvidence.signal_type },
    latency_ms: Date.now() - certStart,
    evidence_ids: [certEvidence.id],
  });

  const organizerName = certEvidence.notes?.trim() ?? "";
  if (organizerName.length === 0) {
    return { evidence: [certEvidence], runId };
  }

  const profStart = Date.now();
  recordEvent({
    ts: profStart,
    run_id: runId,
    agent: "researcher",
    action: "organizer_profile_start",
    input: { organizer: organizerName },
    output: null,
    latency_ms: 0,
    evidence_ids: [certEvidence.id],
  });

  try {
    const profile = await lookupOrganizerProfile(organizerName);

    recordEvent({
      ts: Date.now(),
      run_id: runId,
      agent: "researcher",
      action: "organizer_profile_done",
      input: { organizer: organizerName },
      output: { handle: profile.handle, platform: profile.platform },
      latency_ms: Date.now() - profStart,
      evidence_ids: [certEvidence.id],
    });

    const enriched: Evidence = EvidenceSchema.parse({
      ...certEvidence,
      organizer_profile: profile,
    });
    return { evidence: [enriched], runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordEvent({
      ts: Date.now(),
      run_id: runId,
      agent: "researcher",
      action: "organizer_profile_done",
      input: { organizer: organizerName },
      output: null,
      latency_ms: Date.now() - profStart,
      error: message,
      evidence_ids: [certEvidence.id],
    });
    // Organizer profile is enrichment only - degrade gracefully.
    return { evidence: [certEvidence], runId };
  }
}

async function runEmployerFlow(
  input: Extract<ResearcherInput, { claim_type: "reputable_company" }>,
  runId: string
): Promise<ResearcherResult> {
  const startTs = Date.now();

  recordEvent({
    ts: startTs,
    run_id: runId,
    agent: "researcher",
    action: "companies_house_start",
    input: { companyNumber: input.companyNumber },
    output: null,
    latency_ms: 0,
    evidence_ids: [],
  });
  recordEvent({
    ts: startTs,
    run_id: runId,
    agent: "researcher",
    action: "web_lookup_start",
    input: { url: input.supplementaryUrl },
    output: null,
    latency_ms: 0,
    evidence_ids: [],
  });

  let chEvidence: Evidence;
  let webEvidence: Evidence;
  try {
    [chEvidence, webEvidence] = await Promise.all([
      companiesHouseLookup(input.companyNumber, runId),
      webLookup(input.supplementaryUrl, runId),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordEvent({
      ts: Date.now(),
      run_id: runId,
      agent: "researcher",
      action: "employer_lookup_failed",
      input: { companyNumber: input.companyNumber, url: input.supplementaryUrl },
      output: null,
      latency_ms: Date.now() - startTs,
      error: message,
      evidence_ids: [],
    });
    throw err;
  }

  const doneTs = Date.now();
  recordEvent({
    ts: doneTs,
    run_id: runId,
    agent: "researcher",
    action: "companies_house_done",
    input: { companyNumber: input.companyNumber },
    output: { id: chEvidence.id, confidence_tier: chEvidence.confidence_tier },
    latency_ms: doneTs - startTs,
    evidence_ids: [chEvidence.id],
  });
  recordEvent({
    ts: doneTs,
    run_id: runId,
    agent: "researcher",
    action: "web_lookup_done",
    input: { url: input.supplementaryUrl },
    output: { id: webEvidence.id, confidence_tier: webEvidence.confidence_tier },
    latency_ms: doneTs - startTs,
    evidence_ids: [webEvidence.id],
  });

  return { evidence: [chEvidence, webEvidence], runId };
}
