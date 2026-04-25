import { z } from "zod";

/**
 * EvidenceSchema - matches design spec §6 exactly.
 *
 * One Evidence record per atomic source signal. Researcher emits these;
 * Reviewer scores them and derives Findings.
 */

export const OrganizerProfileSchema = z.object({
  handle: z.string(),
  platform: z.enum(["linkedin", "x", "own_domain", "unknown"]),
  follower_count: z.number().int().nullable(),
  account_age_months: z.number().int().nullable(),
  cross_platform_handles: z.array(z.string()),
  third_party_coverage_urls: z.array(z.string().url()),
});

export type OrganizerProfile = z.infer<typeof OrganizerProfileSchema>;

export const EvidenceSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  source: z.enum([
    "companies_house",
    "web_lookup",
    "certificate",
    "linkedin",
    "x",
  ]),
  source_url: z.string().url().optional(),
  retrieved_at: z.string().datetime(),
  raw_artifact_hash: z.string(),
  matched_data_points: z.array(z.string()),
  signal_type: z.enum([
    "win_announcement",
    "company_record",
    "funding_round",
    "certificate",
  ]),
  // Reputability signals: populated for hackathon_win Evidence; null for others.
  organizer_profile: OrganizerProfileSchema.nullable(),
  reputability_score: z.number().int().min(0).max(6).nullable(),
  confidence_tier: z.enum(["low", "medium", "high", "very_high"]),
  notes: z.string().optional(),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
