import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMediaIngestion } from "../src/media-ingestion.js";

function createTempRoot(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("media ingestion", () => {
  it("rejects media paths outside the allowed repo root", async () => {
    const root = createTempRoot("wormhole-media-root-");
    const outsideRoot = createTempRoot("wormhole-media-outside-");
    const outsidePdf = path.join(outsideRoot, "escape.pdf");
    writeFileSync(outsidePdf, "%PDF-1.4\n%%EOF\n");
    const ingestion = createMediaIngestion({
      repoRoot: root,
      sidecar: { run: async () => ({ ok: true, result: {} }) },
    });

    try {
      await expect(ingestion.ingestPdf({ sourcePath: outsidePdf })).rejects.toThrow(/outside repo root/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rejects files larger than the configured max bytes before sidecar execution", async () => {
    const root = createTempRoot("wormhole-media-root-");
    const image = path.join(root, "sample.png");
    writeFileSync(image, Buffer.from([0, 1, 2, 3]));
    let sidecarCalls = 0;
    const ingestion = createMediaIngestion({
      repoRoot: root,
      sidecar: {
        run: async () => {
          sidecarCalls += 1;
          return { ok: true, result: {} };
        },
      },
    });

    try {
      await expect(ingestion.ingestImage({ sourcePath: image, maxBytes: 3 })).rejects.toThrow(/exceeds max bytes/i);
      expect(sidecarCalls).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sends PDF extraction payloads and normalizes evidence-ready results", async () => {
    const root = createTempRoot("wormhole-media-root-");
    const pdf = path.join(root, "sample.pdf");
    const rawPdf = "%PDF-1.4\n%%EOF\n";
    writeFileSync(pdf, rawPdf);
    const calls: Array<{ job: string; payload: unknown }> = [];
    const ingestion = createMediaIngestion({
      repoRoot: root,
      sidecar: {
        run: async (input) => {
          calls.push(input);
          return {
            ok: true,
            result: {
              kind: "pdf",
              pageCount: 2,
              pages: [
                { pageNumber: 1, text: "Invoice 42", textHash: "page-a" },
                { pageNumber: 2, text: "Paid in full", textHash: "page-b" },
              ],
              warnings: ["metadata unavailable"],
              title: "Sample",
            },
          };
        },
      },
    });

    try {
      const result = await ingestion.ingestPdf({ sourcePath: pdf, maxPages: 5 });

      expect(calls).toEqual([
        {
          job: "pdf_extract",
          payload: { path: pdf, mediaHash: sha256(rawPdf), maxPages: 5 },
        },
      ]);
      expect(result).toEqual({
        kind: "pdf",
        sourcePath: pdf,
        mediaHash: sha256(rawPdf),
        extractedText: "Invoice 42\n\nPaid in full",
        extractionWarnings: ["metadata unavailable"],
        evidenceCandidate: {
          sourcePath: pdf,
          sourceHash: sha256(rawPdf),
          summary: "PDF extraction from sample.pdf: 2 pages, 25 characters",
          metadata: {
            kind: "pdf",
            pageCount: 2,
            title: "Sample",
          },
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves relative media paths under the repo root", async () => {
    const root = createTempRoot("wormhole-media-root-");
    const pdf = path.join(root, "relative.pdf");
    writeFileSync(pdf, "%PDF-1.4\n%%EOF\n");
    const ingestion = createMediaIngestion({
      repoRoot: root,
      sidecar: {
        run: async (input) => ({
          ok: true,
          result: {
            kind: "pdf",
            pageCount: 1,
            pages: [{ pageNumber: 1, text: "Relative path", textHash: "page-a" }],
            warnings: [],
          },
          job: input.job,
        }),
      },
    });

    try {
      const result = await ingestion.ingestPdf({ sourcePath: "relative.pdf" });

      expect(result.sourcePath).toBe(pdf);
      expect(result.extractedText).toBe("Relative path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects repo-local symlinks before sidecar execution", async () => {
    const root = createTempRoot("wormhole-media-root-");
    const outsideRoot = createTempRoot("wormhole-media-outside-");
    const outsidePdf = path.join(outsideRoot, "outside.pdf");
    const linkPath = path.join(root, "linked.pdf");
    writeFileSync(outsidePdf, "%PDF-1.4\n%%EOF\n");
    try {
      symlinkSync(outsidePdf, linkPath);
    } catch {
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
      return;
    }
    let sidecarCalls = 0;
    const ingestion = createMediaIngestion({
      repoRoot: root,
      sidecar: {
        run: async () => {
          sidecarCalls += 1;
          return { ok: true, result: {} };
        },
      },
    });

    try {
      await expect(ingestion.ingestPdf({ sourcePath: linkPath })).rejects.toThrow(/symbolic link/i);
      expect(sidecarCalls).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });


  it("turns optional image inspection sidecar failures into warnings", async () => {
    const root = createTempRoot("wormhole-media-root-");
    const image = path.join(root, "sample.png");
    writeFileSync(image, Buffer.from([137, 80, 78, 71]));
    const ingestion = createMediaIngestion({
      repoRoot: root,
      sidecar: {
        run: async (input) => ({
          ok: false,
          job: input.job,
          error: "Pillow unavailable",
        }),
      },
    });

    try {
      const result = await ingestion.ingestImage({ sourcePath: image, ocrMode: "auto" });

      expect(result.kind).toBe("image");
      expect(result.sourcePath).toBe(image);
      expect(result.mediaHash).toBe(sha256(Buffer.from([137, 80, 78, 71])));
      expect(result.extractedText).toBe("");
      expect(result.extractionWarnings).toEqual(["Pillow unavailable"]);
      expect(result.evidenceCandidate.summary).toContain("Image inspection from sample.png");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails image ingestion when required OCR is unavailable", async () => {
    const root = createTempRoot("wormhole-media-root-");
    const image = path.join(root, "sample.png");
    writeFileSync(image, Buffer.from([137, 80, 78, 71]));
    const ingestion = createMediaIngestion({
      repoRoot: root,
      sidecar: {
        run: async () => ({
          ok: true,
          result: {
            kind: "image",
            available: true,
            width: 12,
            height: 8,
            warnings: ["OCR unavailable"],
            ocrAvailable: false,
            text: "",
          },
        }),
      },
    });

    try {
      await expect(ingestion.ingestImage({ sourcePath: image, ocrMode: "required" })).rejects.toThrow(
        /OCR unavailable/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
