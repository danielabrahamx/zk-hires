import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { randomUUID } from "node:crypto";

import type { Evidence } from "@/types/evidence";

/**
 * Companies House lookup source.
 *
 * Calls the Companies House public profile endpoint for a given company
 * number and returns a normalized Evidence record per the design spec §6.
 */

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(message?: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

interface CompaniesHouseProfile {
  company_name?: string;
  company_status?: string;
  date_of_creation?: string;
  type?: string;
  jurisdiction?: string;
  [key: string]: unknown;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export async function companiesHouseLookup(
  companyNumber: string,
  runId: string
): Promise<Evidence> {
  const paddedNumber = companyNumber.padStart(8, "0");
  const baseUrl =
    process.env.COMPANIES_HOUSE_BASE_URL ??
    "https://api-sandbox.company-information.service.gov.uk";
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY ?? "";
  const authHeader = `Basic ${Buffer.from(apiKey + ":").toString("base64")}`;
  const url = `${baseUrl}/company/${paddedNumber}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    throw new NotFoundError(`Company ${paddedNumber} not found`);
  }

  if (!response.ok) {
    throw new Error(`Companies House API error ${response.status}`);
  }

  const rawBody = await response.text();
  const profile = JSON.parse(rawBody) as CompaniesHouseProfile;

  const rawArtifactHash = toHex(sha256(utf8ToBytes(rawBody)));

  const matchedDataPoints = [
    profile.company_name,
    profile.company_status,
    profile.date_of_creation,
    profile.type,
    profile.jurisdiction,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);

  const confidenceTier: Evidence["confidence_tier"] =
    profile.company_status === "active" ? "very_high" : "low";

  const evidence: Evidence = {
    id: randomUUID(),
    run_id: runId,
    source: "companies_house",
    source_url: url,
    retrieved_at: new Date().toISOString(),
    raw_artifact_hash: rawArtifactHash,
    matched_data_points: matchedDataPoints,
    signal_type: "company_record",
    organizer_profile: null,
    reputability_score: null,
    confidence_tier: confidenceTier,
  };

  return evidence;
}
