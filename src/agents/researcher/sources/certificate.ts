import Anthropic from "@anthropic-ai/sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { Evidence } from "@/types/evidence";

/**
 * Certificate upload source.
 *
 * Uses Claude vision to extract structured fields from a hackathon
 * certificate (PDF or image). Returns a normalized Evidence record per the
 * design spec §6. The Researcher orchestrator is expected to enrich the
 * organizer_profile / reputability_score fields separately.
 */

export class RefusalError extends Error {
  isRefusal = true;
  constructor(message?: string) {
    super(message ?? "Claude refused to extract: not a hackathon certificate");
    this.name = "RefusalError";
  }
}

const CertificateFieldsSchema = z.object({
  organizer_name: z.string(),
  event_name: z.string(),
  candidate_name: z.string(),
  year: z.string(),
});

type CertificateFields = z.infer<typeof CertificateFieldsSchema>;

const PROMPT =
  "Extract the following from this hackathon certificate: organizer_name, event_name, candidate_name, year. Return ONLY a JSON object with these four string fields. If this is not a hackathon certificate, return exactly the string REFUSED.";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function buildContentBlock(
  file: Buffer,
  mimeType: string
): Anthropic.ContentBlockParam {
  const data = file.toString("base64");

  if (mimeType === "application/pdf") {
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data,
      },
    };
  }

  if (mimeType.startsWith("image/")) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType as ImageMediaType,
        data,
      },
    };
  }

  throw new Error(`Unsupported certificate mimeType: ${mimeType}`);
}

export async function certificateUpload(
  file: Buffer,
  mimeType: string,
  runId: string
): Promise<Evidence> {
  const client = new Anthropic();

  const contentBlock = buildContentBlock(file, mimeType);

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [contentBlock, { type: "text", text: PROMPT }],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = (textBlock && "text" in textBlock ? textBlock.text : "").trim();

  if (text === "REFUSED" || text.startsWith("REFUSED")) {
    throw new RefusalError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Failed to parse Claude response as JSON: ${(err as Error).message}`
    );
  }

  const fields: CertificateFields = CertificateFieldsSchema.parse(parsed);

  const rawArtifactHash = toHex(sha256(new Uint8Array(file)));

  const evidence: Evidence = {
    id: randomUUID(),
    run_id: runId,
    source: "certificate",
    retrieved_at: new Date().toISOString(),
    raw_artifact_hash: rawArtifactHash,
    matched_data_points: [
      fields.organizer_name,
      fields.event_name,
      fields.candidate_name,
      fields.year,
    ],
    signal_type: "certificate",
    organizer_profile: null,
    reputability_score: null,
    confidence_tier: "high",
    notes: fields.organizer_name,
  };

  return evidence;
}
