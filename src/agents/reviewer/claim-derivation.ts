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
  const validCerts = evidence.filter(
    (e) =>
      e.source === "certificate" &&
      (e.confidence_tier === "high" || e.confidence_tier === "very_high")
  );

  if (validCerts.length === 0) {
    return {
      claim_type: "hackathon_wins",
      reason: "No evidence meets confidence threshold",
      missing_evidence: ["hackathon certificate from reputable organizer"],
    };
  }

  return {
    id: randomUUID(),
    run_id: runId,
    type: "hackathon_wins",
    count: validCerts.length,
    evidence_ids: validCerts.map((e) => e.id),
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
  const cb = evidence.find((e) => e.source === "web_lookup");

  const missing: string[] = [];
  if (!ch) missing.push("active Companies House record");
  if (!cb) missing.push("web lookup funding record");

  if (!ch || !cb) {
    return {
      claim_type: "reputable_company",
      reason: `Missing required evidence: ${missing.join(", ")}`,
      missing_evidence: missing,
    };
  }

  const bracket = extractFundingBracket(cb);
  if (bracket === null) {
    return {
      claim_type: "reputable_company",
      reason: "Web lookup evidence has no funding bracket",
      missing_evidence: ["funding_bracket annotation on web lookup evidence"],
    };
  }

  const threshold = getFundingThreshold();
  if (bracketIndex(bracket) < bracketIndex(threshold)) {
    return {
      claim_type: "reputable_company",
      reason: `Funding bracket ${bracket} is below threshold ${threshold}`,
      missing_evidence: [`funding round at >= ${threshold}`],
    };
  }

  return {
    id: randomUUID(),
    run_id: runId,
    type: "reputable_company",
    value: true,
    bracket_at_least: bracket,
    jurisdiction: "uk",
    evidence_ids: [ch.id, cb.id],
    confidence_tier: "very_high",
  };
}
