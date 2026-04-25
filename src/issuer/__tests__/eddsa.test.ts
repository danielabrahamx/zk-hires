import { describe, expect, it } from "vitest";
import {
  generateKeypair,
  sign,
  verify,
  payloadHash,
} from "../eddsa";

describe("issuer/eddsa", () => {
  it("round-trips: sign then verify returns true", async () => {
    const { privKey, pubKey } = await generateKeypair();
    const msg = await payloadHash([1n, 2n, 3n]);
    const sig = await sign(privKey, msg);
    const ok = await verify(pubKey, msg, sig);
    expect(ok).toBe(true);
  }, 30000);

  it("rejects a signature verified with a different pubkey", async () => {
    const a = await generateKeypair();
    const b = await generateKeypair();
    const msg = await payloadHash([42n, 99n]);
    const sig = await sign(a.privKey, msg);
    const ok = await verify(b.pubKey, msg, sig);
    expect(ok).toBe(false);
  }, 30000);

  it("payloadHash is deterministic for identical inputs", async () => {
    const h1 = await payloadHash([7n, 11n, 13n]);
    const h2 = await payloadHash([7n, 11n, 13n]);
    expect(h1).toBe(h2);
    expect(typeof h1).toBe("bigint");
  }, 30000);
});
