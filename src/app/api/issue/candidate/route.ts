import { NextResponse } from "next/server";

import { issueCredential } from "@/issuer";
import {
  lookupResearchSession,
  markResearchSessionConsumed,
  storeCredential,
} from "@/trace/store";
import type { Finding } from "@/types/finding";
import type { Gap } from "@/types/gap";
import type { Evidence } from "@/types/evidence";

/**
 * Stage 2 of the candidate issuance flow.
 *
 * Body: { session_id: string } - the id returned by the matching
 * /api/research/candidate/stream completion.
 *
 * Looks up the persisted research session, verifies it has a viable
 * Finding (and isn't already consumed), then signs and stores a
 * credential. Returns the proof code, public claims, signed proof
 * JSON and nullifier.
 */

interface ResearchPayload {
  evidence: Evidence[];
  findings: Finding[];
  gap: Gap | null;
}

export async function POST(request: Request) {
  let body: { session_id?: string };
  try {
    body = (await request.json()) as { session_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body.session_id?.trim();
  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 }
    );
  }

  const session = lookupResearchSession(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: "Research session not found" },
      { status: 404 }
    );
  }

  if (session.consumed_at !== null) {
    return NextResponse.json(
      { error: "Session already used" },
      { status: 409 }
    );
  }

  if (session.claim_type !== "hackathon_wins") {
    return NextResponse.json(
      { error: "Session claim_type does not match candidate flow" },
      { status: 400 }
    );
  }

  let payload: ResearchPayload;
  try {
    payload = JSON.parse(session.payload) as ResearchPayload;
  } catch {
    return NextResponse.json(
      { error: "Corrupt research session payload" },
      { status: 500 }
    );
  }

  if (payload.gap) {
    return NextResponse.json(
      { error: "Cannot issue: research returned a gap", gap: payload.gap },
      { status: 400 }
    );
  }

  if (!payload.findings || payload.findings.length === 0) {
    return NextResponse.json(
      { error: "Cannot issue: no findings in research session" },
      { status: 400 }
    );
  }

  try {
    const issued = await issueCredential(payload.findings);
    const finding = payload.findings[0];
    const claim_value =
      finding.type === "hackathon_wins" ? String(finding.count) : "1";
    const now = Math.floor(Date.now() / 1000);

    storeCredential({
      proof_code: issued.proof_code,
      claim_type: finding.type,
      claim_value,
      proof_json: issued.proof_json,
      public_claims: issued.public_claims,
      nullifier: issued.nullifier,
      issued_at: now,
      expires_at: now + 365 * 24 * 3600,
    });

    markResearchSessionConsumed(sessionId);

    return NextResponse.json({
      proof_code: issued.proof_code,
      public_claims: issued.public_claims,
      proof_json: issued.proof_json,
      nullifier: issued.nullifier,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
