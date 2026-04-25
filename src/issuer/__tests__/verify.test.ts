import { describe, expect, it } from "vitest";
import { verifyProof } from "../verify";

describe("issuer/verify", () => {
  it("module loads and exports verifyProof as a function", () => {
    expect(typeof verifyProof).toBe("function");
  });
});
