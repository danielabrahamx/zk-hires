import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/trace/store", () => ({ recordEvent: vi.fn(), emitEvent: vi.fn() }));

vi.mock("@/agents/researcher/tool-loop", () => ({
  runResearcherWithToolUse: vi.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { runResearcher } from "@/agents/researcher";
import { runResearcherWithToolUse } from "@/agents/researcher/tool-loop";
import type { Evidence } from "@/types/evidence";
import { randomUUID } from "node:crypto";

// ─── Fixture ──────────────────────────────────────────────────────────────────

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: randomUUID(),
    run_id: randomUUID(),
    source: "companies_house",
    retrieved_at: new Date().toISOString(),
    raw_artifact_hash: "abc123",
    matched_data_points: ["ACME Ltd"],
    signal_type: "company_record",
    organizer_profile: null,
    reputability_score: null,
    confidence_tier: "very_high",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runResearcher - candidate flow (hackathon_wins)", () => {
  beforeEach(() => {
    vi.mocked(runResearcherWithToolUse).mockReset();
  });

  it("routes to tool-loop with candidate inputs and returns evidence", async () => {
    const ev = makeEvidence({ source: "certificate", signal_type: "certificate" });
    vi.mocked(runResearcherWithToolUse).mockResolvedValueOnce({ evidence: [ev] });

    const result = await runResearcher({
      claim_type: "hackathon_wins",
      file: Buffer.from("pdf"),
      mimeType: "application/pdf",
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].id).toBe(ev.id);
    expect(typeof result.runId).toBe("string");
    expect(result.runId.length).toBeGreaterThan(0);

    expect(vi.mocked(runResearcherWithToolUse)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runResearcherWithToolUse).mock.calls[0][0];
    expect(call.flow).toBe("candidate");
    expect(call.candidateInputs?.mimeType).toBe("application/pdf");
  });

  it("routes candidate flow with post links only", async () => {
    const ev = makeEvidence({ source: "web_lookup", signal_type: "funding_round" });
    vi.mocked(runResearcherWithToolUse).mockResolvedValueOnce({ evidence: [ev] });

    const result = await runResearcher({
      claim_type: "hackathon_wins",
      postLinks: ["https://devpost.com/foo"],
    });

    expect(result.evidence).toHaveLength(1);
    const call = vi.mocked(runResearcherWithToolUse).mock.calls[0][0];
    expect(call.flow).toBe("candidate");
    expect(call.candidateInputs?.postLinks).toEqual(["https://devpost.com/foo"]);
  });

  it("propagates errors thrown by runResearcherWithToolUse", async () => {
    vi.mocked(runResearcherWithToolUse).mockRejectedValueOnce(new Error("OCR failed"));

    await expect(
      runResearcher({
        claim_type: "hackathon_wins",
        file: Buffer.from("garbage"),
        mimeType: "application/pdf",
      })
    ).rejects.toThrow("OCR failed");
  });
});

describe("runResearcher - employer flow (reputable_company)", () => {
  beforeEach(() => {
    vi.mocked(runResearcherWithToolUse).mockReset();
  });

  it("routes to tool-loop with employer inputs and returns evidence", async () => {
    const chEv = makeEvidence({ source: "companies_house" });
    const webEv = makeEvidence({ source: "web_lookup", signal_type: "funding_round" });
    vi.mocked(runResearcherWithToolUse).mockResolvedValueOnce({ evidence: [chEv, webEv] });

    const result = await runResearcher({
      claim_type: "reputable_company",
      companyNumber: "00000006",
      supplementaryUrl: "https://sibrox.com",
    });

    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.map((e) => e.source).sort()).toEqual(["companies_house", "web_lookup"]);
    expect(typeof result.runId).toBe("string");

    const call = vi.mocked(runResearcherWithToolUse).mock.calls[0][0];
    expect(call.flow).toBe("employer");
    expect(call.employerInputs?.companyNumber).toBe("00000006");
    expect(call.employerInputs?.supplementaryUrl).toBe("https://sibrox.com");
  });

  it("propagates errors thrown by runResearcherWithToolUse", async () => {
    vi.mocked(runResearcherWithToolUse).mockRejectedValueOnce(new Error("CH API down"));

    await expect(
      runResearcher({
        claim_type: "reputable_company",
        companyNumber: "99999999",
      })
    ).rejects.toThrow("CH API down");
  });
});
