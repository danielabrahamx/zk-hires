import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotFoundError,
  companiesHouseLookup,
} from "@/agents/researcher/sources/companies-house";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

describe("companiesHouseLookup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns very_high confidence Evidence for an active company", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        company_name: "SIBROX LTD",
        company_status: "active",
        date_of_creation: "2020-01-01",
        type: "ltd",
        jurisdiction: "england-wales",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const evidence = await companiesHouseLookup("12345", RUN_ID);

    expect(evidence.confidence_tier).toBe("very_high");
    expect(evidence.source).toBe("companies_house");
    expect(evidence.signal_type).toBe("company_record");
    expect(evidence.matched_data_points).toContain("SIBROX LTD");
    expect(evidence.run_id).toBe(RUN_ID);
    expect(evidence.organizer_profile).toBeNull();
    expect(evidence.reputability_score).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/company/00012345");
  });

  it("returns low confidence Evidence for a dissolved company", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          company_name: "DEADCO LTD",
          company_status: "dissolved",
          date_of_creation: "2010-05-05",
          type: "ltd",
          jurisdiction: "england-wales",
        })
      )
    );

    const evidence = await companiesHouseLookup("99", RUN_ID);

    expect(evidence.confidence_tier).toBe("low");
    expect(evidence.matched_data_points).toContain("dissolved");
  });

  it("throws NotFoundError on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "",
      } as unknown as Response)
    );

    await expect(companiesHouseLookup("00000001", RUN_ID)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it("propagates network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error"))
    );

    await expect(companiesHouseLookup("123", RUN_ID)).rejects.toThrow(
      "network error"
    );
  });
});
