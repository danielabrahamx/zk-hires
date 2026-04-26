import Anthropic from "@anthropic-ai/sdk";

import { EvidenceSchema, type Evidence } from "@/types/evidence";
import { emitEvent } from "@/trace/store";
import { MODEL_RESEARCHER } from "@/config/runtime";
import { companiesHouseLookup } from "@/agents/researcher/sources/companies-house";
import { webLookup } from "@/agents/researcher/sources/web-lookup";
import { certificateUpload } from "@/agents/researcher/sources/certificate";
import { lookupOrganizerProfile } from "@/agents/researcher/sources/organizer-profile";
import { winAnnouncementLookup } from "@/agents/researcher/sources/win-announcement";
import type { TraceEventAgent } from "@/trace/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CandidateInputs {
  file?: Buffer;
  mimeType?: string;
  postLinks?: string[];
}

export interface EmployerInputs {
  companyNumber?: string;
  supplementaryUrl?: string;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "companies_house_lookup",
    description:
      "Query Companies House by UK company registration number. Returns structured evidence with company status, name, date of creation, and confidence tier.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_number: {
          type: "string",
          description: "UK company registration number (up to 8 digits)",
        },
      },
      required: ["company_number"],
    },
  },
  {
    name: "web_fetch_url",
    description:
      "Fetch and analyse any HTTPS URL for company legitimacy signals (funding bracket, employee count, press coverage, founding year). Returns structured evidence.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "HTTPS URL to fetch and analyse" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_certificate",
    description:
      "OCR the attached hackathon certificate using vision. Extracts organizer_name, event_name, candidate_name, year. Returns structured evidence. Call this when a certificate image or PDF is present.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "lookup_organizer_profile",
    description:
      "Cross-reference a hackathon organizer on LinkedIn/X to verify reputability (follower count, account age, third-party coverage). Enriches the existing certificate evidence.",
    input_schema: {
      type: "object" as const,
      properties: {
        organizer_name: {
          type: "string",
          description: "Name of the hackathon organizer or organization",
        },
      },
      required: ["organizer_name"],
    },
  },
  {
    name: "find_win_announcement",
    description:
      "Verify a hackathon win from a post URL (LinkedIn, X, DevPost, news article, etc.). Returns structured evidence with confidence tier.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "HTTPS URL of the win announcement post or article",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "done",
    description:
      "Signal that you have gathered all available evidence. Call this after researching every provided input.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 8;
const THROTTLE_MS = 250;

function agentIdForTool(toolName: string): TraceEventAgent {
  switch (toolName) {
    case "companies_house_lookup":
      return "researcher.companies_house";
    case "web_fetch_url":
      return "researcher.web_lookup";
    case "read_certificate":
      return "researcher.certificate";
    case "lookup_organizer_profile":
      return "researcher.organizer_profile";
    case "find_win_announcement":
      return "researcher.win_announcement";
    default:
      return "researcher.planner";
  }
}

function buildSystemPrompt(flow: "candidate" | "employer"): string {
  if (flow === "candidate") {
    return `You are a due diligence researcher for a ZK credential system. Your task is to gather evidence about a hackathon winner.

Research strategy:
1. If a certificate is attached, call read_certificate to extract structured fields.
2. After extracting certificate fields, call lookup_organizer_profile with the organizer name to verify reputability.
3. For each post link provided, call find_win_announcement to verify the win.
4. When all inputs have been researched, call done.

Be methodical. Research every provided input. Do not call done until all inputs are processed.`;
  }
  return `You are a due diligence researcher for a ZK credential system. Your task is to gather evidence about an employer.

Research strategy:
1. If a company number is provided, call companies_house_lookup to verify company status.
2. If a supplementary URL is provided, call web_fetch_url to extract funding and legitimacy signals.
3. Call companies_house_lookup and web_fetch_url in the same turn if both are available (they run in parallel).
4. When all inputs have been researched, call done.

Be methodical. Research every provided input. Do not call done until all inputs are processed.`;
}

function buildInitialMessages(
  flow: "candidate" | "employer",
  candidateInputs?: CandidateInputs,
  employerInputs?: EmployerInputs
): Anthropic.MessageParam[] {
  const textParts: string[] = ["Please research the following and gather evidence:"];

  if (flow === "employer") {
    if (employerInputs?.companyNumber) {
      textParts.push(`- Company number: ${employerInputs.companyNumber}`);
    }
    if (employerInputs?.supplementaryUrl) {
      textParts.push(`- Supplementary URL: ${employerInputs.supplementaryUrl}`);
    }
    textParts.push("\nCall done when you have finished researching all provided inputs.");
    return [{ role: "user", content: textParts.join("\n") }];
  }

  // candidate flow — may include multimodal certificate content
  const content: Anthropic.ContentBlockParam[] = [];

  if (candidateInputs?.file && candidateInputs.mimeType) {
    const data = candidateInputs.file.toString("base64");
    if (candidateInputs.mimeType === "application/pdf") {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      } as Anthropic.ContentBlockParam);
    } else if (candidateInputs.mimeType.startsWith("image/")) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: candidateInputs.mimeType as
            | "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp",
          data,
        },
      } as Anthropic.ContentBlockParam);
    }
    textParts.push("- Certificate: [see attached image/document above]");
  }

  if (candidateInputs?.postLinks?.length) {
    for (const link of candidateInputs.postLinks) {
      textParts.push(`- Post link: ${link}`);
    }
  }

  textParts.push("\nCall done when you have finished researching all provided inputs.");
  content.push({ type: "text", text: textParts.join("\n") });

  return [{ role: "user", content }];
}

// ─── Tool execution ───────────────────────────────────────────────────────────

interface ToolExecResult {
  content: string;
  evidence?: Evidence;
}

async function executeTool(
  block: Anthropic.ToolUseBlock,
  candidateInputs: CandidateInputs | undefined,
  employerInputs: EmployerInputs | undefined,
  runId: string,
  evidence: Evidence[]
): Promise<ToolExecResult> {
  const input = block.input as Record<string, string>;

  switch (block.name) {
    case "companies_house_lookup": {
      const ev = await companiesHouseLookup(input.company_number, runId);
      return {
        evidence: ev,
        content: JSON.stringify({
          status: "success",
          evidence_id: ev.id,
          confidence_tier: ev.confidence_tier,
          matched_data_points: ev.matched_data_points,
        }),
      };
    }

    case "web_fetch_url": {
      const ev = await webLookup(input.url, runId);
      return {
        evidence: ev,
        content: JSON.stringify({
          status: "success",
          evidence_id: ev.id,
          confidence_tier: ev.confidence_tier,
          matched_data_points: ev.matched_data_points,
        }),
      };
    }

    case "read_certificate": {
      if (!candidateInputs?.file) {
        throw new Error("read_certificate called but no certificate file is available");
      }
      const ev = await certificateUpload(
        candidateInputs.file,
        candidateInputs.mimeType ?? "image/jpeg",
        runId
      );
      return {
        evidence: ev,
        content: JSON.stringify({
          status: "success",
          evidence_id: ev.id,
          organizer_name: ev.notes,
          confidence_tier: ev.confidence_tier,
          matched_data_points: ev.matched_data_points,
        }),
      };
    }

    case "lookup_organizer_profile": {
      const profile = await lookupOrganizerProfile(input.organizer_name, runId);
      // Enrich the most recent certificate Evidence with the profile.
      let certIdx = -1;
      for (let i = evidence.length - 1; i >= 0; i--) {
        if (evidence[i].source === "certificate") {
          certIdx = i;
          break;
        }
      }
      if (certIdx >= 0) {
        evidence[certIdx] = EvidenceSchema.parse({
          ...evidence[certIdx],
          organizer_profile: profile,
        });
      }
      // Return the enriched certificate Evidence so the SSE route can
      // re-emit it — the frontend upserts by ID, updating the existing card.
      return {
        evidence: certIdx >= 0 ? evidence[certIdx] : undefined,
        content: JSON.stringify({
          status: "success",
          handle: profile.handle,
          platform: profile.platform,
          follower_count: profile.follower_count,
          cross_platform_handles: profile.cross_platform_handles,
          third_party_coverage_count: profile.third_party_coverage_urls.length,
        }),
      };
    }

    case "find_win_announcement": {
      const ev = await winAnnouncementLookup(input.url, runId);
      return {
        evidence: ev,
        content: JSON.stringify({
          status: "success",
          evidence_id: ev.id,
          confidence_tier: ev.confidence_tier,
          matched_data_points: ev.matched_data_points,
        }),
      };
    }

    case "done":
      return { content: JSON.stringify({ status: "done" }) };

    default:
      throw new Error(`Unknown tool: ${block.name}`);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

export async function runResearcherWithToolUse({
  candidateInputs,
  employerInputs,
  flow,
  runId,
  _anthropicClient,
}: {
  candidateInputs?: CandidateInputs;
  employerInputs?: EmployerInputs;
  flow: "candidate" | "employer";
  runId: string;
  /** Test injection point — omit in production; the function creates its own client. */
  _anthropicClient?: Anthropic;
}): Promise<{ evidence: Evidence[] }> {
  emitEvent({
    run_id: runId,
    agent: "researcher.planner",
    kind: "plan",
    message: "Researcher tool-use loop starting",
    data: {
      flow,
      has_file: !!candidateInputs?.file,
      has_company_number: !!employerInputs?.companyNumber,
      has_supplementary_url: !!employerInputs?.supplementaryUrl,
      post_link_count: candidateInputs?.postLinks?.length ?? 0,
    },
  });

  const client = _anthropicClient ?? new Anthropic();
  const evidence: Evidence[] = [];
  const messages: Anthropic.MessageParam[] = buildInitialMessages(
    flow,
    candidateInputs,
    employerInputs
  );
  const systemPrompt = buildSystemPrompt(flow);
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    const stream = client.messages.stream({
      model: MODEL_RESEARCHER,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      tool_choice: { type: "auto" },
      messages,
    });

    // Stream planner reasoning text to dashboard (~250ms throttle, same as web-lookup.ts)
    let buffered = "";
    let lastEmit = 0;
    stream.on("text", (delta) => {
      buffered += delta;
      const now = Date.now();
      if (now - lastEmit >= THROTTLE_MS) {
        lastEmit = now;
        emitEvent({
          run_id: runId,
          agent: "researcher.planner",
          kind: "tool_result",
          message: "Planner reasoning",
          data: {
            streaming: true,
            partial_text: buffered.slice(-400),
            chars_so_far: buffered.length,
          },
        });
      }
    });

    const response = await stream.finalMessage();
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") break;

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) break;

    const hasDone = toolUseBlocks.some((b) => b.name === "done");

    // Emit tool_call events for all non-done tools before concurrent execution
    for (const block of toolUseBlocks) {
      if (block.name !== "done") {
        emitEvent({
          run_id: runId,
          agent: agentIdForTool(block.name),
          kind: "tool_call",
          message: `Calling ${block.name}`,
          data: { tool: block.name, input: block.input },
        });
      }
    }

    // Execute all tools (including done as a no-op) concurrently
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block): Promise<Anthropic.ToolResultBlockParam> => {
        if (block.name === "done") {
          return {
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ status: "done" }),
          };
        }
        try {
          const result = await executeTool(
            block,
            candidateInputs,
            employerInputs,
            runId,
            evidence
          );
          if (result.evidence) {
            evidence.push(result.evidence);
          }
          emitEvent({
            run_id: runId,
            agent: agentIdForTool(block.name),
            kind: "tool_result",
            message: `${block.name} completed`,
            data: {
              tool: block.name,
              // Include full Evidence object so SSE route can emit "evidence" events live
              evidence: result.evidence ?? null,
              evidence_id: result.evidence?.id,
              confidence_tier: result.evidence?.confidence_tier,
            },
            evidence_ids: result.evidence ? [result.evidence.id] : [],
          });
          return {
            type: "tool_result",
            tool_use_id: block.id,
            content: result.content,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emitEvent({
            run_id: runId,
            agent: agentIdForTool(block.name),
            kind: "error",
            message: `${block.name} failed: ${message}`,
            data: { tool: block.name },
            error: message,
          });
          return {
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${message}`,
            is_error: true,
          };
        }
      })
    );

    messages.push({ role: "user", content: toolResults });

    if (hasDone) break;
    iterations++;
  }

  emitEvent({
    run_id: runId,
    agent: "researcher.planner",
    kind: "decision",
    message: `Research complete: ${evidence.length} evidence record(s) collected`,
    data: {
      evidence_count: evidence.length,
      iterations,
      evidence_ids: evidence.map((e) => e.id),
    },
    evidence_ids: evidence.map((e) => e.id),
  });

  return { evidence };
}
