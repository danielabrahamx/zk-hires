import { buildPoseidon } from "circomlibjs";

/**
 * Thin wrapper around circomlibjs Poseidon (BN254) that returns a bigint.
 * Mirrors the hash that `poseidon::bn254::hash_N` computes inside the Noir
 * circuit, so values cross the trust boundary unchanged.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _poseidon: any | null = null;

async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

export async function poseidonHash(fields: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  const result = poseidon(fields);
  return BigInt(poseidon.F.toString(result));
}
