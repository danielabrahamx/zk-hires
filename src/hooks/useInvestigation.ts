"use client";

/**
 * useInvestigation - drives a live agent panel from a single SSE-over-fetch stream.
 *
 * Adapted from project-barcelona's investigation hook. We POST (multipart or JSON)
 * to a backend route that streams `text/event-stream` responses; this hook decodes
 * the stream and exposes derived UI state (phase, source set, evidence, findings, gap).
 *
 * Why fetch + TextDecoder instead of EventSource?
 *   - EventSource can only GET; we need POST for multipart uploads + JSON bodies.
 *   - We parse "event:" / "data:" lines manually and split on "\n\n" (SSE frame
 *     terminator) the same way the Barcelona client does.
 */
import { useCallback, useRef, useState } from "react";

import type { WireTraceEvent } from "@/trace/events";
import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";
import type { Gap } from "@/types/gap";
import { getStepLabel } from "@/lib/agent-meta";

export type InvestigationStatus =
  | "idle"
  | "running"
  | "research_done"
  | "issuing"
  | "complete"
  | "gap"
  | "error";

export type InvestigationFinalResult = {
  proof_code?: string;
  public_claims?: Record<string, unknown>;
  issued_at?: number;
  expires_at?: number;
};

export type InvestigationState = {
  status: InvestigationStatus;
  trace: WireTraceEvent[];
  /** Latest STEP_LABELS-mapped phase string (e.g. "Querying Companies House"). */
  phase: string;
  /** Agents that have emitted at least one event. */
  sourcesActive: Set<string>;
  /** Agents that have emitted a final tool_result or decision (or errored out). */
  sourcesCompleted: Set<string>;
  evidence: Evidence[];
  findings: Finding[];
  gap: Gap | null;
  sessionId: string | null;
  result: InvestigationFinalResult | null;
  error: string | null;
};

const initialState: InvestigationState = {
  status: "idle",
  trace: [],
  phase: "",
  sourcesActive: new Set(),
  sourcesCompleted: new Set(),
  evidence: [],
  findings: [],
  gap: null,
  sessionId: null,
  result: null,
  error: null,
};

export type UseInvestigationReturn = {
  state: InvestigationState;
  /** POST to `url` with `body` (FormData passes-through, plain object → JSON). */
  startResearch: (url: string, body: FormData | object) => Promise<void>;
  reset: () => void;
};

/** Parse one SSE "event"+"data" frame. Tolerant to comments / unknown event types. */
type Frame = { event: string; data: string };

function parseFrame(raw: string): Frame | null {
  const lines = raw.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event: eventName, data: dataLines.join("\n") };
}

export function useInvestigation(): UseInvestigationReturn {
  const [state, setState] = useState<InvestigationState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(initialState);
  }, []);

  const startResearch = useCallback(async (url: string, body: FormData | object) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setState({ ...initialState, status: "running" });

    let init: RequestInit;
    if (body instanceof FormData) {
      init = { method: "POST", body, signal: ac.signal };
    } else {
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: ac.signal,
      };
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      if (ac.signal.aborted) return;
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
      return;
    }

    if (!response.ok || !response.body) {
      setState((s) => ({
        ...s,
        status: "error",
        error: `Request failed: ${response.status} ${response.statusText}`,
      }));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleFrame = (frame: Frame) => {
      let payload: unknown;
      try {
        payload = JSON.parse(frame.data);
      } catch {
        // Ignore malformed payloads - server should never emit these
        return;
      }

      switch (frame.event) {
        case "session": {
          const p = payload as { session_id?: string };
          setState((s) => ({ ...s, sessionId: p.session_id ?? s.sessionId }));
          return;
        }
        case "trace": {
          const ev = payload as WireTraceEvent;
          setState((s) => {
            const sourcesActive = new Set(s.sourcesActive);
            sourcesActive.add(ev.agent);
            const sourcesCompleted = new Set(s.sourcesCompleted);
            if (
              ev.kind === "tool_result" ||
              ev.kind === "decision" ||
              ev.kind === "error"
            ) {
              sourcesCompleted.add(ev.agent);
            }
            return {
              ...s,
              trace: [...s.trace, ev],
              phase: getStepLabel(ev.agent),
              sourcesActive,
              sourcesCompleted,
            };
          });
          return;
        }
        case "evidence": {
          const ev = payload as Evidence;
          setState((s) => {
            // Upsert by ID: replace existing card (e.g. certificate enriched with
            // organizer profile) rather than duplicating it.
            const idx = s.evidence.findIndex((e) => e.id === ev.id);
            if (idx >= 0) {
              const updated = [...s.evidence];
              updated[idx] = ev;
              return { ...s, evidence: updated };
            }
            return { ...s, evidence: [...s.evidence, ev] };
          });
          return;
        }
        case "finding": {
          const f = payload as Finding;
          setState((s) => ({ ...s, findings: [...s.findings, f] }));
          return;
        }
        case "research_done": {
          // The API bundles session_id + evidence + findings into one event;
          // merge them into state alongside the status flip so the proof
          // button has everything it needs (sessionId + at least one finding).
          const p = payload as {
            session_id?: string;
            evidence?: Evidence[];
            findings?: Finding[];
          };
          setState((s) => ({
            ...s,
            status: "research_done",
            sessionId: p.session_id ?? s.sessionId,
            evidence:
              p.evidence && p.evidence.length > 0 ? p.evidence : s.evidence,
            findings:
              p.findings && p.findings.length > 0 ? p.findings : s.findings,
          }));
          return;
        }
        case "issuing": {
          setState((s) => ({ ...s, status: "issuing" }));
          return;
        }
        case "gap": {
          const g = payload as Gap;
          setState((s) => ({ ...s, status: "gap", gap: g }));
          return;
        }
        case "result":
        case "complete": {
          const r = payload as InvestigationFinalResult;
          setState((s) => ({ ...s, status: "complete", result: r }));
          return;
        }
        case "error": {
          const p = payload as { error?: string };
          setState((s) => ({
            ...s,
            status: "error",
            error: p.error ?? "Unknown error",
          }));
          return;
        }
        default:
          // Unknown event type: ignore. Forward-compat with future stream events.
          return;
      }
    };

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line.
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const frame = parseFrame(raw);
          if (frame) handleFrame(frame);
        }
      }
      // Drain any trailing frame (server may not flush a blank line at EOF).
      if (buffer.trim()) {
        const frame = parseFrame(buffer);
        if (frame) handleFrame(frame);
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      // If the stream closed without a terminal event, leave state as-is
      // (the last `trace`/`gap`/`result` event already settled the status).
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, []);

  return { state, startResearch, reset };
}
