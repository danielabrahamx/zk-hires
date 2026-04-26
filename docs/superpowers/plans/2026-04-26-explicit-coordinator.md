# Explicit Coordinator + Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce an explicit Coordinator agent that owns the Research → Review pipeline, passes all accumulated evidence to each stage explicitly, and retries the Researcher with gap-derived hints when the Reviewer finds insufficient evidence.

**Architecture:** A new `coordinator.ts` module becomes the single hub — it calls `runResearcher`, passes the full accumulated evidence bag to `runReviewer`, and on retryable gaps feeds the Reviewer's `missing_evidence` list back to the Researcher as `contextHints`. API stream routes become thin HTTP adapters that create the `runId`, subscribe to trace events, then delegate entirely to the coordinator.

**Tech Stack:** TypeScript, Zod (already present), no new dependencies.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/agents/coordinator.ts` | Hub: pipeline loop, evidence accumulation, retry logic |
| Modify | `src/agents/researcher/index.ts` | Add `contextHints?: string[]` to `ResearcherInput` union members |
| Modify | `src/agents/researcher/tool-loop.ts` | Append `contextHints` to tool-loop system prompt when present |
| Modify | `src/app/api/research/candidate/stream/route.ts` | Thin adapter: delegate to coordinator |
| Modify | `src/app/api/research/employer/stream/route.ts` | Thin adapter: delegate to coordinator |
| Create | `src/agents/__tests__/coordinator.test.ts` | Unit tests for coordinator logic |

---

## Task 1: Add `contextHints` to `ResearcherInput`

**Files:**
- Modify: `src/agents/researcher/index.ts`

The Coordinator needs to pass Reviewer-derived hints back to the Researcher on retry. Add an optional `contextHints: string[]` field to each member of the `ResearcherInput` union.

- [ ] **Step 1: Edit `ResearcherInput` in `src/agents/researcher/index.ts`**

Replace the existing union:

```typescript
export type ResearcherInput =
  | { claim_type: "hackathon_wins"; file: Buffer; mimeType: string; postLinks?: string[]; contextHints?: string[] }
  | { claim_type: "hackathon_wins"; postLinks: string[]; contextHints?: string[] }
  | {
      claim_type: "reputable_company";
      companyNumber?: string;
      supplementaryUrl?: string;
      contextHints?: string[];
    };
```

- [ ] **Step 2: Run the TypeScript compiler to verify no type errors**

```bash
cd C:/Users/danie/zk-hires && npx tsc --noEmit
```

Expected: no errors (contextHints is optional, existing call sites don't need updating).

- [ ] **Step 3: Commit**

```bash
git add src/agents/researcher/index.ts
git commit -m "feat(researcher): add optional contextHints to ResearcherInput"
```

---

## Task 2: Thread `contextHints` into the tool-loop system prompt

**Files:**
- Modify: `src/agents/researcher/tool-loop.ts`

The tool-loop drives the Researcher's LLM. When `contextHints` is present it means the Reviewer already ran and found gaps — the Researcher needs to know what it's missing so it can search more specifically.

- [ ] **Step 1: Read current `tool-loop.ts` signature to find the right insertion point**

The function signature is approximately:
```typescript
export async function runResearcherWithToolUse({
  candidateInputs,
  employerInputs,
  flow,
  runId,
}: { ... }): Promise<ResearcherResult>
```

- [ ] **Step 2: Add `contextHints` to the parameter type in `tool-loop.ts`**

Find the parameter destructuring and add the field:

```typescript
export async function runResearcherWithToolUse({
  candidateInputs,
  employerInputs,
  flow,
  runId,
  contextHints,
}: {
  candidateInputs?: CandidateInputs;
  employerInputs?: EmployerInputs;
  flow: "candidate" | "employer";
  runId: string;
  contextHints?: string[];
}): Promise<ResearcherResult>
```

- [ ] **Step 3: Append hints to the system prompt when present**

Locate where the system prompt string is assembled for the tool-use LLM call. After the existing system prompt string, add:

```typescript
const hintsSection =
  contextHints && contextHints.length > 0
    ? `\n\n## Retry Context\nThe Reviewer previously found insufficient evidence. Specifically, it needs:\n${contextHints.map((h) => `- ${h}`).join("\n")}\nFocus your searches on finding evidence that addresses these gaps.`
    : "";

const systemPrompt = BASE_SYSTEM_PROMPT + hintsSection;
```

(Replace `BASE_SYSTEM_PROMPT` with whatever the existing prompt variable is named in `tool-loop.ts`.)

- [ ] **Step 4: Thread `contextHints` from `researcher/index.ts` into `runResearcherWithToolUse`**

In `researcher/index.ts`, find both the candidate and employer calls to `runResearcherWithToolUse` and pass through `contextHints`:

```typescript
// candidate path
const result = await runResearcherWithToolUse({
  candidateInputs,
  flow: "candidate",
  runId,
  contextHints: input.contextHints,
});

// employer path
const result = await runResearcherWithToolUse({
  employerInputs: {
    companyNumber: input.companyNumber,
    supplementaryUrl: input.supplementaryUrl,
  },
  flow: "employer",
  runId,
  contextHints: input.contextHints,
});
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd C:/Users/danie/zk-hires && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/agents/researcher/tool-loop.ts src/agents/researcher/index.ts
git commit -m "feat(researcher): thread contextHints into tool-loop system prompt"
```

---

## Task 3: Create the Coordinator

**Files:**
- Create: `src/agents/coordinator.ts`

The Coordinator is the explicit hub. It:
1. Calls the Researcher (passing `contextHints` on retry)
2. Accumulates all evidence across iterations (deduplicating by `id`)
3. Passes the **full accumulated evidence bag** to the Reviewer every time
4. On a retryable gap, extracts `missing_evidence` and loops back to step 1
5. Hard-stops after `MAX_ITERATIONS = 2`

Retryable gap categories: `insufficient_evidence`, `low_confidence`.
Non-retryable: `ocr_failure`, `irrelevant_content`, `verification_failure`, `missing_input`, `registry_inactive`, `unreachable_url`.

- [ ] **Step 1: Write `src/agents/coordinator.ts`**

```typescript
import { randomUUID } from "node:crypto";
import { runResearcher, type ResearcherInput, type StepEmitter } from "@/agents/researcher";
import { runReviewer } from "@/agents/reviewer";
import { emitEvent } from "@/trace/store";
import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";
import type { Gap } from "@/types/gap";

const MAX_ITERATIONS = 2;
const RETRYABLE_GAPS = new Set(["insufficient_evidence", "low_confidence"]);

export interface CoordinatorInput {
  flow: "candidate" | "employer";
  researcherInput: ResearcherInput;
  runId: string;
  emit: StepEmitter;
}

export interface CoordinatorResult {
  evidence: Evidence[];
  findings: Finding[];
  gaps: Gap[];
  iterations: number;
}

export async function runCoordinator(input: CoordinatorInput): Promise<CoordinatorResult> {
  const { flow, runId, emit } = input;
  const allEvidence: Evidence[] = [];
  let lastGap: Gap | null = null;
  let researcherInput = input.researcherInput;

  emitEvent({
    run_id: runId,
    agent: "coordinator",
    kind: "plan",
    message: `Coordinator starting — ${flow} flow, max ${MAX_ITERATIONS} iteration(s)`,
    data: { flow, maxIterations: MAX_ITERATIONS },
  });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    emitEvent({
      run_id: runId,
      agent: "coordinator",
      kind: "plan",
      message: `Iteration ${iteration + 1}: dispatching Researcher`,
      data: { iteration },
    });

    // ── Researcher phase ──────────────────────────────────────────────────────
    const research = await runResearcher(researcherInput, emit, runId);

    // Accumulate evidence — deduplicate by id so retry evidence doesn't double-count
    const seen = new Set(allEvidence.map((e) => e.id));
    for (const ev of research.evidence) {
      if (!seen.has(ev.id)) {
        allEvidence.push(ev);
        seen.add(ev.id);
      }
    }

    emitEvent({
      run_id: runId,
      agent: "coordinator",
      kind: "tool_result",
      message: `Iteration ${iteration + 1}: Researcher complete — ${allEvidence.length} evidence record(s) accumulated`,
      data: { iteration, evidenceCount: allEvidence.length },
    });

    // ── Reviewer phase — receives full accumulated evidence bag ───────────────
    emitEvent({
      run_id: runId,
      agent: "coordinator",
      kind: "plan",
      message: `Iteration ${iteration + 1}: dispatching Reviewer with ${allEvidence.length} evidence record(s)`,
      data: { iteration, evidenceCount: allEvidence.length },
    });

    const review = await runReviewer(allEvidence, flow, runId);

    if (review.findings.length > 0) {
      emitEvent({
        run_id: runId,
        agent: "coordinator",
        kind: "decision",
        message: `Coordinator done — Finding produced after ${iteration + 1} iteration(s)`,
        data: { iterations: iteration + 1, findingType: review.findings[0]?.type },
      });
      return { evidence: allEvidence, findings: review.findings, gaps: [], iterations: iteration + 1 };
    }

    lastGap = review.gaps[0] ?? null;
    const isRetryable = lastGap && RETRYABLE_GAPS.has(lastGap.category);

    emitEvent({
      run_id: runId,
      agent: "coordinator",
      kind: "decision",
      message: `Iteration ${iteration + 1}: Gap — ${lastGap?.category}. ${isRetryable && iteration < MAX_ITERATIONS - 1 ? "Will retry." : "Stopping."}`,
      data: { iteration, gapCategory: lastGap?.category, isRetryable },
    });

    if (!isRetryable || iteration >= MAX_ITERATIONS - 1) break;

    // ── Build retry input with gap hints passed explicitly ────────────────────
    const contextHints = lastGap?.missing_evidence ?? [];
    emit(`Reviewer needs more evidence — retrying with ${contextHints.length} hint(s)...`);
    researcherInput = { ...researcherInput, contextHints };
  }

  emitEvent({
    run_id: runId,
    agent: "coordinator",
    kind: "decision",
    message: `Coordinator done — Gap after ${MAX_ITERATIONS} iteration(s): ${lastGap?.category}`,
    data: { iterations: MAX_ITERATIONS, gapCategory: lastGap?.category },
  });

  return {
    evidence: allEvidence,
    findings: [],
    gaps: lastGap ? [lastGap] : [],
    iterations: MAX_ITERATIONS,
  };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd C:/Users/danie/zk-hires && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/agents/coordinator.ts
git commit -m "feat(coordinator): explicit hub with evidence accumulation and retry loop"
```

---

## Task 4: Write coordinator unit tests

**Files:**
- Create: `src/agents/__tests__/coordinator.test.ts`

Test the three coordinator paths: immediate success, success-on-retry, and terminal gap.

- [ ] **Step 1: Write `src/agents/__tests__/coordinator.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd C:/Users/danie/zk-hires && pnpm test src/agents/__tests__/coordinator.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/agents/__tests__/coordinator.test.ts
git commit -m "test(coordinator): unit tests for hub retry and evidence accumulation"
```

---

## Task 5: Refactor candidate stream route to thin adapter

**Files:**
- Modify: `src/app/api/research/candidate/stream/route.ts`

The route currently owns the Researcher → Reviewer pipeline. Move all pipeline logic to the Coordinator and make the route a thin HTTP adapter.

- [ ] **Step 1: Replace the pipeline body in the candidate stream route**

The `start(controller)` function currently calls `runResearcher` then `runReviewer` directly. Replace that block with a single `runCoordinator` call:

```typescript
import { runCoordinator } from "@/agents/coordinator";

// Inside start(controller):
const runId = randomUUID();
const stepEmit = (label: string) => send("step", { label });

unsubscribe = subscribe(runId, (wireEvent) => {
  send("trace", wireEvent);
  const d = wireEvent.data as Record<string, unknown> | null | undefined;
  if (d && d.evidence && typeof d.evidence === "object" && !Array.isArray(d.evidence)) {
    send("evidence", d.evidence);
  }
});

const result = await runCoordinator({
  flow: "candidate",
  researcherInput: researcherInput,  // already built above
  runId,
  emit: stepEmit,
});

const sessionId = randomUUID();
storeResearchSession({
  session_id: sessionId,
  run_id: runId,
  claim_type: "hackathon_wins",
  payload: JSON.stringify({
    evidence: result.evidence,
    findings: result.findings,
    gap: result.gaps[0] ?? null,
  }),
  created_at: Date.now(),
});

if (result.gaps.length > 0) {
  send("gap", result.gaps[0]);
}

send("research_done", {
  session_id: sessionId,
  evidence: result.evidence,
  findings: result.findings,
});
```

Remove the old `import { runResearcher } from "@/agents/researcher"` and `import { runReviewer } from "@/agents/reviewer"` — they are now owned by the coordinator. Keep `import { runCoordinator } from "@/agents/coordinator"`.

- [ ] **Step 2: Verify TypeScript**

```bash
cd C:/Users/danie/zk-hires && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/research/candidate/stream/route.ts
git commit -m "refactor(candidate-route): thin adapter delegating to coordinator"
```

---

## Task 6: Refactor employer stream route to thin adapter

**Files:**
- Modify: `src/app/api/research/employer/stream/route.ts`

Same pattern as Task 5.

- [ ] **Step 1: Read the employer stream route to find the pipeline block**

The route at `src/app/api/research/employer/stream/route.ts` has the same `runResearcher` → `runReviewer` pattern. Replace it identically:

```typescript
import { runCoordinator } from "@/agents/coordinator";

// Inside start(controller):
const result = await runCoordinator({
  flow: "employer",
  researcherInput: {
    claim_type: "reputable_company",
    companyNumber: companyNumber ?? undefined,
    supplementaryUrl: supplementaryUrl ?? undefined,
  },
  runId,
  emit: stepEmit,
});

const sessionId = randomUUID();
storeResearchSession({
  session_id: sessionId,
  run_id: runId,
  claim_type: "reputable_company",
  payload: JSON.stringify({
    evidence: result.evidence,
    findings: result.findings,
    gap: result.gaps[0] ?? null,
  }),
  created_at: Date.now(),
});

if (result.gaps.length > 0) {
  send("gap", result.gaps[0]);
}

send("research_done", {
  session_id: sessionId,
  evidence: result.evidence,
  findings: result.findings,
});
```

Remove the `runResearcher` / `runReviewer` imports; add `runCoordinator`.

- [ ] **Step 2: Verify TypeScript**

```bash
cd C:/Users/danie/zk-hires && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
cd C:/Users/danie/zk-hires && pnpm test
```

Expected: all tests pass (including the 5 new coordinator tests).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/research/employer/stream/route.ts
git commit -m "refactor(employer-route): thin adapter delegating to coordinator"
```

---

## Self-Review

**Spec coverage (tweet alignment):**
- Hub and spoke — explicit `coordinator.ts` ✅
- Specialists never talk directly — routes call coordinator only ✅
- Explicit context passing — all accumulated evidence passed explicitly to each Reviewer call ✅
- Coordinator validates output at each stage — checks `findings.length > 0` before continuing ✅
- Lost context failure mode — evidence accumulates across iterations, not just latest round ✅
- Telephone effect prevention — Reviewer always receives full raw evidence, not a summary ✅
- Feedback loop (Reviewer → Researcher) — gap `missing_evidence` → `contextHints` → tool-loop prompt ✅
- Single responsibility per agent — Coordinator orchestrates; Researcher collects; Reviewer decides; each API route handles HTTP only ✅

**Placeholder scan:** No TBDs or vague steps — all code is complete.

**Type consistency:** `CoordinatorInput.researcherInput` is `ResearcherInput` (matches the type modified in Task 1). `runResearcher` called with spread `{ ...researcherInput, contextHints }` — valid because `contextHints` is optional on all union members.

**Known gaps not addressed (out of scope):**
- Multi-run session basket (cross-request evidence accumulation) — needs separate design
- `issuer/index.ts:56` only processes `findings[0]` — unchanged, tracked in AGENTS.md
- CH confidence tier binary mapping — unchanged, tracked in AGENTS.md
