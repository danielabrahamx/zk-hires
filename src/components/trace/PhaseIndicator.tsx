"use client";

/**
 * PhaseIndicator - large header showing the live phase of the investigation.
 *
 * Pure presentational - takes derived state via props (no hooks). Uses CSS
 * keyframe animations from tw-animate-css (already configured in the
 * project) for the cross-fade on phase change.
 */
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type PhaseIndicatorProps = {
  phase: string;
  status: "idle" | "running" | "research_done" | "issuing" | "complete" | "gap" | "error";
  sourcesActiveCount: number;
  evidenceCount: number;
  className?: string;
};

const STATUS_LABEL: Record<PhaseIndicatorProps["status"], string> = {
  idle: "Ready",
  running: "Investigating",
  research_done: "Research complete",
  issuing: "Issuing credential",
  complete: "Done",
  gap: "Stopped",
  error: "Error",
};

const STATUS_DOT: Record<PhaseIndicatorProps["status"], string> = {
  idle: "bg-zinc-300",
  running: "bg-blue-500 animate-pulse",
  research_done: "bg-violet-500",
  issuing: "bg-indigo-500 animate-pulse",
  complete: "bg-emerald-500",
  gap: "bg-amber-500",
  error: "bg-red-500",
};

export default function PhaseIndicator({
  phase,
  status,
  sourcesActiveCount,
  evidenceCount,
  className,
}: PhaseIndicatorProps) {
  const showSpinner = status === "running" || status === "issuing";
  return (
    <div
      className={cn(
        "rounded-xl bg-card ring-1 ring-foreground/10 px-5 py-4 flex flex-col gap-2",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
        <span className="uppercase tracking-wide">{STATUS_LABEL[status]}</span>
      </div>
      <div className="flex items-center gap-2 min-h-[2rem]">
        {showSpinner && (
          <Loader2 className="size-5 text-blue-500 animate-spin shrink-0" aria-hidden />
        )}
        <h2
          // key prop forces React to remount the heading so the animation re-runs
          // each time the phase string changes (Barcelona-style label swap).
          key={phase || status}
          className="font-heading text-xl font-medium leading-tight animate-in fade-in slide-in-from-bottom-1 duration-300"
        >
          {phase || (status === "idle" ? "Awaiting input" : STATUS_LABEL[status])}
        </h2>
      </div>
      <div className="text-sm text-muted-foreground tabular-nums">
        <span>{sourcesActiveCount}</span>{" "}
        {sourcesActiveCount === 1 ? "source" : "sources"} active
        <span className="mx-2 text-foreground/30">·</span>
        <span>{evidenceCount}</span>{" "}
        {evidenceCount === 1 ? "evidence" : "evidence"} so far
      </div>
    </div>
  );
}
