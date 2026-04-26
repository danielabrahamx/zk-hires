"use client";

/**
 * EvidenceList - accordion of collected Evidence records.
 *
 * Each row collapsed: confidence dot, source label, matched-data-points chips,
 * timestamp. Expanded: full URL, signal_type, organizer profile (if present),
 * raw artifact hash, notes.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { CONFIDENCE_DOT } from "@/lib/agent-meta";
import type { Evidence } from "@/types/evidence";

export type EvidenceListProps = {
  evidence: Evidence[];
  className?: string;
};

const SOURCE_LABEL: Record<Evidence["source"], string> = {
  companies_house: "Companies House",
  web_lookup: "Web Lookup",
  certificate: "Certificate",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
};

function shortHash(h: string): string {
  if (h.length <= 12) return h;
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function EvidenceRow({ ev }: { ev: Evidence }) {
  const [open, setOpen] = useState(false);
  const dot = CONFIDENCE_DOT[ev.confidence_tier] ?? "bg-zinc-400";

  return (
    <div className="rounded-lg ring-1 ring-foreground/10 bg-background overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        <span className={cn("mt-1.5 size-2.5 rounded-full shrink-0", dot)} aria-hidden />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{SOURCE_LABEL[ev.source]}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {ev.confidence_tier.replace("_", " ")}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
              {new Date(ev.retrieved_at).toLocaleTimeString(undefined, {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          {ev.matched_data_points.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ev.matched_data_points.map((dp) => (
                <span
                  key={dp}
                  className="inline-flex items-center rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-foreground/80"
                >
                  {dp}
                </span>
              ))}
            </div>
          )}
        </div>
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground mt-1 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground mt-1 shrink-0" aria-hidden />
        )}
      </button>
      {open && (
        <div className="border-t border-foreground/5 px-3 py-2.5 text-xs flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-150">
          <Field label="Signal">{ev.signal_type.replace("_", " ")}</Field>
          {ev.source_url && (
            <Field label="Source">
              <a
                href={ev.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline break-all"
              >
                {ev.source_url}
                <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            </Field>
          )}
          {ev.reputability_score !== null && (
            <Field label="Reputability">{ev.reputability_score} / 6</Field>
          )}
          {ev.organizer_profile && (
            <Field label="Organizer">
              <span className="text-foreground/80">
                {ev.organizer_profile.handle} · {ev.organizer_profile.platform}
                {ev.organizer_profile.follower_count !== null &&
                  ` · ${ev.organizer_profile.follower_count.toLocaleString()} followers`}
              </span>
            </Field>
          )}
          <Field label="Artifact">
            <code className="font-mono text-[10px] text-muted-foreground">
              {shortHash(ev.raw_artifact_hash)}
            </code>
          </Field>
          {ev.notes && <Field label="Notes">{ev.notes}</Field>}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-muted-foreground uppercase tracking-wide text-[10px] pt-0.5">
        {label}
      </span>
      <span className="flex-1 break-words">{children}</span>
    </div>
  );
}

export default function EvidenceList({ evidence, className }: EvidenceListProps) {
  return (
    <div
      className={cn(
        "rounded-xl bg-card ring-1 ring-foreground/10 px-4 py-3 flex flex-col gap-2",
        className,
      )}
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Evidence
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {evidence.length}
        </span>
      </div>
      {evidence.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2">
          No evidence collected yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {evidence.map((ev) => (
            <EvidenceRow key={ev.id} ev={ev} />
          ))}
        </div>
      )}
    </div>
  );
}
