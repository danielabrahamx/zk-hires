import { describe, expect, it } from "vitest";
import { poseidonHash } from "../poseidon";

describe("issuer/poseidon", () => {
  it("is deterministic for the same inputs", async () => {
    const a = await poseidonHash([0n, 0n]);
    const b = await poseidonHash([0n, 0n]);
    expect(a).toBe(b);
    expect(typeof a).toBe("bigint");
    expect(a).toBeGreaterThan(0n);
  }, 30000);
});
