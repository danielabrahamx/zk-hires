import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";

/**
 * Cite-or-drop enforcement.
 *
 * Spec §6 / §10. Every Finding must cite at least one Evidence by id, and
 * every cited id must exist in the run's Evidence set. Findings whose
 * citations don't fully resolve are dropped silently here; the caller is
 * responsible for converting drops into Gaps.
 */

export function enforceCitations(
  findings: Finding[],
  evidence: Evidence[]
): Finding[] {
  const validIds = new Set(evidence.map((e) => e.id));
  return findings.filter((finding) =>
    finding.evidence_ids.every((id) => validIds.has(id))
  );
}
