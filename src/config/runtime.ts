/**
 * Runtime configuration - all values that used to be hardcoded.
 *
 * Every threshold, whitelist, model name, and timeout is funnelled
 * through here so ops can tune without a code push. Defaults are
 * spelled out below so the system runs out of the box; override any
 * via env vars.
 */

function num(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(envKey: string, fallback: string): string {
  return process.env[envKey] ?? fallback;
}

function csv(envKey: string, fallback: string[]): string[] {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function json<T>(envKey: string, fallback: T): T {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/* ----------- funding brackets (employer flow) ----------- */

export type FundingBracket = "lt_500k" | "500k_2m" | "2m_10m" | "gt_10m";

export const FUNDING_BRACKETS: ReadonlyArray<FundingBracket> = [
  "lt_500k",
  "500k_2m",
  "2m_10m",
  "gt_10m",
];

/** Numeric cutoffs (USD). Bracket = lowest band whose cutoff >= raised. */
export interface FundingBracketCutoff {
  bracket: FundingBracket;
  max: number; // exclusive upper bound; gt_10m has Infinity
}

export const FUNDING_BRACKET_CUTOFFS: ReadonlyArray<FundingBracketCutoff> = json(
  "FUNDING_BRACKET_CUTOFFS",
  [
    { bracket: "lt_500k", max: 500_000 },
    { bracket: "500k_2m", max: 2_000_000 },
    { bracket: "2m_10m", max: 10_000_000 },
    { bracket: "gt_10m", max: Number.POSITIVE_INFINITY },
  ] as FundingBracketCutoff[]
);

/** The minimum bracket required to issue an employer credential. */
export const FUNDING_BRACKET_THRESHOLD = str(
  "FUNDING_BRACKET_THRESHOLD",
  "500k_2m"
) as FundingBracket;

/** Fallback bracket when no funding signal is present at all. */
export const FUNDING_BRACKET_UNKNOWN = str(
  "FUNDING_BRACKET_UNKNOWN",
  "lt_500k"
) as FundingBracket;

/** Default bracket assumed when partial signals exist but no $ amount. */
export const FUNDING_BRACKET_FALLBACK = str(
  "FUNDING_BRACKET_FALLBACK",
  "500k_2m"
) as FundingBracket;

export function bracketIndex(b: FundingBracket): number {
  return FUNDING_BRACKETS.indexOf(b);
}

export function bracketForAmount(amount: number): FundingBracket {
  for (const c of FUNDING_BRACKET_CUTOFFS) {
    if (amount < c.max) return c.bracket;
  }
  return "gt_10m";
}

/* ----------- claim_value encoding ----------- */

/**
 * Encodes a Finding into the numeric claim_value baked into the credential.
 * For hackathon_wins this is just `count`. For reputable_company we encode
 * the bracket index so the proof carries richer information than a binary 1.
 */
export function encodeEmployerClaimValue(bracket: FundingBracket): bigint {
  // 1 + bracketIndex so 0 stays sentinel for "no claim".
  return BigInt(1 + bracketIndex(bracket));
}

export function decodeEmployerClaimValue(claim: bigint): FundingBracket | null {
  const idx = Number(claim) - 1;
  if (idx < 0 || idx >= FUNDING_BRACKETS.length) return null;
  return FUNDING_BRACKETS[idx];
}

/* ----------- Companies House confidence map ----------- */

export type ConfidenceTier = "very_high" | "high" | "medium" | "low";

export const COMPANY_STATUS_CONFIDENCE: Record<string, ConfidenceTier> = json(
  "COMPANY_STATUS_CONFIDENCE",
  {
    active: "very_high",
    "voluntary-arrangement": "medium",
    "in-administration": "medium",
    liquidation: "low",
    dissolved: "low",
    "converted-closed": "low",
    "receiver-action": "low",
    dormant: "medium",
  }
);

export function tierForCompanyStatus(status: string | undefined | null): ConfidenceTier {
  if (!status) return "low";
  return COMPANY_STATUS_CONFIDENCE[status.toLowerCase()] ?? "low";
}

/* ----------- reputability scoring ----------- */

export const REPUTABILITY_THRESHOLD = num("REPUTABILITY_THRESHOLD", 4);
export const REPUTABILITY_MEDIUM_THRESHOLD = num("REPUTABILITY_MEDIUM_THRESHOLD", 2);
export const REPUTABILITY_FOLLOWERS_HOST = num("REPUTABILITY_FOLLOWERS_HOST", 5_000);
export const REPUTABILITY_FOLLOWERS_PRIMARY = num("REPUTABILITY_FOLLOWERS_PRIMARY", 10_000);
export const REPUTABILITY_ACCOUNT_AGE_MONTHS = num("REPUTABILITY_ACCOUNT_AGE_MONTHS", 12);
export const REPUTABILITY_CROSS_PLATFORM_HANDLES = num("REPUTABILITY_CROSS_PLATFORM_HANDLES", 2);
export const REPUTABILITY_THIRD_PARTY_COVERAGE = num("REPUTABILITY_THIRD_PARTY_COVERAGE", 1);
export const REPUTABILITY_MATCHED_DATA_POINTS = num("REPUTABILITY_MATCHED_DATA_POINTS", 2);

/* ----------- web-lookup config ----------- */

export const WEB_LOOKUP_TIMEOUT_MS = num("WEB_LOOKUP_TIMEOUT_MS", 15_000);
export const WEB_LOOKUP_FIRECRAWL_TIMEOUT_MS = num("WEB_LOOKUP_FIRECRAWL_TIMEOUT_MS", 20_000);
export const WEB_LOOKUP_MAX_CONTENT_CHARS = num("WEB_LOOKUP_MAX_CONTENT_CHARS", 10_000);
export const WEB_LOOKUP_NATIVE_MAX_CONTENT_CHARS = num("WEB_LOOKUP_NATIVE_MAX_CONTENT_CHARS", 8_000);
export const WEB_LOOKUP_MAX_PRESS_SIGNALS = num("WEB_LOOKUP_MAX_PRESS_SIGNALS", 5);

export const WEB_LOOKUP_HIGH_AUTHORITY_DOMAINS = csv(
  "WEB_LOOKUP_HIGH_AUTHORITY_DOMAINS",
  [
    "techcrunch.com",
    "bloomberg.com",
    "reuters.com",
    "ft.com",
    "wsj.com",
    "forbes.com",
    "bbc.co.uk",
    "bbc.com",
    "theguardian.com",
    "nytimes.com",
    "wired.com",
    "venturebeat.com",
    "businessinsider.com",
    "axios.com",
    "theverge.com",
  ]
);

export const WEB_LOOKUP_MEDIUM_AUTHORITY_DOMAINS = csv(
  "WEB_LOOKUP_MEDIUM_AUTHORITY_DOMAINS",
  [
    "linkedin.com",
    "crunchbase.com",
    "pitchbook.com",
    "dealroom.co",
    "owler.com",
    "sifted.eu",
  ]
);

/** HTTP statuses we treat as "URL is rubbish". 4xx + most 5xx. */
export const UNREACHABLE_STATUS_CODES: ReadonlyArray<number> = json(
  "WEB_LOOKUP_UNREACHABLE_STATUS_CODES",
  [400, 401, 403, 404, 405, 408, 410, 451, 500, 502, 503, 504] as number[]
);

/** Minimum content length (chars) for a fetched page to be considered non-empty. */
export const MIN_CONTENT_CHARS = num("WEB_LOOKUP_MIN_CONTENT_CHARS", 200);

/* ----------- model routing ----------- */

export const MODEL_VISION = str("MODEL_VISION", "claude-opus-4-7");
export const MODEL_EXTRACT = str("MODEL_EXTRACT", "claude-haiku-4-5-20251001");
export const MODEL_VERIFY = str("MODEL_VERIFY", "claude-sonnet-4-6");
export const MODEL_SYNTHESIS = str("MODEL_SYNTHESIS", "claude-sonnet-4-6");
export const MODEL_RESEARCHER = str("MODEL_RESEARCHER", "claude-sonnet-4-6");
export const MODEL_REVIEWER = str("MODEL_REVIEWER", "claude-opus-4-7");

/* ----------- confidence tier matrix (web-lookup) ----------- */

export interface TierMatrixEntry {
  verification: ConfidenceTier;
  authority: "high" | "medium" | "low";
  output: ConfidenceTier;
}

export const CONFIDENCE_TIER_MATRIX: ReadonlyArray<TierMatrixEntry> = json(
  "CONFIDENCE_TIER_MATRIX",
  [
    { verification: "high", authority: "high", output: "very_high" },
    { verification: "high", authority: "medium", output: "high" },
    { verification: "high", authority: "low", output: "medium" },
    { verification: "medium", authority: "high", output: "high" },
    { verification: "medium", authority: "medium", output: "medium" },
    { verification: "medium", authority: "low", output: "medium" },
    { verification: "low", authority: "high", output: "low" },
    { verification: "low", authority: "medium", output: "low" },
    { verification: "low", authority: "low", output: "low" },
  ] as TierMatrixEntry[]
);

export function deriveConfidenceTier(
  verification: ConfidenceTier,
  authority: "high" | "medium" | "low"
): ConfidenceTier {
  return (
    CONFIDENCE_TIER_MATRIX.find(
      (e) => e.verification === verification && e.authority === authority
    )?.output ?? "low"
  );
}

export function authorityForDomain(host: string): "high" | "medium" | "low" {
  const h = host.toLowerCase();
  if (WEB_LOOKUP_HIGH_AUTHORITY_DOMAINS.some((d) => h.includes(d))) return "high";
  if (WEB_LOOKUP_MEDIUM_AUTHORITY_DOMAINS.some((d) => h.includes(d))) return "medium";
  return "low";
}
