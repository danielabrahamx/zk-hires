import { describe, it, expect } from "vitest";
import { CredentialSchema, hashCredential } from "../credential";

const goodCredential = {
  subject_pubkey: "0xabc123",
  claim_type: "hackathon_wins" as const,
  claim_value: "4",
  evidence_root: "0xdeadbeef",
  trace_root: "0xfeedface",
  issuer_id: "0x1111",
  issued_at: 1714000000,
  expires_at: 1745536000,
};

describe("CredentialSchema", () => {
  it("accepts a well-formed credential", () => {
    expect(CredentialSchema.safeParse(goodCredential).success).toBe(true);
  });

  it("rejects unknown claim_type", () => {
    const bad = { ...goodCredential, claim_type: "best_dressed" };
    expect(CredentialSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects negative timestamps", () => {
    const bad = { ...goodCredential, issued_at: -1 };
    expect(CredentialSchema.safeParse(bad).success).toBe(false);
  });
});

describe("hashCredential", () => {
  it("returns a deterministic hash for identical input", () => {
    const a = hashCredential(goodCredential);
    const b = hashCredential({ ...goodCredential });
    expect(a).toBe(b);
    expect(typeof a).toBe("bigint");
    expect(a > 0n).toBe(true);
  });

  it("returns a different hash when input changes", () => {
    const original = hashCredential(goodCredential);
    const tweakedClaim = hashCredential({ ...goodCredential, claim_value: "5" });
    const tweakedSubject = hashCredential({ ...goodCredential, subject_pubkey: "0xdef456" });
    expect(tweakedClaim).not.toBe(original);
    expect(tweakedSubject).not.toBe(original);
    expect(tweakedClaim).not.toBe(tweakedSubject);
  });
});
