import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";
import type { Gap } from "@/types/gap";

// Mock at module level — vitest hoists these
vi.mock("@/agents/researcher", () => ({ runResearcher: vi.fn() }));
vi.mock("@/agents/reviewer", () => ({ runReviewer: vi.fn() }));
vi.mock("@/trace/store", () => ({ emitEvent: vi.fn() }));

import { runCoordinator } from "@/agents/coordinator";
import { runResearcher } from "@/agents/researcher";
import { runReviewer } from "@/agents/reviewer";

const mockEvidence = (id: string): Evidence =>
  ({
    id,
    source: "certificate",
    source_url: null,
    signal_type: "certificate",
    confidence_tier: "high",
    matched_data_points: [],
    retrieved_at: new Date().toISOString(),
  }) as unknown as Evidence;

const mockFinding = (): Finding =>
  ({
    id: "f1",
    run_id: "r1",
    type: "hackathon_wins",
    count: 1,
    confidence_tier: "high",
    evidence_ids: ["e1"],
  }) as unknown as Finding;

const mockGap = (category: string, missing_evidence: string[] = []): Gap =>
  ({
    claim_type: "hackathon_wins",
    category,
    reason: `Gap: ${category}`,
    what_we_tried: [],
    why_not_found: [],
    sources_checked: [],
    missing_evidence,
  }) as unknown as Gap;

const candidateInput = {
  flow: "candidate" as const,
  researcherInput: { claim_type: "hackathon_wins" as const, postLinks: ["https://example.com"] },
  runId: "test-run",
  emit: vi.fn(),
};

describe("runCoordinator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns Finding immediately when first Researcher + Reviewer succeeds", async () => {
    vi.mocked(runResearcher).mockResolvedValue({ evidence: [mockEvidence("e1")], runId: "test-run" });
    vi.mocked(runReviewer).mockResolvedValue({ findings: [mockFinding()], gaps: [] });

    const result = await runCoordinator(candidateInput);

    expect(result.findings).toHaveLength(1);
    expect(result.gaps).toHaveLength(0);
    expect(result.iterations).toBe(1);
    expect(runResearcher).toHaveBeenCalledTimes(1);
    expect(runReviewer).toHaveBeenCalledTimes(1);
  });

  it("retries once on retryable gap and succeeds on second pass", async () => {
    vi.mocked(runResearcher)
      .mockResolvedValueOnce({ evidence: [mockEvidence("e1")], runId: "test-run" })
      .mockResolvedValueOnce({ evidence: [mockEvidence("e2")], runId: "test-run" });
    vi.mocked(runReviewer)
      .mockResolvedValueOnce({ findings: [], gaps: [mockGap("insufficient_evidence", ["LinkedIn post"])] })
      .mockResolvedValueOnce({ findings: [mockFinding()], gaps: [] });

    const result = await runCoordinator(candidateInput);

    expect(result.findings).toHaveLength(1);
    expect(result.iterations).toBe(2);
    // Reviewer must receive BOTH evidence records on second call (accumulation)
    expect(vi.mocked(runReviewer).mock.calls[1]![0]).toHaveLength(2);
    // Researcher must receive contextHints on retry
    expect(vi.mocked(runResearcher).mock.calls[1]![0]).toMatchObject({
      contextHints: ["LinkedIn post"],
    });
  });

  it("does not retry on non-retryable gap", async () => {
    vi.mocked(runResearcher).mockResolvedValue({ evidence: [mockEvidence("e1")], runId: "test-run" });
    vi.mocked(runReviewer).mockResolvedValue({
      findings: [],
      gaps: [mockGap("ocr_failure")],
    });

    const result = await runCoordinator(candidateInput);

    expect(result.findings).toHaveLength(0);
    expect(result.gaps[0]?.category).toBe("ocr_failure");
    expect(result.iterations).toBe(1);
    expect(runResearcher).toHaveBeenCalledTimes(1);
  });

  it("stops after MAX_ITERATIONS even if gap is retryable", async () => {
    vi.mocked(runResearcher).mockResolvedValue({ evidence: [mockEvidence("e1")], runId: "test-run" });
    vi.mocked(runReviewer).mockResolvedValue({
      findings: [],
      gaps: [mockGap("insufficient_evidence", ["more data"])],
    });

    const result = await runCoordinator(candidateInput);

    expect(result.findings).toHaveLength(0);
    expect(runResearcher).toHaveBeenCalledTimes(2); // MAX_ITERATIONS = 2
    expect(result.iterations).toBe(2);
  });

  it("deduplicates evidence with the same id across iterations", async () => {
    const sharedEvidence = mockEvidence("e1");
    vi.mocked(runResearcher)
      .mockResolvedValueOnce({ evidence: [sharedEvidence], runId: "test-run" })
      .mockResolvedValueOnce({ evidence: [sharedEvidence, mockEvidence("e2")], runId: "test-run" });
    vi.mocked(runReviewer)
      .mockResolvedValueOnce({ findings: [], gaps: [mockGap("insufficient_evidence", ["x"])] })
      .mockResolvedValueOnce({ findings: [mockFinding()], gaps: [] });

    const result = await runCoordinator(candidateInput);

    // e1 deduplicated, so total is 2 not 3
    expect(result.evidence).toHaveLength(2);
  });
});
