import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Anthropic from "@anthropic-ai/sdk";

import { verifyXProfile } from "@/agents/researcher/sources/x-profile";

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function MockAnthropic(this: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).messages = { create: vi.fn() };
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnthropicMock = Anthropic as unknown as any;

function setMockResponse(response: unknown): void {
  AnthropicMock.mockImplementation(function MockAnthropic(this: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).messages = {
      create: vi.fn().mockResolvedValue(response),
    };
  });
}

function setMockReject(error: Error): void {
  AnthropicMock.mockImplementation(function MockAnthropic(this: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).messages = {
      create: vi.fn().mockRejectedValue(error),
    };
  });
}

describe("verifyXProfile", () => {
  const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    AnthropicMock.mockImplementation(function MockAnthropic(this: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).messages = { create: vi.fn() };
    });
    process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";
  });

  afterEach(() => {
    if (originalFirecrawlKey === undefined) {
      delete process.env.FIRECRAWL_API_KEY;
    } else {
      process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
    }
  });

  it("returns a parsed profile on the happy path (Firecrawl + Haiku)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown:
              "ETHGlobal\n@ETHGlobal\nFollowers: 245,000\nJoined: March 2018\nBuilding the future of Ethereum hackathons.",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    setMockResponse({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            follower_count: 245000,
            account_age_months: 96,
            verified: true,
            bio_present: true,
            recent_activity: true,
          }),
        },
      ],
    });

    const profile = await verifyXProfile("ETHGlobal", "test-run");

    expect(profile.handle).toBe("ETHGlobal");
    expect(profile.platform).toBe("x");
    expect(profile.follower_count).toBe(245000);
    expect(profile.account_age_months).toBe(96);
    expect(profile.cross_platform_handles).toEqual([]);
    expect(profile.third_party_coverage_urls).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns a null-metric profile when Firecrawl is unavailable", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const profile = await verifyXProfile("SomeHandle", "test-run");

    expect(profile.handle).toBe("SomeHandle");
    expect(profile.platform).toBe("x");
    expect(profile.follower_count).toBeNull();
    expect(profile.account_age_months).toBeNull();
    expect(profile.cross_platform_handles).toEqual([]);
    expect(profile.third_party_coverage_urls).toEqual([]);
    // No Firecrawl fetch attempted when key is absent
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("strips a leading @ from the handle and fetches the bare-handle URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: "ETHGlobal\n@ETHGlobal\nFollowers: 245,000",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    setMockResponse({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            follower_count: 245000,
            account_age_months: 96,
            verified: true,
            bio_present: true,
            recent_activity: true,
          }),
        },
      ],
    });

    const profile = await verifyXProfile("@ETHGlobal", "test-run");

    expect(profile.handle).toBe("ETHGlobal");

    // Inspect the body sent to Firecrawl - it should reference the bare-handle URL.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { url: string };
    expect(body.url).toBe("https://x.com/ETHGlobal");
    expect(body.url).not.toContain("@");
  });
});
