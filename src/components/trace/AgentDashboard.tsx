"use client";

/**
 * AgentDashboard - the one big panel that composes every trace component.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ GapsSection (only when state.gap)                      │
 *   ├─────────────────────────────────────────────────────────┤
 *   │ PhaseIndicator (full width)                             │
 *   ├──────────────────────────────┬──────────────────────────┤
 *   │ InvestigationSteps           │ TraceTimeline            │
 *   │ SourcePills                  │                          │
 *   ├──────────────────────────────┴──────────────────────────┤
 *   │ EvidenceList (full width)                               │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Accepts either:
 *   - explicit `state` (caller drives useInvestigation themselves), OR
 *   - nothing (returns just the layout shell with idle defaults).
 */
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import type { ActiveToolCall, InvestigationState } from "@/hooks/useInvestigation";
import EvidenceList from "./EvidenceList";
import GapsSection from "./GapsSection";
import InvestigationSteps, { type FlowKind } from "./InvestigationSteps";
import PhaseIndicator from "./PhaseIndicator";
import ReasoningPanel from "./ReasoningPanel";
import SourcePills from "./SourcePills";
import TraceTimeline from "./TraceTimeline";

const TOOL_LABELS: Record<string, string> = {
  find_win_announcement: "Checking win announcement",
  read_certificate: "Reading certificate",
  lookup_organizer_profile: "Looking up organizer",
  companies_house_lookup: "Querying Companies House",
  web_fetch_url: "Analysing website",
  web_search: "Searching the web",
};

function summariseInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.url === "string") {
    try {
      const u = new URL(obj.url);
      const host = u.hostname.replace(/^www\./, "");
      const path = u.pathname.length > 32 ? u.pathname.slice(0, 29) + "…" : u.pathname;
      return `${host}${path}`;
    } catch {
      return obj.url.length > 60 ? obj.url.slice(0, 57) + "…" : obj.url;
    }
  }
  if (typeof obj.company_number === "string") return `#${obj.company_number}`;
  if (typeof obj.organizer_name === "string") return obj.organizer_name;
  if (typeof obj.query === "string") {
    return obj.query.length > 60 ? obj.query.slice(0, 57) + "…" : obj.query;
  }
  return null;
}

function LiveToolFeed({ calls }: { calls: ActiveToolCall[] }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (calls.length === 0) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [calls.length]);

  if (calls.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
        Live tool calls
      </div>
      {calls.map((call) => {
        const label = TOOL_LABELS[call.tool] ?? call.tool;
        const detail = summariseInput(call.input);
        const elapsed = Math.max(0, Math.floor((Date.now() - call.startedAt) / 1000));
        return (
          <div
            key={call.agent}
            className="flex items-center gap-3 text-sm"
          >
            <span
              aria-hidden
              className="size-3 rounded-full border-2 border-amber-500 border-t-transparent animate-spin shrink-0"
            />
            <span className="font-medium text-foreground">{label}</span>
            {detail && (
              <span className="text-muted-foreground font-mono text-xs truncate">
                {detail}
              </span>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
              {elapsed}s
            </span>
          </div>
        );
      })}
    </div>
  );
}

export type AgentDashboardProps = {
  state: InvestigationState;
  flow: FlowKind;
  className?: string;
};

export default function AgentDashboard({
  state,
  flow,
  className,
}: AgentDashboardProps) {
  // Build agent → most-recent latency map for SourcePills hover tooltip.
  const latencies = useMemo(() => {
    const out: Record<string, number | undefined> = {};
    for (const ev of state.trace) {
      if (typeof ev.latency_ms === "number") out[ev.agent] = ev.latency_ms;
    }
    return out;
  }, [state.trace]);

  const issued = state.status === "complete";
  const halted = state.status === "gap" || state.status === "error";

  const activeCalls = useMemo(
    () => Array.from(state.activeToolCalls.values()),
    [state.activeToolCalls]
  );

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {state.gap && <GapsSection gap={state.gap} />}

      <PhaseIndicator
        phase={state.phase}
        status={state.status}
        sourcesActiveCount={state.sourcesActive.size}
        evidenceCount={state.evidence.length}
      />

      <LiveToolFeed calls={activeCalls} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-4">
          <InvestigationSteps
            flow={flow}
            active={state.sourcesActive}
            completed={state.sourcesCompleted}
            issued={issued}
            halted={halted}
          />
          <SourcePills
            active={state.sourcesActive}
            completed={state.sourcesCompleted}
            latencies={latencies}
          />
        </div>
        <TraceTimeline events={state.trace} />
      </div>

      <ReasoningPanel events={state.trace} />

      <EvidenceList evidence={state.evidence} />
    </div>
  );
}
