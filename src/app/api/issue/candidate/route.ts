import { NextResponse } from "next/server";

import { runResearcher } from "@/agents/researcher";
import { runReviewer } from "@/agents/reviewer";
import { issueCredential } from "@/issuer";
import { storeCredential } from "@/trace/store";

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const mimeType = file.type || "application/octet-stream";
  if (mimeType !== "application/pdf" && !mimeType.startsWith("image/")) {
    return NextResponse.json(
      { error: "File must be a PDF or image (jpeg, png, webp, gif)" },
      { status: 400 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    const { evidence, runId } = await runResearcher({
      claim_type: "hackathon_wins",
      file: buffer,
      mimeType,
    });

    const { findings, gaps } = await runReviewer(evidence, "candidate", runId);

    if (gaps.length > 0 || findings.length === 0) {
      return NextResponse.json({
        gap: gaps[0] ?? {
          claim_type: "hackathon_wins",
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
      claim_value:
        findings[0].type === "hackathon_wins"
          ? String(findings[0].count)
          : "1",
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
