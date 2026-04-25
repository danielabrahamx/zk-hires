/**
 * TraceEvent - one row in the audit trace.
 *
 * Spec §5.4. Every Researcher / Reviewer / Issuer / Verifier action emits
 * one of these. Persisted to SQLite via src/trace/store.ts. The Merkle
 * root over all TraceEvents for a given run becomes `trace_root` in the
 * issued credential.
 */

export type TraceEventAgent =
  | "researcher"
  | "reviewer"
  | "issuer"
  | "verifier";

export type TraceEvent = {
  id?: number;
  ts: number; // unix ms
  run_id: string;
  agent: TraceEventAgent;
  action: string;
  input: unknown;
  output: unknown;
  latency_ms: number;
  error?: string;
  evidence_ids: string[];
};
