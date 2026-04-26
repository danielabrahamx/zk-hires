import { randomUUID } from "node:crypto";

import { runCoordinator } from "@/agents/coordinator";
import { storeResearchSession, subscribe } from "@/trace/store";

/**
 * Stage 1 of the two-stage issuance flow for the candidate portal.
 *
 * Runs Researcher (certificate OCR + organizer profile) and Reviewer
 * over the uploaded certificate (and/or post links) and streams every
 * recordEvent to the browser as SSE. On completion the result is
 * persisted as a research_session row keyed by a fresh session_id;
 * stage 2 (POST /api/issue/candidate) picks that row up to mint a
 * credential.
 */

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid form data" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fileEntry = formData.get("file");
  const rawLinks = formData.get("postLinks");

  let postLinks: string[] = [];
  if (typeof rawLinks === "string" && rawLinks.trim()) {
    try {
      const parsed = JSON.parse(rawLinks) as unknown;
      if (Array.isArray(parsed)) {
        postLinks = parsed.filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0
        );
      }
    } catch {
      // ignore malformed
    }
  }

  const hasFile = fileEntry instanceof File;
  const hasLinks = postLinks.length > 0;

  if (!hasFile && !hasLinks) {
    return new Response(
      JSON.stringify({
        error: "Provide a certificate file or at least one post link",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let buffer: Buffer | null = null;
  let mimeType = "";
  if (hasFile) {
    mimeType = fileEntry.type || "application/octet-stream";
    if (mimeType !== "application/pdf" && !mimeType.startsWith("image/")) {
      return new Response(
        JSON.stringify({
          error: "File must be a PDF or image (jpeg, png, webp, gif)",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    if (fileEntry.size > MAX_FILE_BYTES) {
      return new Response(
        JSON.stringify({ error: "File too large (max 10 MB)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    buffer = Buffer.from(await fileEntry.arrayBuffer());
  }

  const researcherInput =
    hasFile && buffer
      ? {
          claim_type: "hackathon_wins" as const,
          file: buffer,
          mimeType,
          postLinks: hasLinks ? postLinks : undefined,
        }
      : { claim_type: "hackathon_wins" as const, postLinks };

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
        // This makes every researcher trace event stream live to the browser
        // instead of being batched and replayed after the fact.
        const runId = randomUUID();

        const stepEmit = (label: string) => {
          send("step", { label });
        };

        // Subscribe before calling runResearcher. tool_result events that
        // carry a full Evidence object are also re-emitted as "evidence" SSE
        // events so the frontend renders evidence cards as each one is collected.
        unsubscribe = subscribe(runId, (wireEvent) => {
          send("trace", wireEvent);
          const d = wireEvent.data as Record<string, unknown> | null | undefined;
          if (d && d.evidence && typeof d.evidence === "object" && !Array.isArray(d.evidence)) {
            send("evidence", d.evidence);
          }
        });

        const result = await runCoordinator({
          flow: "candidate",
          researcherInput,
          runId,
          emit: stepEmit,
        });

        const sessionId = randomUUID();
        storeResearchSession({
          session_id: sessionId,
          run_id: runId,
          claim_type: "hackathon_wins",
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
