import { beforeEach, describe, expect, it, vi } from "vitest";

import Anthropic from "@anthropic-ai/sdk";

import { lookupOrganizerProfile } from "@/agents/researcher/sources/organizer-profile";

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

describe("lookupOrganizerProfile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    AnthropicMock.mockImplementation(function MockAnthropic(this: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).messages = { create: vi.fn() };
    });
  });

  it("returns a validated profile for a high-reputability organizer", async () => {
    setMockResponse({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            handle: "encode_club",
            platform: "linkedin",
            follower_count: 45000,
            account_age_months: 48,
            cross_platform_handles: ["@Encode_Club"],
            third_party_coverage_urls: ["https://techcrunch.com/encode-club"],
          }),
        },
      ],
    });

    const profile = await lookupOrganizerProfile("Encode Club");

    expect(profile).toEqual({
      handle: "encode_club",
      platform: "linkedin",
      follower_count: 45000,
      account_age_months: 48,
      cross_platform_handles: ["@Encode_Club"],
      third_party_coverage_urls: ["https://techcrunch.com/encode-club"],
    });
    expect(profile.follower_count).toBe(45000);
  });

  it("returns a validated profile with nulls for a low-reputability organizer", async () => {
    setMockResponse({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            handle: "fakeorgx",
            platform: "unknown",
            follower_count: null,
            account_age_months: null,
            cross_platform_handles: [],
            third_party_coverage_urls: [],
          }),
        },
      ],
    });

    const profile = await lookupOrganizerProfile("FakeOrgX");

    expect(profile.follower_count).toBeNull();
    expect(profile.account_age_months).toBeNull();
    expect(profile.platform).toBe("unknown");
    expect(profile.cross_platform_handles).toEqual([]);
    expect(profile.third_party_coverage_urls).toEqual([]);
  });

  it("throws when the API returns text that is not JSON", async () => {
    setMockResponse({
      content: [{ type: "text", text: "I cannot find information" }],
    });

    await expect(lookupOrganizerProfile("Mystery Org")).rejects.toThrow(
      /Failed to parse organizer profile for "Mystery Org"/
    );
  });

  it("throws when the parsed JSON fails schema validation", async () => {
    setMockResponse({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            handle: "test",
            platform: "bad_platform",
          }),
        },
      ],
    });

    await expect(lookupOrganizerProfile("Test Org")).rejects.toThrow(
      /schema validation failed for "Test Org"/
    );
  });
});
