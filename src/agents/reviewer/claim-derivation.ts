import { randomUUID } from "node:crypto";

import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";
import type { Gap, GapCategory } from "@/types/gap";
import { emitEvent } from "@/trace/store";
import {
  bracketIndex,
  FUNDING_BRACKETS,
  FUNDING_BRACKET_THRESHOLD,
  FUNDING_BRACKET_FALLBACK,
  FUNDING_BRACKET_UNKNOWN,
  MIN_CONTENT_CHARS,
  type FundingBracket,
} from "@/config/runtime";

/**
 * Claim derivation.
 *
 * Maps a bag of Evidence into either a single Finding or a Gap, per flow.
 * Spec §6.
 *
 *  - candidate flow: count certificates / win-post evidence whose
 *    confidence_tier reaches "high"+. If any pass, emit a hackathon_wins
 *    Finding; else a Gap whose category reflects WHY (OCR failure, low
 *    confidence, no evidence at all).
 *  - employer flow: needs an active Companies House record OR a
 *    web-lookup Evidence whose funding bracket meets threshold. The Gap
 *    category distinguishes unreachable URLs, irrelevant content,
 *    inactive registry rows, and below-threshold funding.
 */

function extractFundingBracket(evidence: Evidence): FundingBracket | null {
  const tagged = evidence.matched_data_points.find((d) =>
    d.startsWith("funding_bracket:")
  );
  if (!tagged) return null;
  const value = tagged.slice("funding_bracket:".length);
  const idx = bracketIndex(value as FundingBracket);
  return idx >= 0 ? (value as FundingBracket) : null;
}

/* --------------- matched_data_points helpers ----------------- */

function findTag(evidence: Evidence, prefix: string): string | null {
  const tag = evidence.matched_data_points.find((d) => d.startsWith(prefix));
  if (!tag) return null;
  return tag.slice(prefix.length);
}

function hasFlag(evidence: Evidence, flag: string): boolean {
  return evidence.matched_data_points.includes(flag);
}

function hostFromEvidence(ev: Evidence): string | null {
  const tagged = findTag(ev, "host:");
  if (tagged) return tagged;
  if (ev.source_url) {
    try {
      return new URL(ev.source_url).hostname;
    } catch {
      return null;
    }
  }
  return null;
}

function httpStatusFromEvidence(ev: Evidence): number | null {
  const tagged = findTag(ev, "http_status:");
  if (!tagged) return null;
  const n = Number(tagged);
  return Number.isFinite(n) ? n : null;
}

function isStatusUnreachable(status: number): boolean {
  return status === 0 || status >= 400;
}

function contentLengthFromEvidence(ev: Evidence): number | null {
  const tagged = findTag(ev, "content_length:");
  if (!tagged) return null;
  const n = Number(tagged);
  return Number.isFinite(n) ? n : null;
}

/* --------------- gap emission ----------------- */

function emitGapEvent(
  runId: string,
  gap: Gap,
  evidenceIds: string[] = []
): void {
  emitEvent({
    run_id: runId,
    agent: "reviewer.derivation",
    kind: "decision",
    message: `gap:${gap.category}`,
    data: {
      claim_type: gap.claim_type,
      category: gap.category,
      reason: gap.reason,
      what_we_tried: gap.what_we_tried,
      why_not_found: gap.why_not_found,
      sources_checked: gap.sources_checked,
      missing_evidence: gap.missing_evidence,
    },
    evidence_ids: evidenceIds,
  });
}

function emitFindingEvent(
  runId: string,
  finding: Finding,
  data: Record<string, unknown> = {}
): void {
  emitEvent({
    run_id: runId,
    agent: "reviewer.derivation",
    kind: "decision",
    message: `finding:${finding.type}`,
    data: {
      finding_type: finding.type,
      confidence_tier: finding.confidence_tier,
      ...data,
    },
    evidence_ids: finding.evidence_ids,
  });
}

/* --------------- candidate flow ----------------- */

export function deriveCandidateFinding(
  evidence: Evidence[],
  runId: string
): Finding | Gap {
  // Certificates and verified win-announcement URLs (LinkedIn posts, etc.) are both valid.
  const valid = evidence.filter(
    (e) =>
      (e.source === "certificate" || e.signal_type === "win_announcement") &&
      (e.confidence_tier === "high" || e.confidence_tier === "very_high")
  );

  if (valid.length > 0) {
    const finding: Finding = {
      id: randomUUID(),
      run_id: runId,
      type: "hackathon_wins",
      count: valid.length,
      evidence_ids: valid.map((e) => e.id),
      confidence_tier: "high",
    };
    emitFindingEvent(runId, finding, { count: valid.length });
    return finding;
  }

  // No high-confidence evidence. Try to attribute *why* — OCR failure
  // (missing organizer/event/year) is distinct from "got the data, but
  // weak signals".
  const certEvidence = evidence.find((e) => e.source === "certificate");

  let category: GapCategory = "insufficient_evidence";
  let reason = "No evidence meets confidence threshold";
  const what_we_tried: string[] = [];
  const why_not_found: string[] = [];
  const sources_checked: string[] = [];
  const missing_evidence: string[] = [
    "hackathon certificate or verified social post (LinkedIn, X) announcing the win",
  ];

  if (evidence.length === 0) {
    category = "missing_input";
    reason = "No certificate or win-post link was supplied";
    why_not_found.push("Researcher returned no Evidence records");
  } else if (certEvidence) {
    sources_checked.push("certificate");
    what_we_tried.push("OCR-extracted certificate fields with vision model");

    const missingFields = certEvidence.matched_data_points
      .filter((d) => d.startsWith("missing:"))
      .map((d) => d.slice("missing:".length));
    const ocrFailed =
      hasFlag(certEvidence, "ocr_failure") ||
      hasFlag(certEvidence, "extraction_failed") ||
      missingFields.length > 0;

    if (ocrFailed) {
      category = "ocr_failure";
      reason = "Certificate uploaded but the OCR could not extract the required fields";
      if (missingFields.length > 0) {
        why_not_found.push(`Could not extract: ${missingFields.join(", ")}`);
      } else {
        why_not_found.push("Vision model returned no organizer/event/year");
      }
      missing_evidence.length = 0;
      missing_evidence.push(
        "A clearer certificate (PDF or high-resolution image) showing organizer, event name, and year"
      );
    } else if (
      certEvidence.confidence_tier === "low" ||
      certEvidence.confidence_tier === "medium"
    ) {
      category = "low_confidence";
      reason = "Certificate parsed but reputability signals were too weak to verify";
      why_not_found.push(
        `Certificate confidence_tier=${certEvidence.confidence_tier}`
      );
    }
  } else {
    // Only social/win-post evidence, all low-confidence.
    const allLow = evidence.every(
      (e) => e.confidence_tier === "low" || e.confidence_tier === "medium"
    );
    if (allLow) {
      category = "low_confidence";
      reason = "Sources were reachable but their signals were too weak to verify";
      for (const e of evidence) {
        const host = hostFromEvidence(e);
        if (host) sources_checked.push(host);
        why_not_found.push(`${e.source} confidence_tier=${e.confidence_tier}`);
      }
    }
  }

  const gap: Gap = {
    claim_type: "hackathon_wins",
    category,
    reason,
    what_we_tried,
    why_not_found,
    sources_checked,
    missing_evidence,
  };
  emitGapEvent(runId, gap, evidence.map((e) => e.id));
  return gap;
}

/* --------------- employer flow ----------------- */

export function deriveEmployerFinding(
  evidence: Evidence[],
  runId: string
): Finding | Gap {
  const ch = evidence.find((e) => e.source === "companies_house");
  const chHigh =
    ch && (ch.confidence_tier === "very_high" || ch.confidence_tier === "high")
      ? ch
      : undefined;
  const web = evidence.find((e) => e.source === "web_lookup");

  // -------- 0. Nothing at all --------
  if (!ch && !web) {
    const gap: Gap = {
      claim_type: "reputable_company",
      category: "missing_input",
      reason: "No evidence provided — supply a Companies House number, a supporting URL, or both",
      what_we_tried: [],
      why_not_found: ["No companyNumber and no supplementaryUrl received"],
      sources_checked: [],
      missing_evidence: ["Companies House number", "Company URL"],
    };
    emitGapEvent(runId, gap);
    return gap;
  }

  // -------- 1. Web URL was unreachable --------
  if (web) {
    const status = httpStatusFromEvidence(web);
    const host = hostFromEvidence(web) ?? "the supplied URL";
    const sources_checked: string[] = host ? [host] : [];
    const what_we_tried = ["Fetched the supplied URL"];

    const unreachableFlagged = hasFlag(web, "unreachable:true");
    const statusUnreachable = status !== null && isStatusUnreachable(status);

    if (unreachableFlagged || statusUnreachable) {
      const gap: Gap = {
        claim_type: "reputable_company",
        category: "unreachable_url",
        reason: "The URL you provided is unreachable or returned an error",
        what_we_tried,
        why_not_found: [
          status !== null
            ? `HTTP ${status} from ${host}`
            : `Connection failed to ${host}`,
        ],
        sources_checked,
        missing_evidence: [
          "A working URL with company information",
          "or a Companies House number",
        ],
      };
      emitGapEvent(runId, gap, [web.id]);
      return gap;
    }

    // -------- 2. URL loaded but content was irrelevant / empty --------
    const rejection = findTag(web, "rejection_reason:");
    const contentLen = contentLengthFromEvidence(web);
    const irrelevant =
      rejection !== null ||
      hasFlag(web, "no_company_signals") ||
      hasFlag(web, "irrelevant_content") ||
      (contentLen !== null && contentLen < MIN_CONTENT_CHARS);

    if (!chHigh && irrelevant) {
      const gap: Gap = {
        claim_type: "reputable_company",
        category: "irrelevant_content",
        reason: "The URL loaded but contains no company information",
        what_we_tried: [...what_we_tried, "Scanned page for company signals"],
        why_not_found: [
          rejection
            ? `Page rejected: ${rejection}`
            : contentLen !== null && contentLen < MIN_CONTENT_CHARS
            ? `Page body was only ${contentLen} chars`
            : "No company name, funding, or team signals detected",
        ],
        sources_checked,
        missing_evidence: [
          "A page that mentions the company by name with funding or team signals",
          "or a Companies House number",
        ],
      };
      emitGapEvent(runId, gap, [web.id]);
      return gap;
    }
  }

  // -------- 3. Companies House registry exists but is not active --------
  if (ch && !chHigh) {
    const status = findTag(ch, "company_status:") ?? "unknown";
    const host = "api.company-information.service.gov.uk";
    const gap: Gap = {
      claim_type: "reputable_company",
      category: "registry_inactive",
      reason: "Company is registered but not in active status",
      what_we_tried: ["Looked up Companies House record"],
      why_not_found: [`Companies House status: ${status}`],
      sources_checked: [host],
      missing_evidence: [
        "An active Companies House record",
        "or a working URL with company information",
      ],
    };
    emitGapEvent(runId, gap, [ch.id]);
    return gap;
  }

  // -------- 4. Funding bracket below threshold (genuine insufficiency) --------
  // Fall back to FUNDING_BRACKET_FALLBACK when web evidence is present
  // but unparseable — the URL was reachable and analysed.
  const bracket: FundingBracket = web
    ? (extractFundingBracket(web) ?? FUNDING_BRACKET_FALLBACK)
    : FUNDING_BRACKET_UNKNOWN;

  const threshold = FUNDING_BRACKET_THRESHOLD;

  // CH-verified companies skip the funding gate — the registry confirmation
  // is itself a strong legitimacy signal.
  if (web && !chHigh && bracketIndex(bracket) < bracketIndex(threshold)) {
    const host = hostFromEvidence(web) ?? "supplied URL";
    const gap: Gap = {
      claim_type: "reputable_company",
      category: "insufficient_evidence",
      reason: `Funding evidence is below the ${threshold} threshold. Add a Companies House number or a URL with stronger funding signals.`,
      what_we_tried: ["Fetched supplied URL", "Extracted funding signals"],
      why_not_found: [`Detected bracket=${bracket}, required=${threshold}`],
      sources_checked: [host],
      missing_evidence: [
        `funding round >= ${threshold}`,
        "or active Companies House record",
      ],
    };
    emitGapEvent(runId, gap, [web.id]);
    return gap;
  }

  // -------- 5. Check that the surviving bracket is a known one --------
  if (!FUNDING_BRACKETS.includes(bracket)) {
    const gap: Gap = {
      claim_type: "reputable_company",
      category: "insufficient_evidence",
      reason: "Funding bracket could not be resolved from evidence",
      what_we_tried: ["Parsed funding signals"],
      why_not_found: [`Unknown bracket=${String(bracket)}`],
      sources_checked: [],
      missing_evidence: ["Explicit funding amount or round"],
    };
    emitGapEvent(runId, gap);
    return gap;
  }

  // -------- 6. Success --------
  const evidenceIds = [chHigh?.id, web?.id].filter((id): id is string =>
    Boolean(id)
  );
  const confidenceTier: "very_high" | "high" =
    chHigh && web ? "very_high" : "high";

  const finding: Finding = {
    id: randomUUID(),
    run_id: runId,
    type: "reputable_company",
    value: true,
    bracket_at_least: bracket,
    jurisdiction: "uk",
    evidence_ids: evidenceIds,
    confidence_tier: confidenceTier,
  };
  emitFindingEvent(runId, finding, {
    bracket_at_least: bracket,
    jurisdiction: "uk",
  });
  return finding;
}
