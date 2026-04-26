"use client";

/**
 * SourcePills - row of one pill per active research source.
 *
 * Pills enter with a scale-in animation. A pill is rendered "completed"
 * (darker, bolder) when its agent appears in `completed`. Hover shows
 * the latency of the agent's most recent event (pulled from `latencies`).
 */
import { cn } from "@/lib/utils";
import { getAgentLabel, getAgentMeta } from "@/lib/agent-meta";

export type SourcePillsProps = {
  active: Set<string>;
  completed: Set<string>;
  /** agent → most-recent latency_ms (optional, for hover tooltip). */
  latencies?: Record<string, number | undefined>;
  className?: string;
};

export default function SourcePills({
  active,
  completed,
  latencies,
  className,
}: SourcePillsProps) {
  const agents = Array.from(active);
  if (agents.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl bg-card ring-1 ring-foreground/10 px-4 py-3 text-sm text-muted-foreground",
          className,
        )}
      >
        No sources yet.
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2 rounded-xl bg-card ring-1 ring-foreground/10 px-4 py-3",
        className,
      )}
    >
      {agents.map((agent) => {
        const meta = getAgentMeta(agent);
        const Icon = meta.icon;
        const label = getAgentLabel(agent);
        const isDone = completed.has(agent);
        const latency = latencies?.[agent];
        return (
          <span
            key={agent}
            title={latency !== undefined ? `${label} · ${latency}ms` : label}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-all",
              "animate-in fade-in zoom-in-95 duration-200",
              meta.bgClass,
              meta.textClass,
              meta.ringClass,
              isDone ? "opacity-100 saturate-150" : "opacity-80",
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span>{label}</span>
            {!isDone && (
              <span className={cn("size-1.5 rounded-full animate-pulse", meta.dotClass)} />
            )}
          </span>
        );
      })}
    </div>
  );
}
