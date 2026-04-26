import Anthropic from "@anthropic-ai/sdk";
import { ZodError } from "zod";

import { OrganizerProfileSchema, type OrganizerProfile } from "@/types/evidence";
import { emitEvent } from "@/trace/store";
import { MODEL_EXTRACT } from "@/config/runtime";

/**
 * X (Twitter) profile verification.
 *
 * Given a handle, scrape https://x.com/{handle} via Firecrawl and use Claude
 * Haiku to extract legitimacy signals (follower count, account age, verified
 * badge, recent activity). Returns an OrganizerProfile with platform: "x".
 *
 * Used by the candidate flow when the only evidence is a tweet — the Reviewer
 * factors the author's profile metrics into its confidence decision.
 */

function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Only HTTPS URLs are allowed (got ${parsed.protocol})`);
  }
  const h = parsed.hostname.toLowerCase();
  const blocked = [
    "localhost", "127.", "0.0.0.0", "::1",
    "169.254.", "metadata.google.",
    "10.", "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.", "172.24.",
    "172.25.", "172.26.", "172.27.", "172.28.", "172.29.",
    "172.30.", "172.31.", "192.168.",
  ];
  if (blocked.some((b) => h === b.replace(/\.$/, "") || h.startsWith(b))) {
    throw new Error(`URL points to a blocked internal address: ${h}`);
  }
}

const PROFILE_EXTRACT_PROMPT = `You are extracting X (Twitter) profile metadata from a scraped profile page.

Return ONLY this JSON object (no preamble, no code fences):
{
  "follower_count": <integer or null>,
  "account_age_months": <integer estimate of months since the joined date based on the page content, or null if not visible>,
  "verified": <true if a verified badge is visible on this account, else false>,
  "bio_present": <true if the account has a non-empty bio, else false>,
  "recent_activity": <true if the page shows any recent posts/tweets, else false>
}

If the account does not exist, is suspended, the page is empty, or you cannot determine a field, set it to null/false. Do not fabricate numbers.`;

interface ProfileSignals {
  follower_count: number | null;
  account_age_months: number | null;
  verified: boolean;
  bio_present: boolean;
  recent_activity: boolean;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response");
  }
  return trimmed.slice(start, end + 1);
}

async function fetchProfileMarkdown(url: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      success: boolean;
      data?: { markdown?: string };
    };
    return data.success && data.data?.markdown
      ? data.data.markdown.slice(0, 10_000)
      : null;
  } catch {
    return null;
  }
}

export async function verifyXProfile(
  handle: string,
  runId?: string
): Promise<OrganizerProfile> {
  const cleanHandle = handle.replace(/^@/, "").trim();
  const url = `https://x.com/${encodeURIComponent(cleanHandle)}`;
  assertSafeUrl(url);

  if (runId) {
    emitEvent({
      run_id: runId,
      agent: "researcher.organizer_profile",
      kind: "tool_call",
      message: `Verifying X profile @${cleanHandle}`,
      data: { url, handle: cleanHandle, model: MODEL_EXTRACT },
    });
  }

  const markdown = await fetchProfileMarkdown(url);

  // If Firecrawl is unavailable or the fetch failed, return a low-signal profile.
  if (!markdown) {
    if (runId) {
      emitEvent({
        run_id: runId,
        agent: "researcher.organizer_profile",
        kind: "tool_result",
        message: `Profile fetch unavailable for @${cleanHandle}`,
        data: { handle: cleanHandle, fetched: false },
      });
    }
    return OrganizerProfileSchema.parse({
      handle: cleanHandle,
      platform: "x",
      follower_count: null,
      account_age_months: null,
      cross_platform_handles: [],
      third_party_coverage_urls: [],
    });
  }

  const client = new Anthropic();
  let signals: ProfileSignals;
  try {
    const msg = await client.messages.create({
      model: MODEL_EXTRACT,
      max_tokens: 256,
      system: [
        {
          type: "text",
          text: PROFILE_EXTRACT_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: `Profile page content:\n${markdown}` }],
    });
    const block = msg.content.find((b) => b.type === "text");
    const text = (block && "text" in block ? block.text : "").trim();
    signals = JSON.parse(extractJsonObject(text)) as ProfileSignals;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      emitEvent({
        run_id: runId,
        agent: "researcher.organizer_profile",
        kind: "error",
        message: `X profile extraction failed for @${cleanHandle}: ${message}`,
        data: { handle: cleanHandle },
        error: message,
      });
    }
    // Non-fatal: return the bare handle so the Reviewer can still see something
    return OrganizerProfileSchema.parse({
      handle: cleanHandle,
      platform: "x",
      follower_count: null,
      account_age_months: null,
      cross_platform_handles: [],
      third_party_coverage_urls: [],
    });
  }

  let profile: OrganizerProfile;
  try {
    profile = OrganizerProfileSchema.parse({
      handle: cleanHandle,
      platform: "x",
      follower_count: signals.follower_count,
      account_age_months: signals.account_age_months,
      cross_platform_handles: [],
      third_party_coverage_urls: [],
    });
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(`X profile schema validation failed for @${cleanHandle}: ${err.message}`);
    }
    throw err;
  }

  if (runId) {
    emitEvent({
      run_id: runId,
      agent: "researcher.organizer_profile",
      kind: "tool_result",
      message: `X profile verified: @${cleanHandle} (${profile.follower_count ?? "?"} followers, ${profile.account_age_months ?? "?"}mo, verified=${signals.verified})`,
      data: {
        handle: cleanHandle,
        follower_count: profile.follower_count,
        account_age_months: profile.account_age_months,
        verified: signals.verified,
        bio_present: signals.bio_present,
        recent_activity: signals.recent_activity,
      },
    });
  }

  return profile;
}
