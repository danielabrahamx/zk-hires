/**
 * Agent metadata registries.
 *
 * Two label registries (Barcelona pattern):
 *   - AGENT_LABELS: noun form, e.g. "Companies House" (used for source pills, dashboard headers)
 *   - STEP_LABELS: verb form, e.g. "Querying Companies House" (used for the live phase indicator)
 *
 * AGENT_META: Lucide icon + Tailwind colour tokens per agent. Drives:
 *   - dotClass:   small status dot in the timeline & on pills
 *   - bgClass:    pill background
 *   - textClass:  pill text colour
 *   - ringClass:  outline / focus ring
 */

import {
  Building2,
  Check,
  Cpu,
  FileText,
  Globe,
  Lock,
  Megaphone,
  Scale,
  Search,
  ShieldCheck,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

export const AGENT_LABELS: Record<string, string> = {
  // researcher (per-source)
  "researcher.certificate": "Certificate OCR",
  "researcher.companies_house": "Companies House",
  "researcher.web_lookup": "Web Lookup",
  "researcher.organizer_profile": "Organizer Profile",
  "researcher.win_announcement": "Win Announcement",
  // reviewer (per-stage)
  "reviewer.scorer": "Reputability Scorer",
  "reviewer.derivation": "Claim Derivation",
  "reviewer.cite_or_drop": "Citation Check",
  // issuer (per-stage)
  "issuer.signer": "Issuer Signer",
  "issuer.prover": "ZK Prover",
  // generic fallbacks
  researcher: "Researcher",
  reviewer: "Reviewer",
  issuer: "Issuer",
  verifier: "Verifier",
};

export const STEP_LABELS: Record<string, string> = {
  "researcher.certificate": "Reading certificate",
  "researcher.companies_house": "Querying Companies House",
  "researcher.web_lookup": "Investigating supplementary URL",
  "researcher.organizer_profile": "Profiling event organizer",
  "researcher.win_announcement": "Cross-checking win announcement",
  "reviewer.scorer": "Scoring source reputability",
  "reviewer.derivation": "Deriving the finding",
  "reviewer.cite_or_drop": "Verifying every citation",
  "issuer.signer": "Signing credential",
  "issuer.prover": "Generating ZK proof",
  researcher: "Investigating",
  reviewer: "Reviewing evidence",
  issuer: "Issuing credential",
  verifier: "Verifying",
};

export type AgentMeta = {
  icon: LucideIcon;
  /** Solid dot colour (timeline marker) */
  dotClass: string;
  /** Pill text colour */
  textClass: string;
  /** Pill background colour (light tint) */
  bgClass: string;
  /** Outline / focus ring colour */
  ringClass: string;
};

const FALLBACK_META: AgentMeta = {
  icon: Search,
  dotClass: "bg-zinc-400",
  textClass: "text-zinc-700 dark:text-zinc-300",
  bgClass: "bg-zinc-100 dark:bg-zinc-900",
  ringClass: "ring-zinc-300/60",
};

export const AGENT_META: Record<string, AgentMeta> = {
  "researcher.certificate": {
    icon: FileText,
    dotClass: "bg-violet-500",
    textClass: "text-violet-700 dark:text-violet-300",
    bgClass: "bg-violet-100 dark:bg-violet-950/40",
    ringClass: "ring-violet-300/60",
  },
  "researcher.companies_house": {
    icon: Building2,
    dotClass: "bg-sky-500",
    textClass: "text-sky-700 dark:text-sky-300",
    bgClass: "bg-sky-100 dark:bg-sky-950/40",
    ringClass: "ring-sky-300/60",
  },
  "researcher.web_lookup": {
    icon: Globe,
    dotClass: "bg-cyan-500",
    textClass: "text-cyan-700 dark:text-cyan-300",
    bgClass: "bg-cyan-100 dark:bg-cyan-950/40",
    ringClass: "ring-cyan-300/60",
  },
  "researcher.organizer_profile": {
    icon: Users,
    dotClass: "bg-fuchsia-500",
    textClass: "text-fuchsia-700 dark:text-fuchsia-300",
    bgClass: "bg-fuchsia-100 dark:bg-fuchsia-950/40",
    ringClass: "ring-fuchsia-300/60",
  },
  "researcher.win_announcement": {
    icon: Megaphone,
    dotClass: "bg-pink-500",
    textClass: "text-pink-700 dark:text-pink-300",
    bgClass: "bg-pink-100 dark:bg-pink-950/40",
    ringClass: "ring-pink-300/60",
  },
  "reviewer.scorer": {
    icon: Scale,
    dotClass: "bg-amber-500",
    textClass: "text-amber-700 dark:text-amber-300",
    bgClass: "bg-amber-100 dark:bg-amber-950/40",
    ringClass: "ring-amber-300/60",
  },
  "reviewer.derivation": {
    icon: Trophy,
    dotClass: "bg-orange-500",
    textClass: "text-orange-700 dark:text-orange-300",
    bgClass: "bg-orange-100 dark:bg-orange-950/40",
    ringClass: "ring-orange-300/60",
  },
  "reviewer.cite_or_drop": {
    icon: Check,
    dotClass: "bg-emerald-500",
    textClass: "text-emerald-700 dark:text-emerald-300",
    bgClass: "bg-emerald-100 dark:bg-emerald-950/40",
    ringClass: "ring-emerald-300/60",
  },
  "issuer.signer": {
    icon: Lock,
    dotClass: "bg-indigo-500",
    textClass: "text-indigo-700 dark:text-indigo-300",
    bgClass: "bg-indigo-100 dark:bg-indigo-950/40",
    ringClass: "ring-indigo-300/60",
  },
  "issuer.prover": {
    icon: Cpu,
    dotClass: "bg-purple-500",
    textClass: "text-purple-700 dark:text-purple-300",
    bgClass: "bg-purple-100 dark:bg-purple-950/40",
    ringClass: "ring-purple-300/60",
  },
  researcher: {
    icon: Search,
    dotClass: "bg-blue-500",
    textClass: "text-blue-700 dark:text-blue-300",
    bgClass: "bg-blue-100 dark:bg-blue-950/40",
    ringClass: "ring-blue-300/60",
  },
  reviewer: {
    icon: Scale,
    dotClass: "bg-amber-500",
    textClass: "text-amber-700 dark:text-amber-300",
    bgClass: "bg-amber-100 dark:bg-amber-950/40",
    ringClass: "ring-amber-300/60",
  },
  issuer: {
    icon: ShieldCheck,
    dotClass: "bg-indigo-500",
    textClass: "text-indigo-700 dark:text-indigo-300",
    bgClass: "bg-indigo-100 dark:bg-indigo-950/40",
    ringClass: "ring-indigo-300/60",
  },
  verifier: {
    icon: ShieldCheck,
    dotClass: "bg-emerald-500",
    textClass: "text-emerald-700 dark:text-emerald-300",
    bgClass: "bg-emerald-100 dark:bg-emerald-950/40",
    ringClass: "ring-emerald-300/60",
  },
};

export function getAgentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

export function getStepLabel(agent: string): string {
  return STEP_LABELS[agent] ?? AGENT_LABELS[agent] ?? agent;
}

export function getAgentMeta(agent: string): AgentMeta {
  return AGENT_META[agent] ?? FALLBACK_META;
}

/** Kind badge colour tokens, Barcelona timeline convention. */
export const KIND_BADGE: Record<
  string,
  { textClass: string; bgClass: string; ringClass: string; label: string }
> = {
  plan: {
    label: "plan",
    textClass: "text-purple-700 dark:text-purple-300",
    bgClass: "bg-purple-100 dark:bg-purple-950/50",
    ringClass: "ring-purple-300/60",
  },
  tool_call: {
    label: "call",
    textClass: "text-blue-700 dark:text-blue-300",
    bgClass: "bg-blue-100 dark:bg-blue-950/50",
    ringClass: "ring-blue-300/60",
  },
  tool_result: {
    label: "result",
    textClass: "text-emerald-700 dark:text-emerald-300",
    bgClass: "bg-emerald-100 dark:bg-emerald-950/50",
    ringClass: "ring-emerald-300/60",
  },
  decision: {
    label: "decision",
    textClass: "text-amber-700 dark:text-amber-300",
    bgClass: "bg-amber-100 dark:bg-amber-950/50",
    ringClass: "ring-amber-300/60",
  },
  error: {
    label: "error",
    textClass: "text-red-700 dark:text-red-300",
    bgClass: "bg-red-100 dark:bg-red-950/50",
    ringClass: "ring-red-300/60",
  },
};

/** Confidence-tier dot colours for evidence cards. */
export const CONFIDENCE_DOT: Record<string, string> = {
  very_high: "bg-emerald-400",
  high: "bg-emerald-500",
  medium: "bg-amber-400",
  low: "bg-red-400",
};
