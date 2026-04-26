import Anthropic from "@anthropic-ai/sdk";

import { emitEvent } from "@/trace/store";
import type { Evidence } from "@/types/evidence";
import type { Finding } from "@/types/finding";
import type { Gap } from "@/types/gap";
import { MODEL_SYNTHESIS } from "@/config/runtime";

/**
 * Grounded reasoning - additive layer over the deterministic reviewer.
 *
 * Calls Claude with the Evidence bag attached as `document` content blocks
 * with the Citations API enabled. The model returns a short prose
 * explanation of WHY the deterministic outcome (Finding or Gap) is
 * justified, with structured citations pointing to specific evidence
 * spans. Streamed to the dashboard so the Reviewer step shows actual
 * reasoning text instead of a spinner.
 *
 * Failure is non-fatal: if the API call errors, we emit an error trace
 * event and the issuer pipeline continues with the deterministic outcome.
 */

interface DocumentBlock {
  title: string;
  text: string;
}

function evidenceToDocument(ev: Evidence): DocumentBlock {
  const lines: string[] = [
    `source: ${ev.source}`,
    `confidence_tier: ${ev.confidence_tier}`,
    `source_url: ${ev.source_url ?? "—"}`,
    `retrieved_at: ${ev.retrieved_at}`,
    `signal_type: ${ev.signal_type}`,
    "",
    "matched_data_points:",
    ...ev.matched_data_points.map((d) => `  - ${d}`),
  ];
  let title = ev.source as string;
  if (ev.source_url) {
    try {
      title = `${ev.source}: ${new URL(ev.source_url).hostname}`;
    } catch {
      /* leave title as bare source */
    }
  }
  return { title, text: lines.join("\n") };
}

export interface GroundedReasoning {
  reasoning: string;
  citations: unknown[];
}

export async function generateGroundedReasoning(
  evidence: Evidence[],
  outcome: Finding | Gap,
  runId: string
): Promise<GroundedReasoning> {
  if (evidence.length === 0) {
    return {
      reasoning: "No evidence was supplied to reason about.",
      citations: [],
    };
  }

  const isGap = !("type" in outcome);
  const summary = isGap
    ? `gap (category=${outcome.category}, reason="${outcome.reason}")`
    : `finding (type=${outcome.type}, confidence_tier=${outcome.confidence_tier})`;

  const documents = evidence.map(evidenceToDocument);

  const prompt = `You are an audit-trail explainer. The Reviewer pipeline produced this outcome from the attached evidence:

  ${summary}

In 2-3 sentences, explain why this outcome is justified by the evidence. Be terse and factual. Cite the evidence directly. If the outcome is a gap, name the specific signal that was missing or insufficient.`;

  emitEvent({
    run_id: runId,
    agent: "reviewer.derivation",
    kind: "tool_call",
    message: `Grounded reasoning via ${MODEL_SYNTHESIS}`,
    data: {
      model: MODEL_SYNTHESIS,
      evidence_count: evidence.length,
      outcome: isGap ? "gap" : "finding",
    },
  });

  const client = new Anthropic();

  try {
    // Streaming so chunks land in the dashboard as they arrive.
    const stream = client.messages.stream({
      model: MODEL_SYNTHESIS,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [
            ...documents.map((d) => ({
              type: "document" as const,
              source: {
                type: "text" as const,
                media_type: "text/plain" as const,
                data: d.text,
              },
              title: d.title,
              citations: { enabled: true },
            })),
            { type: "text" as const, text: prompt },
          ],
        },
      ],
    });

    let buffered = "";
    let lastEmit = 0;
    const THROTTLE_MS = 250;
    stream.on("text", (delta) => {
      buffered += delta;
      const now = Date.now();
      if (now - lastEmit >= THROTTLE_MS) {
        lastEmit = now;
        emitEvent({
          run_id: runId,
          agent: "reviewer.derivation",
          kind: "tool_result",
          message: "Reasoning streaming",
          data: {
            model: MODEL_SYNTHESIS,
            streaming: true,
            partial_text: buffered.slice(-400),
            chars_so_far: buffered.length,
          },
        });
      }
    });

    const final = await stream.finalMessage();

    let reasoning = "";
    const citations: unknown[] = [];
    for (const block of final.content) {
      if (block.type === "text") {
        reasoning += block.text;
        // The SDK adds a `citations` field on text blocks when the
        // Citations API is engaged; the type is provider-specific so we
        // cast loosely.
        const maybe = block as unknown as { citations?: unknown[] };
        if (Array.isArray(maybe.citations)) {
          for (const c of maybe.citations) citations.push(c);
        }
      }
    }

    emitEvent({
      run_id: runId,
      agent: "reviewer.derivation",
      kind: "decision",
      message: "Grounded reasoning produced",
      data: {
        streaming: false,
        reasoning,
        citation_count: citations.length,
        citations,
        cache_read_input_tokens: final.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: final.usage.cache_creation_input_tokens ?? 0,
        input_tokens: final.usage.input_tokens,
        output_tokens: final.usage.output_tokens,
      },
    });

    return { reasoning: reasoning.trim(), citations };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitEvent({
      run_id: runId,
      agent: "reviewer.derivation",
      kind: "error",
      message: `Grounded reasoning failed: ${message}`,
      data: { model: MODEL_SYNTHESIS },
      error: message,
    });
    return { reasoning: "", citations: [] };
  }
}
