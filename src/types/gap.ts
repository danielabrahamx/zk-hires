import { z } from "zod";

/**
 * GapSchema - emitted by the Reviewer when it cannot meet the
 * confidence threshold for a Finding. Surfaced to the user so they
 * can supply more evidence or learn what was missing.
 *
 * Spec §6 / §10.
 */

export const GapSchema = z.object({
  claim_type: z.enum(["hackathon_wins", "reputable_company"]),
  reason: z.string(),
  missing_evidence: z.array(z.string()),
});

export type Gap = z.infer<typeof GapSchema>;
