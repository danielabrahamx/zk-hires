import Anthropic from "@anthropic-ai/sdk";
import { ZodError } from "zod";

import {
  OrganizerProfileSchema,
  type OrganizerProfile,
} from "@/types/evidence";

/**
 * Organizer profile lookup source.
 *
 * Uses the Anthropic Messages API with the `web_search` server tool to
 * research a hackathon organizer's reputability signals (LinkedIn / X
 * follower counts, account age, cross-platform handles, third-party
 * coverage URLs) and returns a validated `OrganizerProfile`.
 */

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessage {
  content: AnthropicContentBlock[];
}

function extractFinalTextBlock(message: AnthropicMessage): string {
  for (let i = message.content.length - 1; i >= 0; i--) {
    const block = message.content[i];
    if (block.type === "text" && typeof block.text === "string") {
      return (block as AnthropicTextBlock).text;
    }
  }
  throw new Error("Anthropic response contained no text content block");
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  // Direct JSON
  if (trimmed.startsWith("{")) {
    return trimmed;
  }
  // Pull the first {...} balanced object out of mixed text.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response text");
  }
  return trimmed.slice(start, end + 1);
}

export async function lookupOrganizerProfile(
  organizer: string
): Promise<OrganizerProfile> {
  const client = new Anthropic();

  let response: AnthropicMessage;
  try {
    response = (await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2048,
      tools: [
        {
          type: "web_search_20260209" as "web_search_20260209",
          name: "web_search",
          max_uses: 5,
          allowed_domains: [
            "linkedin.com",
            "twitter.com",
            "x.com",
            "*.org",
            "*.io",
            "*.club",
            "*.ai",
          ],
          user_location: { type: "approximate", country: "GB" },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
      messages: [
        {
          role: "user",
          content: `Research the hackathon organizer "${organizer}". Find:
1. Their LinkedIn page: follower count, how many years old is the account
2. Their X/Twitter page: follower count
3. Cross-platform handles (LinkedIn, X, own website)
4. Third-party coverage URLs (techcrunch, hackernoon, dev.to, prior event archives - must be real URLs)

Return ONLY a JSON object with exactly these fields:
{
  "handle": "<primary handle or org name>",
  "platform": "<linkedin|x|own_domain|unknown>",
  "follower_count": <number or null>,
  "account_age_months": <number or null>,
  "cross_platform_handles": ["<handle1>", ...],
  "third_party_coverage_urls": ["<url1>", ...]
}`,
        },
      ],
    })) as unknown as AnthropicMessage;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Anthropic API call failed for organizer "${organizer}": ${message}`
    );
  }

  const text = extractFinalTextBlock(response);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse organizer profile for "${organizer}": ${message}`
    );
  }

  try {
    return OrganizerProfileSchema.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(
        `Organizer profile schema validation failed for "${organizer}": ${err.message}`
      );
    }
    throw err;
  }
}
