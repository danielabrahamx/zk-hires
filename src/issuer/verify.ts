import { Barretenberg, UltraHonkVerifierBackend } from "@aztec/bb.js";

/**
 * Verify a Honk proof produced by `proveCredential`. Used by the verifier
 * page to confirm a credential without re-running the prover.
 *
 * The verifier needs the proving system's verification key. Callers must
 * supply it (it's small and can ship with the verifier UI / API).
 */
export async function verifyProof(
  proof: Uint8Array,
  publicInputs: string[],
  verificationKey: Uint8Array,
): Promise<boolean> {
  const api = await Barretenberg.new();
  const verifier = new UltraHonkVerifierBackend(api);
  return verifier.verifyProof({ proof, publicInputs, verificationKey });
}
