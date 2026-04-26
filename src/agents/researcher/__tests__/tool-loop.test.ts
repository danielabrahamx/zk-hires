import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import type { Evidence } from "@/types/evidence";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/trace/store", () => ({
  recordEvent: vi.fn(),
  emitEvent: vi.fn(),
}));

vi.mock("@/agents/researcher/sources/companies-house", () => ({
  companiesHouseLookup: vi.fn(),
}));

vi.mock("@/agents/researcher/sources/web-lookup", () => ({
  webLookup: vi.fn(),
}));

vi.mock("@/agents/researcher/sources/certificate", () => ({
  certificateUpload: vi.fn(),
}));

vi.mock("@/agents/researcher/sources/organizer-profile", () => ({
  lookupOrganizerProfile: vi.fn(),
}));

vi.mock("@/agents/researcher/sources/win-announcement", () => ({
  winAnnouncementLookup: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { runResearcherWithToolUse } from "@/agents/researcher/tool-loop";
import { emitEvent } from "@/trace/store";
import { companiesHouseLookup } from "@/agents/researcher/sources/companies-house";
import { webLookup } from "@/agents/researcher/sources/web-lookup";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: randomUUID(),
    run_id: randomUUID(),
    source: "companies_house",
    retrieved_at: new Date().toISOString(),
    raw_artifact_hash: "0xabc",
    matched_data_points: ["Acme Ltd", "active"],
    signal_type: "company_record",
    organizer_profile: null,
    reputability_score: null,
    confidence_tier: "very_high",
    ...overrides,
  };
}

function toolUseResponse(
  blocks: Array<{ name: string; input: Record<string, unknown> }>
) {
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    content: blocks.map((b) => ({
      type: "tool_use",
      id: `toolu_${randomUUID()}`,
      name: b.name,
      input: b.input,
    })),
    stop_reason: "tool_use",
    stop_sequence: null,
    model: "claude-sonnet-4-6",
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function endTurnResponse() {
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Done." }],
    stop_reason: "end_turn",
    stop_sequence: null,
    model: "claude-sonnet-4-6",
    usage: { input_tokens: 50, output_tokens: 10 },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runResearcherWithToolUse", () => {
  const RUN_ID = "test-run-id";

  // Fake client — created fresh in each test via beforeEach
  let mockFinalMessage: ReturnType<typeof vi.fn>;
  let mockStream: { on: ReturnType<typeof vi.fn>; finalMessage: ReturnType<typeof vi.fn> };
  let mockClient: { messages: { stream: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFinalMessage = vi.fn();
    mockStream = {
      on: vi.fn().mockReturnThis(),
      finalMessage: mockFinalMessage,
    };
    mockClient = {
      messages: {
        stream: vi.fn().mockReturnValue(mockStream),
      },
    };
  });

  it("single-tool happy path: CH lookup → done → returns one Evidence record", async () => {
    const chEvidence = makeEvidence({ source: "companies_house" });
    vi.mocked(companiesHouseLookup).mockResolvedValue(chEvidence);

    // Iteration 1: model calls companies_house_lookup
    // Iteration 2: model calls done
    mockFinalMessage
      .mockResolvedValueOnce(
        toolUseResponse([{ name: "companies_house_lookup", input: { company_number: "12345678" } }])
      )
      .mockResolvedValueOnce(toolUseResponse([{ name: "done", input: {} }]));

    const result = await runResearcherWithToolUse({
      employerInputs: { companyNumber: "12345678" },
      flow: "employer",
      runId: RUN_ID,
      _anthropicClient: mockClient as unknown as Anthropic,
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].source).toBe("companies_house");
    expect(result.evidence[0].id).toBe(chEvidence.id);
    expect(companiesHouseLookup).toHaveBeenCalledWith("12345678", RUN_ID);
  });

  it("multi-tool parallel: CH + web called in same iteration, both Evidence records returned", async () => {
    const chEvidence = makeEvidence({ source: "companies_house" });
    const webEvidence = makeEvidence({ source: "web_lookup", signal_type: "funding_round" });
    vi.mocked(companiesHouseLookup).mockResolvedValue(chEvidence);
    vi.mocked(webLookup).mockResolvedValue(webEvidence);

    // Iteration 1: model calls CH + web in same response (parallel)
    // Iteration 2: model calls done
    mockFinalMessage
      .mockResolvedValueOnce(
        toolUseResponse([
          { name: "companies_house_lookup", input: { company_number: "12345678" } },
          { name: "web_fetch_url", input: { url: "https://example.com" } },
        ])
      )
      .mockResolvedValueOnce(toolUseResponse([{ name: "done", input: {} }]));

    const result = await runResearcherWithToolUse({
      employerInputs: { companyNumber: "12345678", supplementaryUrl: "https://example.com" },
      flow: "employer",
      runId: RUN_ID,
      _anthropicClient: mockClient as unknown as Anthropic,
    });

    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.map((e) => e.source).sort()).toEqual(
      ["companies_house", "web_lookup"].sort()
    );
    expect(companiesHouseLookup).toHaveBeenCalledWith("12345678", RUN_ID);
    expect(webLookup).toHaveBeenCalledWith("https://example.com", RUN_ID);
  });

  it("tool failure: emits error event, loop continues, result excludes failed Evidence", async () => {
    vi.mocked(companiesHouseLookup).mockRejectedValue(new Error("CH API down"));

    // Iteration 1: model calls CH → error is returned as tool_result
    // Iteration 2: model sees error, calls done
    mockFinalMessage
      .mockResolvedValueOnce(
        toolUseResponse([{ name: "companies_house_lookup", input: { company_number: "12345678" } }])
      )
      .mockResolvedValueOnce(toolUseResponse([{ name: "done", input: {} }]));

    const result = await runResearcherWithToolUse({
      employerInputs: { companyNumber: "12345678" },
      flow: "employer",
      runId: RUN_ID,
      _anthropicClient: mockClient as unknown as Anthropic,
    });

    // Evidence is empty because the only tool call failed
    expect(result.evidence).toHaveLength(0);

    // Error event should have been emitted
    const calls = vi.mocked(emitEvent).mock.calls;
    const errorCall = calls.find(
      ([arg]) => arg.kind === "error" && arg.agent === "researcher.companies_house"
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![0].error).toContain("CH API down");

    // The loop must have continued (done was called, meaning we got two stream iterations)
    expect(mockFinalMessage).toHaveBeenCalledTimes(2);
  });

  it("emits plan event at start and decision event at end", async () => {
    const chEvidence = makeEvidence({ source: "companies_house" });
    vi.mocked(companiesHouseLookup).mockResolvedValue(chEvidence);

    mockFinalMessage
      .mockResolvedValueOnce(
        toolUseResponse([{ name: "companies_house_lookup", input: { company_number: "00000001" } }])
      )
      .mockResolvedValueOnce(toolUseResponse([{ name: "done", input: {} }]));

    await runResearcherWithToolUse({
      employerInputs: { companyNumber: "00000001" },
      flow: "employer",
      runId: RUN_ID,
      _anthropicClient: mockClient as unknown as Anthropic,
    });

    const calls = vi.mocked(emitEvent).mock.calls.map(([arg]) => arg);
    expect(calls.some((e) => e.kind === "plan" && e.agent === "researcher.planner")).toBe(true);
    expect(calls.some((e) => e.kind === "decision" && e.agent === "researcher.planner")).toBe(true);
  });

  it("exits loop on end_turn without explicit done call", async () => {
    const chEvidence = makeEvidence({ source: "companies_house" });
    vi.mocked(companiesHouseLookup).mockResolvedValue(chEvidence);

    // Iteration 1: CH tool use
    // Iteration 2: end_turn (no done tool)
    mockFinalMessage
      .mockResolvedValueOnce(
        toolUseResponse([{ name: "companies_house_lookup", input: { company_number: "12345678" } }])
      )
      .mockResolvedValueOnce(endTurnResponse());

    const result = await runResearcherWithToolUse({
      employerInputs: { companyNumber: "12345678" },
      flow: "employer",
      runId: RUN_ID,
      _anthropicClient: mockClient as unknown as Anthropic,
    });

    expect(result.evidence).toHaveLength(1);
    expect(mockFinalMessage).toHaveBeenCalledTimes(2);
  });
});
