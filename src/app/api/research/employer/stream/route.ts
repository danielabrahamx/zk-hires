import { randomUUID } from "node:crypto";

import { runCoordinator } from "@/agents/coordinator";
import { storeResearchSession, subscribe } from "@/trace/store";

/**
 * Stage 1 of the two-stage issuance flow for the employer portal.
 *
 * Runs Researcher (Companies House + web-lookup) and Reviewer over the
 * supplied company number / supplementary URL and streams every
 * recordEvent to the browser as SSE. On completion the result is
 * persisted as a research_session row keyed by a fresh session_id;
 * stage 2 (POST /api/issue/employer) picks that row up to mint a
 * credential.
 */

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function POST(request: Request) {
  let body: { companyNumber?: string; supplementaryUrl?: string };
  try {
    body = (await request.json()) as {
      companyNumber?: string;
      supplementaryUrl?: string;
    };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cn = body.companyNumber?.trim() || undefined;
  const url = body.supplementaryUrl?.trim() || undefined;

  if (!cn && !url) {
    return new Response(
      JSON.stringify({
        error: "Provide at least one of companyNumber or supplementaryUrl",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      let unsubscribe: (() => void) | null = null;

      try {
        // Generate runId here so we can subscribe BEFORE the researcher starts.
        const runId = randomUUID();

        const stepEmit = (label: string) => {
          send("step", { label });
        };

        // Subscribe before calling runResearcher. tool_result events carrying
        // a full Evidence object are re-emitted as "evidence" SSE events for
        // immediate frontend rendering.
        unsubscribe = subscribe(runId, (wireEvent) => {
          send("trace", wireEvent);
          const d = wireEvent.data as Record<string, unknown> | null | undefined;
          if (d && d.evidence && typeof d.evidence === "object" && !Array.isArray(d.evidence)) {
            send("evidence", d.evidence);
          }
        });

        const result = await runCoordinator({
          flow: "employer",
          researcherInput: {
            claim_type: "reputable_company",
            companyNumber: cn,
            supplementaryUrl: url,
          },
          runId,
          emit: stepEmit,
        });

        const sessionId = randomUUID();
        storeResearchSession({
          session_id: sessionId,
          run_id: runId,
          claim_type: "reputable_company",
          payload: JSON.stringify({
            evidence: result.evidence,
            findings: result.findings,
            gap: result.gaps[0] ?? null,
          }),
          created_at: Date.now(),
        });

        if (result.gaps.length > 0) {
          send("gap", result.gaps[0]);
        }

        send("research_done", {
          session_id: sessionId,
          evidence: result.evidence,
          findings: result.findings,
        });
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (unsubscribe) unsubscribe();
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
