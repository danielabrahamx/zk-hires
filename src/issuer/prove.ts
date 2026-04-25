import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { createRequire } from "node:module";

// Use createRequire so this works in both CJS and ESM Node contexts and
// avoids TypeScript erroring on JSON imports without resolveJsonModule
// for files outside src/.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const circuitJson: any = require("../../circuit/target/prove_credential.json");

export type ProveInputs = {
  issuer_pubkey_x: bigint;
  issuer_pubkey_y: bigint;
  claim_type: bigint;
  claim_value: bigint;
  nullifier: bigint;
  subject_privkey: bigint;
  sig_r8_x: bigint;
  sig_r8_y: bigint;
  sig_s: bigint;
  evidence_root: bigint;
  issued_at: bigint;
  expires_at: bigint;
};

export type ProofResult = {
  proof: Uint8Array;
  publicInputs: string[];
};

/**
 * Generate a Honk proof for the prove_credential circuit.
 *
 * Works in both Node.js (tests / issuer service) and the browser. Callers
 * are responsible for adding the `"use client"` boundary if used in the
 * Next.js app router.
 */
export async function proveCredential(inputs: ProveInputs): Promise<ProofResult> {
  const api = await Barretenberg.new();
  const backend = new UltraHonkBackend(circuitJson.bytecode, api);
  const noir = new Noir(circuitJson);

  // Noir expects 0x-prefixed 32-byte hex strings for Field inputs.
  const noirInputs: Record<string, string> = {};
  for (const [key, val] of Object.entries(inputs)) {
    noirInputs[key] = "0x" + (val as bigint).toString(16).padStart(64, "0");
  }

  const { witness } = await noir.execute(noirInputs);
  const proofData = await backend.generateProof(witness);

  return {
    proof: proofData.proof,
    publicInputs: proofData.publicInputs,
  };
}
