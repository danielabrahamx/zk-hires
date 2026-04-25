import { NextResponse } from "next/server";

import { runResearcher } from "@/agents/researcher";
import { runReviewer } from "@/agents/reviewer";
import { issueCredential } from "@/issuer";
import { storeCredential } from "@/trace/store";

export async function POST(request: Request) {
  let body: { companyNumber?: string; supplementaryUrl?: string };
  try {
    body = (await request.json()) as {
      companyNumber?: string;
      supplementaryUrl?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { companyNumber, supplementaryUrl } = body;

  if (!companyNumber?.trim()) {
    return NextResponse.json(
      { error: "companyNumber is required" },
      { status: 400 }
    );
  }
  if (!supplementaryUrl?.trim()) {
    return NextResponse.json(
      { error: "supplementaryUrl is required" },
      { status: 400 }
    );
  }

  try {
    const { evidence, runId } = await runResearcher({
      claim_type: "reputable_company",
      companyNumber: companyNumber.trim(),
      supplementaryUrl: supplementaryUrl.trim(),
    });

    const { findings, gaps } = await runReviewer(evidence, "employer", runId);

    if (gaps.length > 0 || findings.length === 0) {
      return NextResponse.json({
        gap: gaps[0] ?? {
          claim_type: "reputable_company",
          reason: "No findings produced",
          missing_evidence: [],
        },
      });
    }

    const issued = await issueCredential(findings);

    const now = Math.floor(Date.now() / 1000);
    storeCredential({
      proof_code: issued.proof_code,
      claim_type: findings[0].type,
      claim_value: "1",
      proof_json: issued.proof_json,
      public_claims: issued.public_claims,
      nullifier: issued.nullifier,
      issued_at: now,
      expires_at: now + 365 * 24 * 3600,
    });

    return NextResponse.json({
      proof_code: issued.proof_code,
      public_claims: issued.public_claims,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
