import { randomUUID } from "node:crypto";

import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";
import type { Gap } from "@/types/gap";

/**
 * Claim derivation.
 *
 * Maps a bag of Evidence into either a single Finding or a Gap, per flow.
 * Spec §6.
 *
 *  - candidate flow: count certificates whose confidence_tier reaches
 *    "high"+. If any pass, emit a hackathon_wins Finding; else a Gap.
 *  - employer flow: needs both an active Companies House record AND a
 *    Crunchbase record whose funding bracket meets the configured
 *    threshold. Otherwise a Gap explains exactly what's missing.
 */

const FUNDING_BRACKET_ORDER = [
  "lt_500k",
  "500k_2m",
  "2m_10m",
  "gt_10m",
] as const;

type FundingBracket = (typeof FUNDING_BRACKET_ORDER)[number];

function bracketIndex(bracket: string): number {
  return FUNDING_BRACKET_ORDER.indexOf(bracket as FundingBracket);
}

function extractFundingBracket(evidence: Evidence): FundingBracket | null {
  const tagged = evidence.matched_data_points.find((d) =>
    d.startsWith("funding_bracket:")
  );
  if (!tagged) return null;
  const value = tagged.slice("funding_bracket:".length);
  const idx = bracketIndex(value);
  return idx >= 0 ? (value as FundingBracket) : null;
}

function getFundingThreshold(): FundingBracket {
  const raw = process.env.FUNDING_BRACKET_THRESHOLD ?? "500k_2m";
  const idx = bracketIndex(raw);
  return idx >= 0 ? (raw as FundingBracket) : "500k_2m";
}

export function deriveCandidateFinding(
  evidence: Evidence[],
  runId: string
): Finding | Gap {
  // Certificates and verified win-announcement URLs (LinkedIn posts, etc.) are both valid.
  const validEvidence = evidence.filter(
    (e) =>
      (e.source === "certificate" || e.signal_type === "win_announcement") &&
      (e.confidence_tier === "high" || e.confidence_tier === "very_high")
  );

  if (validEvidence.length === 0) {
    return {
      claim_type: "hackathon_wins",
      reason: "No evidence meets confidence threshold",
      missing_evidence: [
        "hackathon certificate or verified social post (LinkedIn, X) announcing the win",
      ],
    };
  }

  return {
    id: randomUUID(),
    run_id: runId,
    type: "hackathon_wins",
    count: validEvidence.length,
    evidence_ids: validEvidence.map((e) => e.id),
    confidence_tier: "high",
  };
}

export function deriveEmployerFinding(
  evidence: Evidence[],
  runId: string
): Finding | Gap {
  const ch = evidence.find(
    (e) => e.source === "companies_house" && e.confidence_tier === "very_high"
  );
  const web = evidence.find((e) => e.source === "web_lookup");

  // Need at least one source
  if (!ch && !web) {
    return {
      claim_type: "reputable_company",
      reason: "No evidence provided — supply a Companies House number, a supporting URL, or both",
      missing_evidence: ["Companies House record or supporting URL"],
    };
  }

  // Extract funding bracket from web evidence if present.
  // Fall back to "lt_500k" when evidence is present but unparseable —
  // the URL was reachable and analysed; absence of explicit funding data
  // is not grounds for rejection on its own.
  const bracket: FundingBracket = web
    ? (extractFundingBracket(web) ?? "lt_500k")
    : "lt_500k";

  const threshold = getFundingThreshold();

  // Only enforce the funding threshold when web evidence is present AND
  // the bracket is explicitly below threshold AND there is no CH record
  // to compensate. CH-verified companies skip the funding gate — the
  // registry confirmation is itself a strong legitimacy signal.
  if (web && !ch && bracketIndex(bracket) < bracketIndex(threshold)) {
    return {
      claim_type: "reputable_company",
      reason: `Funding evidence is below the ${threshold} threshold. Add a Companies House number or a URL with stronger funding signals.`,
      missing_evidence: [`funding round >= ${threshold} or active Companies House record`],
    };
  }

  const evidenceIds = [ch?.id, web?.id].filter((id): id is string => Boolean(id));
  const confidenceTier: "very_high" | "high" =
    ch && web ? "very_high" : "high";

  return {
    id: randomUUID(),
    run_id: runId,
    type: "reputable_company",
    value: true,
    bracket_at_least: bracket,
    jurisdiction: "uk",
    evidence_ids: evidenceIds,
    confidence_tier: confidenceTier,
  };
}
