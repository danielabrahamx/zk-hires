import { NextResponse } from "next/server";

import { runResearcher } from "@/agents/researcher";
import { runReviewer } from "@/agents/reviewer";
import { issueCredential } from "@/issuer";
import { storeCredential } from "@/trace/store";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function encode(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const fileEntry = formData.get("file");
  const rawLinks = formData.get("postLinks");

  let postLinks: string[] = [];
  if (typeof rawLinks === "string" && rawLinks.trim()) {
    try {
      const parsed = JSON.parse(rawLinks) as unknown;
      if (Array.isArray(parsed)) {
        postLinks = parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      }
    } catch {
      // ignore malformed
    }
  }

  const hasFile = fileEntry instanceof File;
  const hasLinks = postLinks.length > 0;

  if (!hasFile && !hasLinks) {
    return NextResponse.json(
      { error: "Provide a certificate file or at least one post link" },
      { status: 400 }
    );
  }

  let buffer: Buffer | null = null;
  let mimeType = "";
  if (hasFile) {
    mimeType = fileEntry.type || "application/octet-stream";
    if (mimeType !== "application/pdf" && !mimeType.startsWith("image/")) {
      return NextResponse.json(
        { error: "File must be a PDF or image (jpeg, png, webp, gif)" },
        { status: 400 }
      );
    }
    buffer = Buffer.from(await fileEntry.arrayBuffer());
  }

  const researcherInput = hasFile && buffer
    ? { claim_type: "hackathon_wins" as const, file: buffer, mimeType, postLinks: hasLinks ? postLinks : undefined }
    : { claim_type: "hackathon_wins" as const, postLinks };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encode(data));
      const emit = (label: string) => send({ type: "step", label });

      try {
        const { evidence, runId } = await runResearcher(researcherInput, emit);

        emit("Reviewing evidence...");
        const { findings, gaps } = await runReviewer(evidence, "candidate", runId);

        if (gaps.length > 0 || findings.length === 0) {
          send({
            type: "gap",
            ...(gaps[0] ?? {
              claim_type: "hackathon_wins",
              reason: "No findings produced",
              missing_evidence: [],
            }),
          });
          return;
        }

        emit("Issuing credential...");
        const issued = await issueCredential(findings);
        const now = Math.floor(Date.now() / 1000);
        storeCredential({
          proof_code: issued.proof_code,
          claim_type: findings[0].type,
          claim_value: findings[0].type === "hackathon_wins" ? String(findings[0].count) : "1",
          proof_json: issued.proof_json,
          public_claims: issued.public_claims,
          nullifier: issued.nullifier,
          issued_at: now,
          expires_at: now + 365 * 24 * 3600,
        });

        send({ type: "result", proof_code: issued.proof_code, public_claims: issued.public_claims });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
