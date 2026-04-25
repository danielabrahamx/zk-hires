import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  const Anthropic = vi.fn(function (this: unknown) {
    (this as { messages: { create: typeof createMock } }).messages = {
      create: createMock,
    };
  });
  return { default: Anthropic };
});

import {
  RefusalError,
  certificateUpload,
} from "@/agents/researcher/sources/certificate";

const RUN_ID = "22222222-2222-4222-8222-222222222222";

const FIXTURE_DIR = resolve(__dirname, "../../../../../e2e/fixtures");
const PDF_PATH = resolve(FIXTURE_DIR, "sample-certificate.pdf");
const PNG_PATH = resolve(FIXTURE_DIR, "not-a-certificate.png");

const MINIMAL_PDF =
  "%PDF-1.4\n" +
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\n" +
  "xref\n" +
  "0 4\n" +
  "0000000000 65535 f\n" +
  "0000000009 00000 n\n" +
  "0000000058 00000 n\n" +
  "0000000115 00000 n\n" +
  "trailer<</Size 4/Root 1 0 R>>\n" +
  "startxref\n" +
  "190\n" +
  "%%EOF\n";

const PNG_1X1_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==",
  "base64"
);

function ensureFixture(path: string, content: Buffer | string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(path)) {
    writeFileSync(path, content);
  }
}

describe("certificateUpload", () => {
  beforeAll(() => {
    ensureFixture(PDF_PATH, MINIMAL_PDF);
    ensureFixture(PNG_PATH, PNG_1X1_RED);
  });

  beforeEach(() => {
    createMock.mockReset();
  });

  it("returns Evidence for a valid certificate PDF", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"organizer_name":"Encode Club","event_name":"Encode Hack 2024","candidate_name":"Alice","year":"2024"}',
        },
      ],
    });

    const pdfBuffer = readFileSync(PDF_PATH);
    const evidence = await certificateUpload(
      pdfBuffer,
      "application/pdf",
      RUN_ID
    );

    expect(evidence.signal_type).toBe("certificate");
    expect(evidence.source).toBe("certificate");
    expect(evidence.matched_data_points).toContain("Encode Club");
    expect(evidence.matched_data_points).toContain("Encode Hack 2024");
    expect(evidence.matched_data_points).toContain("Alice");
    expect(evidence.matched_data_points).toContain("2024");
    expect(evidence.confidence_tier).toBe("high");
    expect(evidence.organizer_profile).toBeNull();
    expect(evidence.reputability_score).toBeNull();
    expect(evidence.notes).toBe("Encode Club");
    expect(evidence.run_id).toBe(RUN_ID);
    expect(createMock).toHaveBeenCalledTimes(1);

    const callArg = createMock.mock.calls[0][0] as {
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    const docBlock = callArg.messages[0].content.find(
      (c) => c.type === "document"
    );
    expect(docBlock).toBeDefined();
  });

  it("returns Evidence for a valid certificate image (PNG)", async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"organizer_name":"ETHGlobal","event_name":"ETHGlobal London","candidate_name":"Bob","year":"2025"}',
        },
      ],
    });

    const pngBuffer = readFileSync(PNG_PATH);
    const evidence = await certificateUpload(pngBuffer, "image/png", RUN_ID);

    expect(evidence.signal_type).toBe("certificate");
    expect(evidence.source).toBe("certificate");
    expect(evidence.matched_data_points).toContain("ETHGlobal");
    expect(evidence.matched_data_points).toContain("ETHGlobal London");
    expect(evidence.matched_data_points).toContain("Bob");
    expect(evidence.matched_data_points).toContain("2025");
    expect(evidence.confidence_tier).toBe("high");
    expect(evidence.notes).toBe("ETHGlobal");

    const callArg = createMock.mock.calls[0][0] as {
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    const imgBlock = callArg.messages[0].content.find(
      (c) => c.type === "image"
    );
    expect(imgBlock).toBeDefined();
  });

  it("throws RefusalError when Claude refuses (not a certificate)", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "REFUSED" }],
    });

    const pngBuffer = readFileSync(PNG_PATH);

    await expect(
      certificateUpload(pngBuffer, "image/png", RUN_ID)
    ).rejects.toMatchObject({ isRefusal: true });

    await expect(
      certificateUpload(pngBuffer, "image/png", RUN_ID)
    ).rejects.toBeInstanceOf(RefusalError);
  });

  it("throws on malformed JSON response", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "not valid json" }],
    });

    const pdfBuffer = readFileSync(PDF_PATH);

    await expect(
      certificateUpload(pdfBuffer, "application/pdf", RUN_ID)
    ).rejects.toThrow();
  });
});
