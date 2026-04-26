/**
 * TraceEvent - one row in the audit trace.
 *
 * Adapted from project-barcelona. Every Researcher / Reviewer / Issuer
 * action emits one of these. Persisted to SQLite via src/trace/store.ts
 * and streamed live to the frontend over SSE.
 *
 * Two-axis classification:
 *   - agent: which agent fired the event
 *   - kind:  one of 5 Barcelona-style verbs that drives the UI:
 *       plan         - agent decided what to do next (top of a step)
 *       tool_call    - agent invoked an external tool / API / model
 *       tool_result  - the call returned (success or recoverable failure)
 *       decision     - agent made a synthesis decision (gap, finding, score)
 *       error        - hard failure that aborts the step
 *
 * `action` is kept for backwards compatibility (existing trace consumers
 * still read it) but new code should populate `kind` + `message` for
 * UI rendering. `data` is freeform JSON for kind-specific payloads
 * (e.g. http_status, evidence_id, confidence_tier).
 */

export type TraceEventAgent =
  | "researcher"
  | "reviewer"
  | "issuer"
  | "verifier"
  | "coordinator"
  // Source-level granularity for the dashboard. Lets us colour pills per
  // source and animate them independently in the timeline.
  | "researcher.planner"
  | "researcher.certificate"
  | "researcher.companies_house"
  | "researcher.web_lookup"
  | "researcher.organizer_profile"
  | "researcher.win_announcement"
  | "reviewer.scorer"
  | "reviewer.derivation"
  | "reviewer.cite_or_drop"
  | "issuer.signer"
  | "issuer.prover";

export type TraceEventKind =
  | "plan"
  | "tool_call"
  | "tool_result"
  | "decision"
  | "error";

export type TraceEvent = {
  id?: number;
  ts: number; // unix ms
  run_id: string;
  agent: TraceEventAgent;
  /** Backwards-compat slot - usually mirrors message or describes the action. */
  action: string;
  /** New: one of 5 Barcelona kinds, drives UI badge colour and timeline grouping. */
  kind?: TraceEventKind;
  /** New: short human-readable message shown in the live timeline. */
  message?: string;
  /** New: kind-specific structured payload (http_status, signals, scores). */
  data?: unknown;
  input: unknown;
  output: unknown;
  latency_ms: number;
  error?: string;
  evidence_ids: string[];
};

/**
 * Helper to infer kind from a legacy action name like "foo_start" / "foo_done".
 * Used by recordEvent when callers haven't supplied a kind explicitly.
 */
export function inferKind(action: string, hasError: boolean): TraceEventKind {
  if (hasError) return "error";
  if (action.endsWith("_start") || action.endsWith("_call")) return "tool_call";
  if (action.endsWith("_done") || action.endsWith("_result")) return "tool_result";
  if (action.endsWith("_decision") || action === "reviewer_done") return "decision";
  if (action.endsWith("_plan") || action === "reviewer_start") return "plan";
  return "tool_result";
}

/**
 * Public-facing slim view of a TraceEvent for the SSE stream.
 * The DB row is richer (input/output blobs); the wire format keeps
 * payloads small so the UI stays responsive.
 */
export type WireTraceEvent = {
  ts: number;
  run_id: string;
  agent: TraceEventAgent;
  kind: TraceEventKind;
  message: string;
  data?: unknown;
  evidence_ids?: string[];
  latency_ms?: number;
  error?: string;
};

export function toWireEvent(e: TraceEvent): WireTraceEvent {
  const kind = e.kind ?? inferKind(e.action, Boolean(e.error));
  return {
    ts: e.ts,
    run_id: e.run_id,
    agent: e.agent,
    kind,
    message: e.message ?? e.action,
    data: e.data,
    evidence_ids: e.evidence_ids.length > 0 ? e.evidence_ids : undefined,
    latency_ms: e.latency_ms || undefined,
    error: e.error,
  };
}
