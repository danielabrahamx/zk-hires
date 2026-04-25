import { randomBytes } from "node:crypto";

/**
 * generateProofCode - returns ZKH-XXXX-XXXX where each XXXX is 4 random
 * uppercase hex chars (16 bits of entropy each, 32 bits total).
 *
 * Codes are user-visible identifiers for issued credentials. They map to
 * the proof JSON stored server-side. Not security-critical on their own;
 * the actual verification uses the proof + issuer pubkey.
 */
export function generateProofCode(): string {
  const buf = randomBytes(4); // 4 bytes = 8 hex chars total
  const hex = buf.toString("hex").toUpperCase();
  return `ZKH-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}
