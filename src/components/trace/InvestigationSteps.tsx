"use client";

/**
 * InvestigationSteps - Perplexity-style high-level checklist.
 *
 * Shows 4-5 conceptual steps for the active flow. Step status (pending /
 * active / done) is derived from which agents have fired (`active` and
 * `completed` sets passed in by the caller).
 */
import { Check, Circle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type FlowKind = "candidate" | "employer";

export type InvestigationStepsProps = {
  flow: FlowKind;
  active: Set<string>;
  completed: Set<string>;
  /** True once the issuer has signed (advances the "Issue credential" row). */
  issued?: boolean;
  /** True if a gap halted the flow - downstream steps render as skipped. */
  halted?: boolean;
  className?: string;
};

type StepDef = {
  key: string;
  label: string;
  /** Agents whose presence in `completed` marks this step as done. */
  agents: string[];
};

// Each step lists the agents whose terminal event marks it done.
//
// Researcher source steps use ONLY the specific source agent — not the
// orchestrator — because the researcher orchestrator emits events early
// in every run and would otherwise tick all source steps simultaneously.
// If a source isn't called (e.g. user didn't supply a CH number), its step
// stays pending — that's correct.
//
// Reviewer/issuer steps DO include the orchestrator as a fallback because
// their sub-agents are conditional:
//   - reviewer.scorer only runs for hackathon-style evidence
//   - reviewer.cite_or_drop only emits when a finding is dropped
//   - issuer.prover falls back to placeholder if the Noir circuit isn't built
// In all those cases the orchestrator's final "decision" event reliably fires.
const CANDIDATE_STEPS: StepDef[] = [
  {
    key: "ocr",
    label: "Read certificate",
    agents: ["researcher.certificate"],
  },
  {
    key: "organizer",
    label: "Profile event organizer",
    agents: ["researcher.organizer_profile"],
  },
  {
    key: "score",
    label: "Verify hackathon win",
    agents: [
      "reviewer.scorer",
      "reviewer.derivation",
      "reviewer.cite_or_drop",
      "reviewer",
    ],
  },
  {
    key: "issue",
    label: "Issue credential",
    agents: ["issuer.signer", "issuer.prover", "issuer"],
  },
];

const EMPLOYER_STEPS: StepDef[] = [
  {
    key: "ch",
    label: "Verify Companies House registration",
    agents: ["researcher.companies_house"],
  },
  {
    key: "web",
    label: "Cross-reference web sources",
    agents: ["researcher.web_lookup"],
  },
  {
    key: "score",
    label: "Verify company legitimacy",
    agents: [
      "reviewer.scorer",
      "reviewer.derivation",
      "reviewer.cite_or_drop",
      "reviewer",
    ],
  },
  {
    key: "issue",
    label: "Issue credential",
    agents: ["issuer.signer", "issuer.prover", "issuer"],
  },
];

type StepStatus = "pending" | "active" | "done" | "skipped";

function statusFor(
  step: StepDef,
  active: Set<string>,
  completed: Set<string>,
  isIssueRow: boolean,
  issued: boolean,
  halted: boolean,
  earlierActive: boolean,
): StepStatus {
  if (isIssueRow && issued) return "done";
  // Step is done as soon as ANY of its agents has emitted a terminal event.
  // See agents-list comment above for why we don't require every sub-agent
  // to fire (some are conditional and legitimately skip on a given run).
  const anyDone = step.agents.some((a) => completed.has(a));
  if (anyDone) return "done";
  const anyActive = step.agents.some((a) => active.has(a));
  if (anyActive) return "active";
  if (halted) return "skipped";
  // If an earlier step is active or done, we treat this as pending (visible);
  // otherwise still pending but rendered subtly.
  return earlierActive ? "pending" : "pending";
}

export default function InvestigationSteps({
  flow,
  active,
  completed,
  issued = false,
  halted = false,
  className,
}: InvestigationStepsProps) {
  const steps = flow === "candidate" ? CANDIDATE_STEPS : EMPLOYER_STEPS;
  let earlierActive = false;
  return (
    <div
      className={cn(
        "rounded-xl bg-card ring-1 ring-foreground/10 px-4 py-3 flex flex-col gap-2",
        className,
      )}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Investigation
      </div>
      <ol className="flex flex-col gap-1">
        {steps.map((step) => {
          const isIssueRow = step.key === "issue";
          const status = statusFor(
            step,
            active,
            completed,
            isIssueRow,
            issued,
            halted,
            earlierActive,
          );
          if (status === "active" || status === "done") earlierActive = true;
          return (
            <li
              key={step.key}
              className={cn(
                "flex items-center gap-2.5 py-1.5 text-sm transition-colors",
                status === "pending" && "text-muted-foreground",
                status === "skipped" && "text-muted-foreground/60 line-through",
                status === "active" && "text-foreground font-medium",
                status === "done" && "text-foreground",
              )}
            >
              <span className="size-5 inline-flex items-center justify-center shrink-0">
                {status === "done" ? (
                  <span className="size-5 rounded-full bg-emerald-500 text-white inline-flex items-center justify-center">
                    <Check className="size-3" aria-hidden />
                  </span>
                ) : status === "active" ? (
                  <Loader2 className="size-4 text-blue-500 animate-spin" aria-hidden />
                ) : (
                  <Circle
                    className={cn(
                      "size-3.5",
                      status === "skipped" ? "text-muted-foreground/40" : "text-muted-foreground/60",
                    )}
                    aria-hidden
                  />
                )}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
