"use client";

/**
 * GapsSection - amber-tinted card explaining a structured Gap.
 *
 * Shows the headline reason, then four sub-sections:
 *   - What we tried       (what_we_tried)
 *   - Why it didn't work  (why_not_found)
 *   - Sources checked     (sources_checked)
 *   - How to fix          (missing_evidence)
 *
 * Category drives the icon.
 */
import {
  AlertTriangle,
  FileQuestion,
  FileX,
  HelpCircle,
  LinkIcon,
  ScanSearch,
  ShieldOff,
  Unplug,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Gap, GapCategory } from "@/types/gap";

export type GapsSectionProps = {
  gap: Gap;
  className?: string;
};

const CATEGORY_ICON: Record<GapCategory, LucideIcon> = {
  unreachable_url: Unplug,
  irrelevant_content: FileQuestion,
  verification_failure: ShieldOff,
  low_confidence: AlertTriangle,
  insufficient_evidence: HelpCircle,
  missing_input: FileX,
  ocr_failure: ScanSearch,
  registry_inactive: AlertTriangle,
};

const CATEGORY_LABEL: Record<GapCategory, string> = {
  unreachable_url: "Unreachable URL",
  irrelevant_content: "Irrelevant content",
  verification_failure: "Verification failed",
  low_confidence: "Low confidence",
  insufficient_evidence: "Insufficient evidence",
  missing_input: "Missing input",
  ocr_failure: "OCR failure",
  registry_inactive: "Registry not active",
};

function Section({
  title,
  icon: Icon,
  items,
  isPills = false,
}: {
  title: string;
  icon: LucideIcon;
  items: string[];
  isPills?: boolean;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900/80 dark:text-amber-200/80">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </div>
      {isPills ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100/80 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-200 ring-1 ring-amber-300/60"
            >
              <LinkIcon className="size-3" aria-hidden />
              {s}
            </span>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-1 text-sm text-amber-950/90 dark:text-amber-100/90">
          {items.map((s, i) => (
            <li key={`${s}-${i}`} className="flex gap-2">
              <span className="mt-2 size-1 rounded-full bg-amber-700/70 dark:bg-amber-300/70 shrink-0" />
              <span className="flex-1">{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GapsSection({ gap, className }: GapsSectionProps) {
  const Icon = CATEGORY_ICON[gap.category] ?? AlertTriangle;
  return (
    <div
      className={cn(
        "rounded-xl ring-1 ring-amber-300/60 bg-amber-50 dark:bg-amber-950/20 px-5 py-4 flex flex-col gap-4 animate-in fade-in slide-in-from-top-1 duration-300",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="size-9 shrink-0 rounded-full bg-amber-200/70 dark:bg-amber-900/40 ring-1 ring-amber-300/60 inline-flex items-center justify-center">
          <Icon className="size-5 text-amber-700 dark:text-amber-300" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            {CATEGORY_LABEL[gap.category] ?? gap.category}
          </span>
          <h3 className="font-heading text-lg font-medium leading-snug text-amber-950 dark:text-amber-50">
            {gap.reason}
          </h3>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="What we tried" icon={Wrench} items={gap.what_we_tried} />
        <Section title="Why it didn't work" icon={ShieldOff} items={gap.why_not_found} />
        <Section
          title="Sources checked"
          icon={LinkIcon}
          items={gap.sources_checked}
          isPills
        />
        <Section title="How to fix" icon={HelpCircle} items={gap.missing_evidence} />
      </div>
    </div>
  );
}
