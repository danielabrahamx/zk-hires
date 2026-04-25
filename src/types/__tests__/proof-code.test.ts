import { describe, it, expect } from "vitest";
import { generateProofCode } from "../proof-code";

describe("generateProofCode", () => {
  it("matches the ZKH-XXXX-XXXX format with uppercase hex", () => {
    const code = generateProofCode();
    expect(code).toMatch(/^ZKH-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("produces 1000 unique codes", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateProofCode());
    expect(set.size).toBe(1000);
  });
});
