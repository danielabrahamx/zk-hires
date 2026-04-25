import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { buildEddsa, buildPoseidon } from "circomlibjs";

/**
 * BabyJubjub EdDSA + Poseidon helpers, matching the Noir circuit's
 * verification of `eddsa_poseidon_verify`.
 *
 * Keys and signatures are exposed as plain bigints / [bigint, bigint]
 * tuples for consumption by the Noir prover - which expects Field-sized
 * decimals/hex.
 */

export type Keypair = {
  privKey: Buffer; // 32 bytes
  pubKey: [bigint, bigint]; // [x, y] BabyJubjub point
};

export type Signature = {
  R8: [bigint, bigint]; // R8 point [x, y]
  S: bigint; // scalar
};

// circomlibjs has no exported types - keep cache loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _eddsa: any | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _poseidon: any | null = null;

async function getEddsa() {
  if (!_eddsa) _eddsa = await buildEddsa();
  return _eddsa;
}

async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

export async function generateKeypair(): Promise<Keypair> {
  const eddsa = await getEddsa();
  const privKey = Buffer.from(randomBytes(32));
  const pubKey = eddsa.prv2pub(privKey);
  return {
    privKey,
    pubKey: [eddsa.F.toObject(pubKey[0]), eddsa.F.toObject(pubKey[1])],
  };
}

export async function derivePubkey(privKey: Buffer): Promise<[bigint, bigint]> {
  const eddsa = await getEddsa();
  const pubKey = eddsa.prv2pub(privKey);
  return [eddsa.F.toObject(pubKey[0]), eddsa.F.toObject(pubKey[1])];
}

export async function sign(
  privKey: Buffer,
  messageHash: bigint,
): Promise<Signature> {
  const eddsa = await getEddsa();
  // The eddsa.signPoseidon function takes a privKey buffer and a Field element.
  // Use the F module to lift the bigint into a Field element.
  const msgField = eddsa.F.e(messageHash);
  const rawSig = eddsa.signPoseidon(privKey, msgField);
  return {
    R8: [eddsa.F.toObject(rawSig.R8[0]), eddsa.F.toObject(rawSig.R8[1])],
    S: BigInt(rawSig.S.toString()),
  };
}

export async function verify(
  pubKey: [bigint, bigint],
  messageHash: bigint,
  sig: Signature,
): Promise<boolean> {
  const eddsa = await getEddsa();
  const msgField = eddsa.F.e(messageHash);
  const pubKeyPoints: [unknown, unknown] = [
    eddsa.F.e(pubKey[0]),
    eddsa.F.e(pubKey[1]),
  ];
  const rawSig = {
    R8: [eddsa.F.e(sig.R8[0]), eddsa.F.e(sig.R8[1])] as [unknown, unknown],
    S: sig.S,
  };
  return eddsa.verifyPoseidon(msgField, rawSig, pubKeyPoints);
}

/**
 * Poseidon hash over an array of bigint Field elements. Matches what the
 * Noir circuit's `poseidon::bn254::hash_N` produces for the same inputs.
 */
export async function payloadHash(fields: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon(fields);
  return BigInt(poseidon.F.toString(hash));
}
