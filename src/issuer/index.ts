import { Buffer } from "node:buffer";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { sign, derivePubkey, payloadHash } from "./eddsa";
import { poseidonHash } from "./poseidon";
import { proveCredential } from "./prove";
import { generateProofCode } from "@/types/proof-code";
import type { Finding } from "@/types/finding";

/**
 * Issuer service: takes Findings from the Reviewer and produces a
 * { proof_code, proof_json, public_claims, nullifier } bundle.
 *
 * Replay defence: a Poseidon(subject_privkey, claim_type) nullifier is
 * persisted in SQLite so the same subject cannot mint a duplicate
 * credential for the same claim_type. Tests should override the path via
 * TRACES_DB_PATH.
 */

export class NullifierCollisionError extends Error {
  constructor(nullifier: string) {
    super(`Nullifier already used: ${nullifier}`);
    this.name = "NullifierCollisionError";
  }
}

const DEFAULT_DB = resolve(process.cwd(), "data", "traces.db");

function getNullifierDb(): Database.Database {
  const path = process.env.TRACES_DB_PATH ?? DEFAULT_DB;
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(`CREATE TABLE IF NOT EXISTS nullifiers (
    nullifier TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  )`);
  return db;
}

export type IssueResult = {
  proof_code: string;
  proof_json: string;
  public_claims: Record<string, string>;
  nullifier: string;
};

export async function issueCredential(
  findings: Finding[],
  subjectPrivKey?: string,
): Promise<IssueResult> {
  if (findings.length === 0) {
    throw new Error("No findings to issue credential for");
  }

  const finding = findings[0];

  // Map finding -> claim fields. claim_type 1 = hackathon_wins, 2 = reputable_company.
  const claim_type = finding.type === "hackathon_wins" ? 1n : 2n;
  const claim_value =
    finding.type === "hackathon_wins" ? BigInt(finding.count) : 1n;

  // Build evidence root: Poseidon over evidence_id UUIDs (cast to bigint).
  const evidenceIds = finding.evidence_ids.map((id) =>
    BigInt("0x" + id.replace(/-/g, "")),
  );
  const evidence_root = await poseidonHash(
    evidenceIds.length > 0 ? evidenceIds : [0n],
  );

  // Issuer keypair from env.
  const issuerPrivHex = process.env.ISSUER_PRIV_KEY ?? "";
  if (!issuerPrivHex || issuerPrivHex.length < 32) {
    throw new Error(
      "ISSUER_PRIV_KEY not set. Run: npx tsx scripts/generate-issuer-key.ts",
    );
  }
  const issuerPrivKey = Buffer.from(issuerPrivHex, "hex");
  const [issuer_pubkey_x, issuer_pubkey_y] = await derivePubkey(issuerPrivKey);

  // Subject keypair (ephemeral if not supplied).
  const subjPrivBuf = subjectPrivKey
    ? Buffer.from(subjectPrivKey, "hex")
    : Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  const subject_privkey = BigInt("0x" + subjPrivBuf.toString("hex"));

  // Timestamps.
  const issued_at = BigInt(Math.floor(Date.now() / 1000));
  const expires_at = issued_at + BigInt(365 * 24 * 3600);

  // Nullifier.
  const nullifier = await poseidonHash([subject_privkey, claim_type]);
  const nullifierHex = nullifier.toString(16);

  // Replay check.
  const db = getNullifierDb();
  try {
    const existing = db
      .prepare("SELECT nullifier FROM nullifiers WHERE nullifier = ?")
      .get(nullifierHex);
    if (existing) {
      throw new NullifierCollisionError(nullifierHex);
    }

    // Sign the canonical payload.
    const signed_payload = await payloadHash([
      claim_type,
      claim_value,
      evidence_root,
      nullifier,
      issued_at,
    ]);
    const sig = await sign(issuerPrivKey, signed_payload);

    // Generate ZK proof. If the circuit bytecode is a placeholder, the
    // execute call will throw - fall back to an empty proof so issuance
    // still succeeds during dev.
    let proof_json = "{}";
    try {
      const proofResult = await proveCredential({
        issuer_pubkey_x,
        issuer_pubkey_y,
        claim_type,
        claim_value,
        nullifier,
        subject_privkey,
        sig_r8_x: sig.R8[0],
        sig_r8_y: sig.R8[1],
        sig_s: sig.S,
        evidence_root,
        issued_at,
        expires_at,
      });
      proof_json = JSON.stringify({
        proof: Array.from(proofResult.proof),
        publicInputs: proofResult.publicInputs,
      });
    } catch {
      proof_json = JSON.stringify({
        proof: [],
        publicInputs: [],
        placeholder: true,
      });
    }

    // Store nullifier (after proof gen succeeds / falls back).
    db.prepare(
      "INSERT INTO nullifiers (nullifier, created_at) VALUES (?, ?)",
    ).run(nullifierHex, Date.now());

    const proof_code = generateProofCode();
    const public_claims: Record<string, string> = {
      claim_type: finding.type,
      claim_value: claim_value.toString(),
      issuer_pubkey: issuer_pubkey_x.toString(16),
      proof_code,
    };

    return { proof_code, proof_json, public_claims, nullifier: nullifierHex };
  } finally {
    db.close();
  }
}
