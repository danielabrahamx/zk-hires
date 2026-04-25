// WARNING: Crunchbase ToS prohibits scraping. This is acceptable for hackathon demo only.
// Replace with Crunchbase Basic API license before any production use.

import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { randomUUID } from "node:crypto";

import { chromium } from "playwright-extra";
// @ts-ignore - puppeteer-extra-plugin-stealth has no published types
import StealthPlugin from "puppeteer-extra-plugin-stealth";

import type { Evidence } from "@/types/evidence";

chromium.use(StealthPlugin());

/**
 * Crunchbase organization lookup source.
 *
 * Scrapes the public Crunchbase organization page using a stealth-enabled
 * Chromium browser. Returns a normalized Evidence record per the design spec §6.
 *
 * NOTE: Hackathon-only. Production use must move to the licensed Basic API.
 */

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(message?: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export type FundingBracket = "lt_500k" | "500k_2m" | "2m_10m" | "gt_10m";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Extract a Crunchbase organization slug from either a raw slug or a full URL.
 */
function extractSlug(slugOrUrl: string): string {
  const trimmed = slugOrUrl.trim();
  const match = trimmed.match(
    /crunchbase\.com\/organization\/([A-Za-z0-9_-]+)/i
  );
  if (match && match[1]) {
    return match[1];
  }
  // Strip any trailing slashes or query strings if a bare path was provided.
  return trimmed.replace(/^\/+|\/+$/g, "").split(/[?#]/)[0];
}

/**
 * Parse the largest plausible dollar/pound funding amount from page HTML/text.
 * Returns the amount expressed in whole dollars, or null if none found.
 */
function parseTotalFunding(html: string): number | null {
  // Match patterns like "$1.2M", "£2.5B", "$500K", "$1,200,000".
  const symbolPattern =
    /[$£€]\s*([0-9]+(?:[.,][0-9]+)?)\s*([KMB])?/gi;
  let max = 0;

  for (const m of html.matchAll(symbolPattern)) {
    const numericPart = m[1].replace(/,/g, "");
    const value = parseFloat(numericPart);
    if (!isFinite(value)) continue;
    const unit = (m[2] ?? "").toUpperCase();
    let multiplier = 1;
    if (unit === "K") multiplier = 1_000;
    else if (unit === "M") multiplier = 1_000_000;
    else if (unit === "B") multiplier = 1_000_000_000;
    const total = value * multiplier;
    if (total > max) max = total;
  }

  return max > 0 ? max : null;
}

function bracketFor(amount: number | null): FundingBracket {
  if (amount === null) return "lt_500k";
  if (amount < 500_000) return "lt_500k";
  if (amount < 2_000_000) return "500k_2m";
  if (amount < 10_000_000) return "2m_10m";
  return "gt_10m";
}

/**
 * Defensively try to read the organization name from common Crunchbase
 * page elements (title tag, h1, og:title meta).
 */
function parseOrgName(html: string): string | null {
  try {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      // Crunchbase titles look like "Sibrox - Crunchbase Company Profile & Funding".
      const cleaned = titleMatch[1].split(/[-|]/)[0].trim();
      if (cleaned.length > 0) return cleaned;
    }
  } catch {
    // ignore
  }
  try {
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match && h1Match[1]) {
      const cleaned = h1Match[1].trim();
      if (cleaned.length > 0) return cleaned;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function crunchbaseLookup(
  slugOrUrl: string,
  runId: string
): Promise<Evidence> {
  const slug = extractSlug(slugOrUrl);
  const url = `https://www.crunchbase.com/organization/${slug}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { timeout: 30_000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
    } catch {
      // networkidle can flake on heavy pages; continue with what we have.
    }

    const html = await page.content();

    if (
      html.includes("This page could not be found") ||
      html.includes("Page not found")
    ) {
      throw new NotFoundError(`Crunchbase org ${slug} not found`);
    }

    const rawArtifactHash = toHex(sha256(utf8ToBytes(html)));

    let totalFunding: number | null = null;
    try {
      totalFunding = parseTotalFunding(html);
    } catch {
      totalFunding = null;
    }

    const bracket = bracketFor(totalFunding);

    const matchedDataPoints: string[] = [`funding_bracket:${bracket}`];

    let orgName: string | null = null;
    try {
      orgName = parseOrgName(html);
    } catch {
      orgName = null;
    }
    if (orgName) {
      matchedDataPoints.push(orgName);
    }

    const evidence: Evidence = {
      id: randomUUID(),
      run_id: runId,
      source: "crunchbase",
      source_url: url,
      retrieved_at: new Date().toISOString(),
      raw_artifact_hash: rawArtifactHash,
      matched_data_points: matchedDataPoints,
      signal_type: "funding_round",
      organizer_profile: null,
      reputability_score: null,
      confidence_tier: "medium",
    };

    return evidence;
  } finally {
    try {
      await browser.close();
    } catch {
      // best-effort
    }
  }
}
