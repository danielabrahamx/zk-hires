import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * CredentialSchema - the issuer's signed payload before ZK proof gen.
 *
 * Spec §5.3:
 *   { subject_pubkey, claim_type, claim_value, evidence_root,
 *     trace_root, issuer_id, issued_at, expires_at }
 *
 * All field values are stored as hex / decimal strings so the schema is
 * JSON-safe. The Issuer converts them to Field elements at sign / prove
 * time. `claim_value` is always a stringified bigint to give us one wire
 * representation for both the candidate count and the employer bracket.
 */

export const CredentialSchema = z.object({
  subject_pubkey: z.string(), // BabyJubjub pubkey, hex-encoded compressed point
  claim_type: z.enum(["hackathon_wins", "reputable_company"]),
  claim_value: z.string(), // stringified bigint (e.g. "4" or "1")
  evidence_root: z.string(), // hex Poseidon root over the Evidence bundle
  trace_root: z.string(), // hex Poseidon root over the run's TraceEvents
  issuer_id: z.string(), // BabyJubjub issuer pubkey, hex
  issued_at: z.number().int().nonnegative(), // unix seconds
  expires_at: z.number().int().nonnegative(), // unix seconds
});

export type Credential = z.infer<typeof CredentialSchema>;

/**
 * hashCredential - deterministic hash of a credential payload.
 *
 * TODO Phase 4: replace with real Poseidon (BN254) computed via circomlibjs
 * so the hash matches what the Noir circuit computes. For now we use sha256
 * over a canonical JSON encoding so the schema and tests can ship.
 *
 * Returns a bigint so the API surface matches the eventual Poseidon output.
 */
export function hashCredential(payload: Credential): bigint {
  // Canonicalise: stable key order, no whitespace.
  const canonical = JSON.stringify({
    subject_pubkey: payload.subject_pubkey,
    claim_type: payload.claim_type,
    claim_value: payload.claim_value,
    evidence_root: payload.evidence_root,
    trace_root: payload.trace_root,
    issuer_id: payload.issuer_id,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
  });
  const digest = sha256(utf8ToBytes(canonical));
  // Convert byte array to hex bigint.
  let hex = "0x";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}
