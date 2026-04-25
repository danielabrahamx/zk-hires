import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordEvent, getEventsByRunId, merkleRootForRun, _resetTraceStore } from "../store";
import type { TraceEvent } from "../events";

const tmpRoot = mkdtempSync(join(tmpdir(), "zkh-traces-"));
process.env.TRACES_DB_PATH = join(tmpRoot, "traces.db");

const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeEvent(runId: string, i: number): TraceEvent {
  return {
    ts: 1714000000000 + i,
    run_id: runId,
    agent: "researcher",
    action: `step_${i}`,
    input: { url: `https://example.com/${i}` },
    output: { ok: true, n: i },
    latency_ms: 12 + i,
    evidence_ids: [`ev-${i}`],
  };
}

beforeEach(() => {
  // Use a fresh DB file per test so writes don't bleed across.
  _resetTraceStore();
  process.env.TRACES_DB_PATH = join(
    mkdtempSync(join(tmpRoot, "case-")),
    "traces.db",
  );
});

afterAll(() => {
  _resetTraceStore();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("trace store", () => {
  it("round-trips 5 events: write then read by run_id", () => {
    for (let i = 0; i < 5; i++) recordEvent(makeEvent(RUN_A, i));
    const rows = getEventsByRunId(RUN_A);
    expect(rows.length).toBe(5);
    expect(rows[0].action).toBe("step_0");
    expect(rows[4].action).toBe("step_4");
    expect(rows[2].input).toEqual({ url: "https://example.com/2" });
    expect(rows[2].output).toEqual({ ok: true, n: 2 });
    expect(rows[2].evidence_ids).toEqual(["ev-2"]);
  });

  it("filters by run_id", () => {
    for (let i = 0; i < 3; i++) recordEvent(makeEvent(RUN_A, i));
    for (let i = 0; i < 2; i++) recordEvent(makeEvent(RUN_B, i));
    expect(getEventsByRunId(RUN_A).length).toBe(3);
    expect(getEventsByRunId(RUN_B).length).toBe(2);
    expect(getEventsByRunId("does-not-exist").length).toBe(0);
  });

  it("preserves error and optional fields through JSON round-trip", () => {
    const ev: TraceEvent = {
      ts: 1714000000000,
      run_id: RUN_A,
      agent: "reviewer",
      action: "score",
      input: { evidence: 1 },
      output: null,
      latency_ms: 5,
      error: "boom",
      evidence_ids: [],
    };
    recordEvent(ev);
    const [back] = getEventsByRunId(RUN_A);
    expect(back.error).toBe("boom");
    expect(back.output).toBe(null);
    expect(back.evidence_ids).toEqual([]);
  });

  it("merkleRootForRun is deterministic and zero for empty runs", () => {
    expect(merkleRootForRun(RUN_A)).toBe(0n);
    for (let i = 0; i < 3; i++) recordEvent(makeEvent(RUN_A, i));
    const root1 = merkleRootForRun(RUN_A);
    const root2 = merkleRootForRun(RUN_A);
    expect(root1).toBe(root2);
    expect(root1).not.toBe(0n);
    // A different run should give a different root.
    for (let i = 0; i < 3; i++) recordEvent(makeEvent(RUN_B, i));
    expect(merkleRootForRun(RUN_B)).not.toBe(root1);
  });
});
