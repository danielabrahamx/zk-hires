import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { enforceCitations } from "@/agents/reviewer/cite-or-drop";
import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";

function evidence(id: string): Evidence {
  return {
    id,
    run_id: randomUUID(),
    source: "certificate",
    retrieved_at: new Date().toISOString(),
    raw_artifact_hash: "0xabc",
    matched_data_points: [],
    signal_type: "certificate",
    organizer_profile: null,
    reputability_score: null,
    confidence_tier: "high",
  };
}

function hackathonFinding(evidence_ids: string[]): Finding {
  return {
    id: randomUUID(),
    run_id: randomUUID(),
    type: "hackathon_wins",
    count: evidence_ids.length,
    evidence_ids,
    confidence_tier: "high",
  };
}

describe("enforceCitations", () => {
  it("keeps findings whose evidence_ids all resolve", () => {
    const e1 = randomUUID();
    const e2 = randomUUID();
    const ev = [evidence(e1), evidence(e2)];
    const findings = [hackathonFinding([e1]), hackathonFinding([e2])];

    expect(enforceCitations(findings, ev)).toHaveLength(2);
  });

  it("drops findings whose evidence_ids include unknown ids", () => {
    const e1 = randomUUID();
    const ev = [evidence(e1)];
    const validFinding = hackathonFinding([e1]);
    const invalidFinding = hackathonFinding([e1, randomUUID()]);

    const survivors = enforceCitations(
      [validFinding, invalidFinding],
      ev
    );
    expect(survivors).toHaveLength(1);
    expect(survivors[0]).toEqual(validFinding);
  });

  it("drops everything when evidence is empty", () => {
    const findings = [hackathonFinding([randomUUID()])];
    expect(enforceCitations(findings, [])).toHaveLength(0);
  });
});
