import { randomUUID } from "node:crypto";

import {
  companiesHouseLookup,
} from "@/agents/researcher/sources/companies-house";
import {
  crunchbaseLookup,
} from "@/agents/researcher/sources/crunchbase";
import {
  certificateUpload,
} from "@/agents/researcher/sources/certificate";
import {
  lookupOrganizerProfile,
} from "@/agents/researcher/sources/organizer-profile";
import { recordEvent } from "@/trace/store";
import {
  EvidenceSchema,
  type Evidence,
} from "@/types/evidence";

/**
 * Researcher orchestrator.
 *
 * Coordinates the four Phase 2 source modules into a single agent flow.
 * Two flavours:
 *  - "hackathon_wins": runs certificate OCR, then enriches the resulting
 *    Evidence with an organizer profile lookup if the certificate yielded
 *    an organizer name.
 *  - "reputable_company": runs Companies House and Crunchbase lookups
 *    in parallel.
 *
 * Every external call is bookended by a TraceEvent (start + done). On
 * failure, an error TraceEvent is emitted and the error is re-thrown so
 * the caller (Reviewer / API route) can decide how to surface it.
 */

export type ResearcherInput =
  | { claim_type: "hackathon_wins"; file: Buffer; mimeType: string }
  | {
      claim_type: "reputable_company";
      companyNumber: string;
      crunchbaseSlugOrUrl: string;
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
    certEvidence = await certificateUpload(
      input.file,
      input.mimeType,
      runId
    );
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
    // Organizer profile is enrichment - if it fails, return the
    // unenriched certificate evidence rather than failing the whole run.
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
    action: "crunchbase_start",
    input: { slugOrUrl: input.crunchbaseSlugOrUrl },
    output: null,
    latency_ms: 0,
    evidence_ids: [],
  });

  let chEvidence: Evidence;
  let cbEvidence: Evidence;
  try {
    [chEvidence, cbEvidence] = await Promise.all([
      companiesHouseLookup(input.companyNumber, runId),
      crunchbaseLookup(input.crunchbaseSlugOrUrl, runId),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordEvent({
      ts: Date.now(),
      run_id: runId,
      agent: "researcher",
      action: "employer_lookup_failed",
      input: {
        companyNumber: input.companyNumber,
        slugOrUrl: input.crunchbaseSlugOrUrl,
      },
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
    output: {
      id: chEvidence.id,
      confidence_tier: chEvidence.confidence_tier,
    },
    latency_ms: doneTs - startTs,
    evidence_ids: [chEvidence.id],
  });
  recordEvent({
    ts: doneTs,
    run_id: runId,
    agent: "researcher",
    action: "crunchbase_done",
    input: { slugOrUrl: input.crunchbaseSlugOrUrl },
    output: {
      id: cbEvidence.id,
      confidence_tier: cbEvidence.confidence_tier,
    },
    latency_ms: doneTs - startTs,
    evidence_ids: [cbEvidence.id],
  });

  return { evidence: [chEvidence, cbEvidence], runId };
}
