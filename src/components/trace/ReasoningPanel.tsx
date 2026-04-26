"use client";

/**
 * ReasoningPanel - surfaces live agent reasoning prominently.
 *
 * Shows streaming text from two agents:
 *   researcher.planner  → model planning/reasoning between tool calls
 *   reviewer.derivation → Opus reasoning through evidence (Citations API)
 *
 * Streaming events have data.streaming: true + data.partial_text.
 * Final reviewer event has data.streaming: false + data.reasoning.
 */
import { useMemo } from "react";
import { Brain, Sparkles } from "lucide-react";

import type { WireTraceEvent } from "@/trace/events";
import { cn } from "@/lib/utils";

export type ReasoningPanelProps = {
  events: WireTraceEvent[];
  className?: string;
};

interface ReasoningState {
  text: string;
  isStreaming: boolean;
  citationCount: number;
  agent: "researcher.planner" | "reviewer.derivation";
}

const REASONING_AGENTS = new Set(["researcher.planner", "reviewer.derivation"]);

function deriveReasoning(events: WireTraceEvent[]): ReasoningState | null {
  let text = "";
  let isStreaming = false;
  let citationCount = 0;
  let seenAny = false;
  let agent: ReasoningState["agent"] = "reviewer.derivation";

  for (const ev of events) {
    if (!REASONING_AGENTS.has(ev.agent)) continue;
    const data = ev.data as
      | {
          streaming?: boolean;
          partial_text?: string;
          reasoning?: string;
          citation_count?: number;
        }
      | undefined;
    if (!data) continue;

    if (data.streaming === true && typeof data.partial_text === "string") {
      seenAny = true;
      text = data.partial_text;
      isStreaming = true;
      agent = ev.agent as ReasoningState["agent"];
    } else if (data.streaming === false && typeof data.reasoning === "string") {
      seenAny = true;
      text = data.reasoning;
      isStreaming = false;
      citationCount = data.citation_count ?? 0;
      agent = ev.agent as ReasoningState["agent"];
    }
  }

  if (!seenAny) return null;
  return { text, isStreaming, citationCount, agent };
}

export default function ReasoningPanel({
  events,
  className,
}: ReasoningPanelProps) {
  const reasoning = useMemo(() => deriveReasoning(events), [events]);
  if (!reasoning) return null;

  return (
    <div
      className={cn(
        "rounded-xl ring-1 ring-foreground/10 bg-card px-5 py-4 flex flex-col gap-2",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {reasoning.isStreaming ? (
          <Sparkles className="size-4 text-purple-500 animate-pulse" aria-hidden />
        ) : (
          <Brain className="size-4 text-purple-500" aria-hidden />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {reasoning.isStreaming
            ? reasoning.agent === "researcher.planner"
              ? "Agent thinking…"
              : "Reviewer reasoning…"
            : "Grounded reasoning"}
        </span>
        {!reasoning.isStreaming && reasoning.citationCount > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {reasoning.citationCount} citation{reasoning.citationCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p
        className={cn(
          "text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap",
          reasoning.isStreaming && "opacity-90",
        )}
      >
        {reasoning.text}
        {reasoning.isStreaming && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
      </p>
    </div>
  );
}
