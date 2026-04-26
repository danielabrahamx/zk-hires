"use client";

/**
 * TraceTimeline - vertical scroll of WireTraceEvents.
 *
 * Each row: agent dot, kind badge, agent label, message, timestamp.
 * Auto-scrolls to bottom whenever a new event lands. Header is a click-target
 * that collapses the body.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { KIND_BADGE, getAgentLabel, getAgentMeta } from "@/lib/agent-meta";
import type { WireTraceEvent } from "@/trace/events";

export type TraceTimelineProps = {
  events: WireTraceEvent[];
  className?: string;
  /** When true, the timeline starts collapsed. */
  defaultCollapsed?: boolean;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function TraceTimeline({
  events,
  className,
  defaultCollapsed = false,
}: TraceTimelineProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (collapsed) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [events, collapsed]);

  return (
    <div
      className={cn(
        "rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden flex flex-col",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors text-left"
      >
        {collapsed ? (
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        )}
        <span>Live trace</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </button>
      {!collapsed && (
        <div
          ref={scrollRef}
          className="max-h-[28rem] overflow-y-auto border-t border-foreground/5 px-4 py-3 flex flex-col gap-2 text-sm"
        >
          {events.length === 0 ? (
            <div className="text-muted-foreground text-xs py-2">
              No events yet.
            </div>
          ) : (
            events.map((ev, i) => {
              const meta = getAgentMeta(ev.agent);
              const kind = KIND_BADGE[ev.kind] ?? KIND_BADGE.tool_result;
              return (
                <div
                  key={`${ev.ts}-${i}`}
                  className="flex items-start gap-3 animate-in fade-in slide-in-from-left-1 duration-200"
                >
                  <span
                    className={cn(
                      "mt-1.5 size-2 rounded-full shrink-0",
                      meta.dotClass,
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
                          kind.bgClass,
                          kind.textClass,
                          kind.ringClass,
                        )}
                      >
                        {kind.label}
                      </span>
                      <span className={cn("text-xs font-medium", meta.textClass)}>
                        {getAgentLabel(ev.agent)}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                        {formatTime(ev.ts)}
                        {typeof ev.latency_ms === "number" && (
                          <span className="ml-1">· {ev.latency_ms}ms</span>
                        )}
                      </span>
                    </div>
                    <div className="text-foreground/90 text-sm leading-snug break-words">
                      {ev.message}
                    </div>
                    {ev.error && (
                      <div className="mt-1 text-xs text-red-600 dark:text-red-400 break-words">
                        {ev.error}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
