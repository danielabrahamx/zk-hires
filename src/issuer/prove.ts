import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { createRequire } from "node:module";
import { emitEvent } from "@/trace/store";

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
 *
 * Tracing: when `runId` is supplied, emits a tool_call before noir.execute
 * and a tool_result after generateProof. The trace data carries
 * publicInputs.length and proof byte length so the timeline can show the
 * proof-gen step without exposing private witness.
 */
export async function proveCredential(
  inputs: ProveInputs,
  runId?: string,
): Promise<ProofResult> {
  const api = await Barretenberg.new();
  const backend = new UltraHonkBackend(circuitJson.bytecode, api);
  const noir = new Noir(circuitJson);

  // Noir expects 0x-prefixed 32-byte hex strings for Field inputs.
  const noirInputs: Record<string, string> = {};
  for (const [key, val] of Object.entries(inputs)) {
    noirInputs[key] = "0x" + (val as bigint).toString(16).padStart(64, "0");
  }

  if (runId) {
    emitEvent({
      run_id: runId,
      agent: "issuer.prover",
      kind: "tool_call",
      message: "noir:execute",
      data: { input_count: Object.keys(noirInputs).length },
    });
  }

  const { witness } = await noir.execute(noirInputs);
  const proofData = await backend.generateProof(witness);

  if (runId) {
    emitEvent({
      run_id: runId,
      agent: "issuer.prover",
      kind: "tool_result",
      message: "noir:proof_generated",
      data: {
        public_inputs_length: proofData.publicInputs.length,
        proof_byte_length: proofData.proof.length,
      },
    });
  }

  return {
    proof: proofData.proof,
    publicInputs: proofData.publicInputs,
  };
}
