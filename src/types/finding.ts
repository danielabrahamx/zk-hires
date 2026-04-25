import { z } from "zod";

/**
 * FindingSchema - discriminated union over claim type.
 *
 * Reviewer derives one Finding per flow:
 *  - candidate -> hackathon_wins with a count
 *  - employer  -> reputable_company with bracket + jurisdiction
 *
 * Spec §6. The schema is flat (not nested under `claim`) so the discriminator
 * `type` lives at the top level for ergonomic switch handling downstream.
 */

export const HackathonWinsFindingSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  type: z.literal("hackathon_wins"),
  count: z.number().int().nonnegative(),
  evidence_ids: z.array(z.string().uuid()).min(1),
  confidence_tier: z.enum(["high", "very_high"]),
});

export const ReputableCompanyFindingSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  type: z.literal("reputable_company"),
  value: z.literal(true),
  bracket_at_least: z.enum(["lt_500k", "500k_2m", "2m_10m", "gt_10m"]),
  jurisdiction: z.literal("uk"),
  evidence_ids: z.array(z.string().uuid()).min(1),
  confidence_tier: z.enum(["high", "very_high"]),
});

export const FindingSchema = z.discriminatedUnion("type", [
  HackathonWinsFindingSchema,
  ReputableCompanyFindingSchema,
]);

export type Finding = z.infer<typeof FindingSchema>;
export type HackathonWinsFinding = z.infer<typeof HackathonWinsFindingSchema>;
export type ReputableCompanyFinding = z.infer<typeof ReputableCompanyFindingSchema>;
