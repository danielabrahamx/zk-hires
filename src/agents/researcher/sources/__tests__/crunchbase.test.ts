import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const RUN_ID = "22222222-2222-4222-8222-222222222222";

const FIXTURE_HTML = readFileSync(
  resolve(process.cwd(), "e2e/fixtures/crunchbase-sibrox.html"),
  "utf8"
);

const MINIMAL_HTML = `<!doctype html><html><head><title>Empty - Crunchbase Company Profile</title></head><body><h1>Empty</h1><p>No funding info here.</p></body></html>`;

const NOT_FOUND_HTML = `<!doctype html><html><head><title>Not Found</title></head><body><h1>Oops</h1><p>This page could not be found</p></body></html>`;

let currentHtml = FIXTURE_HTML;

vi.mock("playwright-extra", () => {
  const fakePage = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockImplementation(async () => currentHtml),
  };
  const fakeBrowser = {
    newPage: vi.fn().mockResolvedValue(fakePage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    chromium: {
      use: vi.fn(),
      launch: vi.fn().mockResolvedValue(fakeBrowser),
    },
  };
});

vi.mock("puppeteer-extra-plugin-stealth", () => ({
  default: () => ({}),
}));

import {
  crunchbaseLookup,
  NotFoundError,
} from "@/agents/researcher/sources/crunchbase";

describe("crunchbaseLookup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    currentHtml = FIXTURE_HTML;
  });

  it("returns funding_round Evidence with the 500k_2m bracket for Sibrox fixture", async () => {
    currentHtml = FIXTURE_HTML;

    const evidence = await crunchbaseLookup(
      "https://www.crunchbase.com/organization/sibrox",
      RUN_ID
    );

    expect(evidence.signal_type).toBe("funding_round");
    expect(evidence.source).toBe("crunchbase");
    expect(evidence.confidence_tier).toBe("medium");
    expect(evidence.organizer_profile).toBeNull();
    expect(evidence.reputability_score).toBeNull();
    expect(evidence.matched_data_points).toContain(
      "funding_bracket:500k_2m"
    );
    expect(evidence.run_id).toBe(RUN_ID);
    expect(evidence.source_url).toBe(
      "https://www.crunchbase.com/organization/sibrox"
    );
  });

  it("falls back to lt_500k when no funding amounts can be parsed", async () => {
    currentHtml = MINIMAL_HTML;

    const evidence = await crunchbaseLookup("emptyco", RUN_ID);

    expect(evidence.matched_data_points).toContain(
      "funding_bracket:lt_500k"
    );
    expect(evidence.signal_type).toBe("funding_round");
  });

  it("throws NotFoundError when the page reports it could not be found", async () => {
    currentHtml = NOT_FOUND_HTML;

    await expect(
      crunchbaseLookup("does-not-exist", RUN_ID)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
