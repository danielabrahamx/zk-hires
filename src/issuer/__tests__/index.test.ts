import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// Mock the heavy proof + verify modules so tests stay fast.
vi.mock("../prove", () => ({
  proveCredential: vi.fn().mockResolvedValue({
    proof: new Uint8Array([1, 2, 3]),
    publicInputs: ["0x01"],
  }),
}));
vi.mock("../verify", () => ({
  verifyProof: vi.fn().mockResolvedValue(true),
}));

import { generateKeypair } from "../eddsa";
import {
  issueCredential,
  NullifierCollisionError,
} from "../index";
import type { Finding } from "@/types/finding";

const TEST_DB = join(
  tmpdir(),
  `zkhires-issuer-${randomBytes(8).toString("hex")}.db`,
);

beforeAll(async () => {
  process.env.TRACES_DB_PATH = TEST_DB;
  const kp = await generateKeypair();
  process.env.ISSUER_PRIV_KEY = kp.privKey.toString("hex");
}, 30000);

afterAll(() => {
  delete process.env.TRACES_DB_PATH;
});

function makeHackathonFinding(): Finding {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    run_id: "22222222-2222-4222-8222-222222222222",
    type: "hackathon_wins",
    count: 1,
    evidence_ids: ["33333333-3333-4333-8333-333333333333"],
    confidence_tier: "high",
  };
}

function makeEmployerFinding(): Finding {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    run_id: "55555555-5555-4555-8555-555555555555",
    type: "reputable_company",
    value: true,
    bracket_at_least: "500k_2m",
    jurisdiction: "uk",
    evidence_ids: ["66666666-6666-4666-8666-666666666666"],
    confidence_tier: "very_high",
  };
}

function freshSubjectKey(): string {
  return randomBytes(32).toString("hex");
}

describe("issuer/index", () => {
  it("issues a credential for a candidate hackathon_wins finding", async () => {
    const result = await issueCredential(
      [makeHackathonFinding()],
      freshSubjectKey(),
    );
    expect(result.proof_code).toMatch(/^ZKH-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(typeof result.nullifier).toBe("string");
    expect(result.nullifier.length).toBeGreaterThan(0);
    expect(result.public_claims.claim_type).toBe("hackathon_wins");
    expect(result.public_claims.claim_value).toBe("1");
  }, 30000);

  it("issues a credential for an employer reputable_company finding", async () => {
    const result = await issueCredential(
      [makeEmployerFinding()],
      freshSubjectKey(),
    );
    expect(result.proof_code).toMatch(/^ZKH-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(result.public_claims.claim_type).toBe("reputable_company");
    // claim_value now encodes funding bracket: 1 + bracketIndex("500k_2m") = 2
    expect(result.public_claims.claim_value).toBe("2");
  }, 30000);

  it("throws NullifierCollisionError on replay with same subject + claim_type", async () => {
    const subject = freshSubjectKey();
    await issueCredential([makeHackathonFinding()], subject);
    await expect(
      issueCredential([makeHackathonFinding()], subject),
    ).rejects.toBeInstanceOf(NullifierCollisionError);
  }, 30000);

  it("throws when given an empty findings array", async () => {
    await expect(issueCredential([], freshSubjectKey())).rejects.toThrow(
      /No findings/,
    );
  });

  it("throws when ISSUER_PRIV_KEY is not set", async () => {
    const original = process.env.ISSUER_PRIV_KEY;
    delete process.env.ISSUER_PRIV_KEY;
    try {
      await expect(
        issueCredential([makeHackathonFinding()], freshSubjectKey()),
      ).rejects.toThrow(/ISSUER_PRIV_KEY/);
    } finally {
      process.env.ISSUER_PRIV_KEY = original;
    }
  });

  it("returns a proof_code matching ZKH-XXXX-XXXX pattern", async () => {
    const r = await issueCredential(
      [makeHackathonFinding()],
      freshSubjectKey(),
    );
    expect(r.proof_code).toMatch(/^ZKH-[0-9A-F]{4}-[0-9A-F]{4}$/);
  }, 30000);
});
