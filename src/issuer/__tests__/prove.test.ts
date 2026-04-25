import { describe, expect, it } from "vitest";
import { proveCredential } from "../prove";

describe("issuer/prove", () => {
  it("module loads and exports proveCredential as a function", () => {
    expect(typeof proveCredential).toBe("function");
  });
});
