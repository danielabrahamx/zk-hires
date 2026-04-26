import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { randomUUID } from "node:crypto";

import type { Evidence } from "@/types/evidence";
import { emitEvent } from "@/trace/store";
import { tierForCompanyStatus } from "@/config/runtime";

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

  emitEvent({
    run_id: runId,
    agent: "researcher.companies_house",
    kind: "tool_call",
    message: `Fetching company ${paddedNumber} from Companies House`,
    data: { companyNumber: paddedNumber, url },
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitEvent({
      run_id: runId,
      agent: "researcher.companies_house",
      kind: "error",
      message: `Companies House fetch failed: ${message}`,
      data: { companyNumber: paddedNumber, url },
      error: message,
    });
    throw err;
  }

  if (response.status === 404) {
    emitEvent({
      run_id: runId,
      agent: "researcher.companies_house",
      kind: "tool_result",
      message: `Company ${paddedNumber} not found (404)`,
      data: { companyNumber: paddedNumber, http_status: 404 },
    });
    throw new NotFoundError(`Company ${paddedNumber} not found`);
  }

  if (!response.ok) {
    emitEvent({
      run_id: runId,
      agent: "researcher.companies_house",
      kind: "error",
      message: `Companies House API error ${response.status}`,
      data: { companyNumber: paddedNumber, http_status: response.status },
      error: `HTTP ${response.status}`,
    });
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

  const confidenceTier: Evidence["confidence_tier"] = tierForCompanyStatus(
    profile.company_status
  );

  const evidenceId = randomUUID();

  emitEvent({
    run_id: runId,
    agent: "researcher.companies_house",
    kind: "tool_result",
    message: `Companies House returned ${response.status}, company_status=${profile.company_status ?? "unknown"}`,
    data: {
      companyNumber: paddedNumber,
      http_status: response.status,
      content_length: rawBody.length,
      company_name: profile.company_name,
      company_status: profile.company_status,
      evidence_id: evidenceId,
    },
    evidence_ids: [evidenceId],
  });

  emitEvent({
    run_id: runId,
    agent: "researcher.companies_house",
    kind: "decision",
    message: `Confidence tier ${confidenceTier} for status "${profile.company_status ?? "unknown"}"`,
    data: {
      company_status: profile.company_status,
      confidence_tier: confidenceTier,
      evidence_id: evidenceId,
    },
    evidence_ids: [evidenceId],
  });

  const evidence: Evidence = {
    id: evidenceId,
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
