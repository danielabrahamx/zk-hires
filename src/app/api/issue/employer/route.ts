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

  if (!companyNumber?.trim() && !supplementaryUrl?.trim()) {
    return NextResponse.json(
      { error: "Provide at least one of companyNumber or supplementaryUrl" },
      { status: 400 }
    );
  }

  const cn = companyNumber?.trim() || undefined;
  const url = supplementaryUrl?.trim() || undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encode(data));
      const emit = (label: string) => send({ type: "step", label });

      try {
        const { evidence, runId } = await runResearcher(
          { claim_type: "reputable_company", companyNumber: cn, supplementaryUrl: url },
          emit
        );

        emit("Reviewing evidence...");
        const { findings, gaps } = await runReviewer(evidence, "employer", runId);

        if (gaps.length > 0 || findings.length === 0) {
          send({
            type: "gap",
            ...(gaps[0] ?? {
              claim_type: "reputable_company",
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
          claim_value: "1",
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
