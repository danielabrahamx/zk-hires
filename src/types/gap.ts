import { z } from "zod";

/**
 * Structured Gap - emitted by the Reviewer when it cannot meet the
 * confidence threshold for a Finding, OR when the input itself is
 * unverifiable (rubbish URLs, unreachable resources, irrelevant content).
 *
 * The category enum lets the UI surface the right message to the user.
 * "below threshold" is no longer the universal fallback - it only fires
 * when the input was real but the funding bracket was insufficient.
 *
 * Adapted from project-barcelona's GapSchema (what_we_tried /
 * why_not_found / sources_checked) and extended with an explicit
 * category so the frontend can colour-code and route to the right
 * remediation prompt.
 */

export const GapCategorySchema = z.enum([
  "unreachable_url",        // URL 404'd, timed out, or returned empty body
  "irrelevant_content",     // URL loaded but content has no company/event signals
  "verification_failure",   // signals extracted but cross-check rejected them
  "low_confidence",         // signals extracted but tier was "low"
  "insufficient_evidence",  // signals were valid but didn't meet threshold (e.g. underfunded)
  "missing_input",          // user didn't supply a required input
  "ocr_failure",            // certificate OCR could not extract required fields
  "registry_inactive",      // Companies House record exists but status not active
]);

export type GapCategory = z.infer<typeof GapCategorySchema>;

export const GapSchema = z.object({
  claim_type: z.enum(["hackathon_wins", "reputable_company"]),
  category: GapCategorySchema,
  /** Short headline message for the user (e.g. "The URL you provided is unreachable"). */
  reason: z.string(),
  /** What the agent attempted (e.g. ["Fetched URL", "Cross-checked against Crunchbase"]). */
  what_we_tried: z.array(z.string()).default([]),
  /** Why each attempt failed (e.g. ["HTTP 404 from example.com"]). */
  why_not_found: z.array(z.string()).default([]),
  /** Sources actually queried (e.g. ["example.com", "crunchbase.com"]). */
  sources_checked: z.array(z.string()).default([]),
  /** What the user can supply to retry (e.g. ["Working URL with company info", "Companies House number"]). */
  missing_evidence: z.array(z.string()).default([]),
});

export type Gap = z.infer<typeof GapSchema>;
