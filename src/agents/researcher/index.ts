import { randomUUID } from "node:crypto";

import { companiesHouseLookup } from "@/agents/researcher/sources/companies-house";
import { webLookup } from "@/agents/researcher/sources/web-lookup";
import { certificateUpload } from "@/agents/researcher/sources/certificate";
import { lookupOrganizerProfile } from "@/agents/researcher/sources/organizer-profile";
import { winAnnouncementLookup } from "@/agents/researcher/sources/win-announcement";
import { recordEvent } from "@/trace/store";
import { EvidenceSchema, type Evidence } from "@/types/evidence";

/**
 * Researcher orchestrator.
 *
 * Two flavours:
 *  - "hackathon_wins": certificate file, social/web links, or both. Either path alone is sufficient.
 *  - "reputable_company": Companies House + web-lookup (any URL) run in parallel.
 */

export type StepEmitter = (label: string) => void;

export type ResearcherInput =
  | { claim_type: "hackathon_wins"; file: Buffer; mimeType: string; postLinks?: string[] }
  | { claim_type: "hackathon_wins"; postLinks: string[] }
  | {
      claim_type: "reputable_company";
      companyNumber?: string;
      supplementaryUrl?: string;
    };

export interface ResearcherResult {
  evidence: Evidence[];
  runId: string;
}

export async function runResearcher(
  input: ResearcherInput,
  emit: StepEmitter = () => {}
): Promise<ResearcherResult> {
  const runId = randomUUID();

  const { runResearcherWithToolUse } = await import("./tool-loop");
  if (input.claim_type === "hackathon_wins") {
    const candidateInputs = {
      file: "file" in input ? input.file : undefined,
      mimeType: "file" in input ? input.mimeType : undefined,
      postLinks: input.postLinks,
    };
    const result = await runResearcherWithToolUse({ candidateInputs, flow: "candidate", runId });
    return { ...result, runId };
  } else {
    const result = await runResearcherWithToolUse({
      employerInputs: {
        companyNumber: input.companyNumber,
        supplementaryUrl: input.supplementaryUrl,
      },
      flow: "employer",
      runId,
    });
    return { ...result, runId };
  }
}

async function runCandidateFlow(
  input: Extract<ResearcherInput, { claim_type: "hackathon_wins" }>,
  runId: string,
  emit: StepEmitter
): Promise<ResearcherResult> {
  const allEvidence: Evidence[] = [];

  // Certificate path (optional when links are provided)
  if ("file" in input && input.file) {
    const certStart = Date.now();
    emit("Reading certificate...");
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
      // Only rethrow if there are no links to fall back on
      if (!input.postLinks?.length) throw err;
      certEvidence = null as unknown as Evidence;
    }

    if (certEvidence) {
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
      let enriched = certEvidence;

      if (organizerName.length > 0) {
        const profStart = Date.now();
        emit(`Looking up "${organizerName}" on social platforms...`);
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
          enriched = EvidenceSchema.parse({ ...certEvidence, organizer_profile: profile });
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
        }
      }

      allEvidence.push(enriched);
    }
  }

  // Links path — win announcement lookup for each URL (runs in parallel)
  if (input.postLinks && input.postLinks.length > 0) {
    const n = input.postLinks.length;
    emit(`Fetching ${n} supporting link${n > 1 ? "s" : ""}...`);
    const linkStart = Date.now();
    recordEvent({
      ts: linkStart,
      run_id: runId,
      agent: "researcher",
      action: "win_announcement_start",
      input: { urls: input.postLinks },
      output: null,
      latency_ms: 0,
      evidence_ids: [],
    });

    const settled = await Promise.allSettled(
      input.postLinks.map((url) => winAnnouncementLookup(url, runId))
    );
    const linkEvidence: Evidence[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") linkEvidence.push(r.value);
    }

    recordEvent({
      ts: Date.now(),
      run_id: runId,
      agent: "researcher",
      action: "win_announcement_done",
      input: { urls: input.postLinks },
      output: { count: linkEvidence.length },
      latency_ms: Date.now() - linkStart,
      evidence_ids: linkEvidence.map((e) => e.id),
    });

    allEvidence.push(...linkEvidence);
  }

  return { evidence: allEvidence, runId };
}

async function runEmployerFlow(
  input: Extract<ResearcherInput, { claim_type: "reputable_company" }>,
  runId: string,
  emit: StepEmitter
): Promise<ResearcherResult> {
  const startTs = Date.now();

  const lookups: Array<Promise<Evidence>> = [];
  const lookupTypes: Array<"ch" | "web"> = [];

  if (input.companyNumber) {
    emit(`Looking up company ${input.companyNumber} on Companies House...`);
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
    lookups.push(companiesHouseLookup(input.companyNumber, runId));
    lookupTypes.push("ch");
  }

  if (input.supplementaryUrl) {
    const host = (() => { try { return new URL(input.supplementaryUrl).hostname; } catch { return input.supplementaryUrl; } })();
    emit(`Analysing ${host}...`);
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
    lookups.push(webLookup(input.supplementaryUrl, runId));
    lookupTypes.push("web");
  }

  let results: Evidence[];
  try {
    results = await Promise.all(lookups);
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
  results.forEach((ev, i) => {
    if (lookupTypes[i] === "ch") {
      recordEvent({
        ts: doneTs,
        run_id: runId,
        agent: "researcher",
        action: "companies_house_done",
        input: { companyNumber: input.companyNumber },
        output: { id: ev.id, confidence_tier: ev.confidence_tier },
        latency_ms: doneTs - startTs,
        evidence_ids: [ev.id],
      });
    } else {
      recordEvent({
        ts: doneTs,
        run_id: runId,
        agent: "researcher",
        action: "web_lookup_done",
        input: { url: input.supplementaryUrl },
        output: { id: ev.id, confidence_tier: ev.confidence_tier },
        latency_ms: doneTs - startTs,
        evidence_ids: [ev.id],
      });
    }
  });

  return { evidence: results, runId };
}
