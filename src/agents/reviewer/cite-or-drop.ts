import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";
import { emitEvent } from "@/trace/store";

/**
 * Cite-or-drop enforcement.
 *
 * Spec §6 / §10. Every Finding must cite at least one Evidence by id, and
 * every cited id must exist in the run's Evidence set. Findings whose
 * citations don't fully resolve are dropped silently here; the caller is
 * responsible for converting drops into Gaps.
 *
 * Tracing: when a finding is dropped, emit a `decision` event under
 * `reviewer.cite_or_drop` recording which evidence_ids failed to resolve.
 */

export function enforceCitations(
  findings: Finding[],
  evidence: Evidence[],
  runId?: string
): Finding[] {
  const validIds = new Set(evidence.map((e) => e.id));
  const survivors: Finding[] = [];

  for (const finding of findings) {
    const missing = finding.evidence_ids.filter((id) => !validIds.has(id));
    if (missing.length === 0) {
      survivors.push(finding);
      continue;
    }
    if (runId) {
      emitEvent({
        run_id: runId,
        agent: "reviewer.cite_or_drop",
        kind: "decision",
        message: `dropped:${finding.type}`,
        data: {
          finding_id: finding.id,
          finding_type: finding.type,
          unresolved_evidence_ids: missing,
          known_evidence_ids: Array.from(validIds),
        },
        evidence_ids: finding.evidence_ids,
      });
    }
  }

  return survivors;
}
