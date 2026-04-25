import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/agents/researcher/sources/companies-house", async () => {
  const actual = await vi.importActual<
    typeof import("@/agents/researcher/sources/companies-house")
  >("@/agents/researcher/sources/companies-house");
  return {
    ...actual,
    companiesHouseLookup: vi.fn(),
  };
});
vi.mock("@/agents/researcher/sources/web-lookup", () => ({
  webLookup: vi.fn(),
}));
vi.mock("@/agents/researcher/sources/certificate", async () => {
  const actual = await vi.importActual<
    typeof import("@/agents/researcher/sources/certificate")
  >("@/agents/researcher/sources/certificate");
  return {
    ...actual,
    certificateUpload: vi.fn(),
  };
});
vi.mock("@/agents/researcher/sources/organizer-profile", () => ({
  lookupOrganizerProfile: vi.fn(),
}));
vi.mock("@/trace/store", () => ({ recordEvent: vi.fn() }));

import { runResearcher } from "@/agents/researcher";
import {
  companiesHouseLookup,
  NotFoundError,
} from "@/agents/researcher/sources/companies-house";
import { webLookup } from "@/agents/researcher/sources/web-lookup";
import {
  certificateUpload,
  RefusalError,
} from "@/agents/researcher/sources/certificate";
import { lookupOrganizerProfile } from "@/agents/researcher/sources/organizer-profile";
import { recordEvent } from "@/trace/store";
import type { Evidence, OrganizerProfile } from "@/types/evidence";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: randomUUID(),
    run_id: randomUUID(),
    source: "companies_house",
    retrieved_at: new Date().toISOString(),
    raw_artifact_hash: "abc123",
    matched_data_points: ["ACME Ltd"],
    signal_type: "company_record",
    organizer_profile: null,
    reputability_score: null,
    confidence_tier: "very_high",
    ...overrides,
  };
}

function makeProfile(
  overrides: Partial<OrganizerProfile> = {}
): OrganizerProfile {
  return {
    handle: "encode_club",
    platform: "linkedin",
    follower_count: 45000,
    account_age_months: 48,
    cross_platform_handles: [],
    third_party_coverage_urls: [],
    ...overrides,
  };
}

describe("runResearcher - candidate flow (hackathon_wins)", () => {
  beforeEach(() => {
    vi.mocked(recordEvent).mockReset();
    vi.mocked(certificateUpload).mockReset();
    vi.mocked(lookupOrganizerProfile).mockReset();
  });

  it("returns enriched certificate evidence with organizer profile", async () => {
    const certEvidence = makeEvidence({
      source: "certificate",
      signal_type: "certificate",
      notes: "Encode Club",
      confidence_tier: "high",
      organizer_profile: null,
    });
    vi.mocked(certificateUpload).mockResolvedValue(certEvidence);
    vi.mocked(lookupOrganizerProfile).mockResolvedValue(makeProfile());

    const result = await runResearcher({
      claim_type: "hackathon_wins",
      file: Buffer.from("pdf"),
      mimeType: "application/pdf",
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].organizer_profile).not.toBeNull();
    expect(result.evidence[0].organizer_profile?.handle).toBe("encode_club");
    expect(result.evidence[0].id).toBe(certEvidence.id);
    expect(typeof result.runId).toBe("string");
    expect(result.runId.length).toBeGreaterThan(0);

    expect(vi.mocked(certificateUpload)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(lookupOrganizerProfile)).toHaveBeenCalledWith(
      "Encode Club"
    );

    // start + done for certificate, plus start + done for organizer profile
    expect(vi.mocked(recordEvent).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("returns unenriched evidence when certificate has no organizer notes", async () => {
    const certEvidence = makeEvidence({
      source: "certificate",
      signal_type: "certificate",
      notes: undefined,
      confidence_tier: "high",
    });
    vi.mocked(certificateUpload).mockResolvedValue(certEvidence);

    const result = await runResearcher({
      claim_type: "hackathon_wins",
      file: Buffer.from("pdf"),
      mimeType: "application/pdf",
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].organizer_profile).toBeNull();
    expect(vi.mocked(lookupOrganizerProfile)).not.toHaveBeenCalled();
  });

  it("propagates RefusalError and records an error trace event", async () => {
    vi.mocked(certificateUpload).mockRejectedValue(
      new RefusalError("not a certificate")
    );

    await expect(
      runResearcher({
        claim_type: "hackathon_wins",
        file: Buffer.from("garbage"),
        mimeType: "application/pdf",
      })
    ).rejects.toBeInstanceOf(RefusalError);

    const calls = vi.mocked(recordEvent).mock.calls;
    const errorCall = calls.find(([event]) => event.error !== undefined);
    expect(errorCall).toBeDefined();
    expect(errorCall![0].error).toContain("not a certificate");
  });
});

describe("runResearcher - employer flow (reputable_company)", () => {
  beforeEach(() => {
    vi.mocked(recordEvent).mockReset();
    vi.mocked(companiesHouseLookup).mockReset();
    vi.mocked(webLookup).mockReset();
  });

  it("returns evidence from both Companies House and web lookup", async () => {
    const chEvidence = makeEvidence({
      source: "companies_house",
      signal_type: "company_record",
      confidence_tier: "very_high",
    });
    const webEvidence = makeEvidence({
      source: "web_lookup",
      signal_type: "funding_round",
      confidence_tier: "medium",
    });
    vi.mocked(companiesHouseLookup).mockResolvedValue(chEvidence);
    vi.mocked(webLookup).mockResolvedValue(webEvidence);

    const result = await runResearcher({
      claim_type: "reputable_company",
      companyNumber: "00000006",
      supplementaryUrl: "https://sibrox.com",
    });

    expect(result.evidence).toHaveLength(2);
    const sources = result.evidence.map((e) => e.source).sort();
    expect(sources).toEqual(["companies_house", "web_lookup"]);
    expect(typeof result.runId).toBe("string");
    expect(result.runId.length).toBeGreaterThan(0);

    expect(vi.mocked(companiesHouseLookup)).toHaveBeenCalledWith(
      "00000006",
      result.runId
    );
    expect(vi.mocked(webLookup)).toHaveBeenCalledWith(
      "https://sibrox.com",
      result.runId
    );
    expect(vi.mocked(recordEvent).mock.calls.length).toBeGreaterThan(0);
  });

  it("propagates NotFoundError from Companies House", async () => {
    vi.mocked(companiesHouseLookup).mockRejectedValue(
      new NotFoundError("not found")
    );
    vi.mocked(webLookup).mockResolvedValue(
      makeEvidence({
        source: "web_lookup",
        signal_type: "funding_round",
      })
    );

    await expect(
      runResearcher({
        claim_type: "reputable_company",
        companyNumber: "99999999",
        supplementaryUrl: "https://nope.example.com",
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    const calls = vi.mocked(recordEvent).mock.calls;
    const errorCall = calls.find(([event]) => event.error !== undefined);
    expect(errorCall).toBeDefined();
  });
});
