import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export type MediaKind = "pdf" | "image";
export type OcrMode = "off" | "auto" | "required";

export type MediaIngestInput = {
  sourcePath: string;
  ocrMode?: OcrMode;
  maxPages?: number;
  maxBytes?: number;
};

export type EvidenceCandidate = {
  sourcePath: string;
  sourceHash: string;
  summary: string;
  metadata: Record<string, unknown>;
};

export type MediaIngestResult = {
  kind: MediaKind;
  sourcePath: string;
  mediaHash: string;
  extractedText: string;
  extractionWarnings: string[];
  evidenceCandidate: EvidenceCandidate;
};

type Sidecar = {
  run(input: { job: string; payload: unknown }): Promise<{
    ok?: boolean;
    result?: unknown;
    error?: string;
  }>;
};

type PdfPage = {
  pageNumber?: number;
  text?: string;
  textHash?: string;
};

type PdfSidecarResult = {
  kind?: string;
  pageCount?: number;
  pages?: PdfPage[];
  warnings?: string[];
  title?: string;
};

type ImageSidecarResult = {
  kind?: string;
  available?: boolean;
  width?: number;
  height?: number;
  format?: string;
  mode?: string;
  text?: string;
  ocrAvailable?: boolean;
  warnings?: string[];
};

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function resolveInsideRoot(repoRoot: string, sourcePath: string): string {
  const absoluteRoot = path.resolve(repoRoot);
  const absolutePath = path.isAbsolute(sourcePath)
    ? path.resolve(sourcePath)
    : path.resolve(absoluteRoot, sourcePath);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Media source path is outside repo root");
  }
  return absolutePath;
}

function readMediaFile(repoRoot: string, input: MediaIngestInput): { sourcePath: string; bytes: Buffer; mediaHash: string } {
  const sourcePath = resolveInsideRoot(repoRoot, input.sourcePath);
  const rootRealPath = realpathSync(path.resolve(repoRoot));
  if (lstatSync(sourcePath).isSymbolicLink()) {
    throw new Error("Media source path must not be a symbolic link");
  }
  const sourceRealPath = realpathSync(sourcePath);
  const realRelative = path.relative(rootRealPath, sourceRealPath);
  if (realRelative === "" || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("Media source real path is outside repo root");
  }
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const fd = openSync(sourceRealPath, "r");
  let bytes: Buffer;
  const stats = fstatSync(fd);
  if (stats.size > maxBytes) {
    closeSync(fd);
    throw new Error(`Media source exceeds max bytes: ${stats.size} > ${maxBytes}`);
  }
  try {
    bytes = readFileSync(fd);
  } finally {
    closeSync(fd);
  }
  return { sourcePath, bytes, mediaHash: sha256(bytes) };
}

function normalizePdfResult(value: unknown): PdfSidecarResult {
  if (!isRecord(value)) {
    return { pages: [], warnings: ["PDF sidecar returned a non-object result"] };
  }
  return {
    kind: typeof value.kind === "string" ? value.kind : undefined,
    pageCount: typeof value.pageCount === "number" ? value.pageCount : undefined,
    pages: Array.isArray(value.pages)
      ? value.pages
          .filter(isRecord)
          .map((page) => ({
            pageNumber: typeof page.pageNumber === "number" ? page.pageNumber : undefined,
            text: typeof page.text === "string" ? page.text : "",
            textHash: typeof page.textHash === "string" ? page.textHash : undefined,
          }))
      : [],
    warnings: stringArray(value.warnings),
    title: typeof value.title === "string" ? value.title : undefined,
  };
}

function normalizeImageResult(value: unknown): ImageSidecarResult {
  if (!isRecord(value)) {
    return { warnings: ["Image sidecar returned a non-object result"] };
  }
  return {
    kind: typeof value.kind === "string" ? value.kind : undefined,
    available: typeof value.available === "boolean" ? value.available : undefined,
    width: typeof value.width === "number" ? value.width : undefined,
    height: typeof value.height === "number" ? value.height : undefined,
    format: typeof value.format === "string" ? value.format : undefined,
    mode: typeof value.mode === "string" ? value.mode : undefined,
    text: typeof value.text === "string" ? value.text : "",
    ocrAvailable: typeof value.ocrAvailable === "boolean" ? value.ocrAvailable : undefined,
    warnings: stringArray(value.warnings),
  };
}

function summarizeTextLength(text: string, pageCount: number): number {
  return text.length + Math.max(0, pageCount - 1);
}

export function createMediaIngestion(config: {
  repoRoot: string;
  sidecar: Sidecar;
}): {
  ingestPdf(input: MediaIngestInput): Promise<MediaIngestResult>;
  ingestImage(input: MediaIngestInput): Promise<MediaIngestResult>;
} {
  return {
    async ingestPdf(input: MediaIngestInput): Promise<MediaIngestResult> {
      const media = readMediaFile(config.repoRoot, input);
      const sidecarResult = await config.sidecar.run({
        job: "pdf_extract",
        payload: {
          path: media.sourcePath,
          mediaHash: media.mediaHash,
          maxPages: input.maxPages,
        },
      });

      if (sidecarResult.ok === false) {
        const warning = sidecarResult.error ?? "PDF extraction failed";
        return {
          kind: "pdf",
          sourcePath: media.sourcePath,
          mediaHash: media.mediaHash,
          extractedText: "",
          extractionWarnings: [warning],
          evidenceCandidate: {
            sourcePath: media.sourcePath,
            sourceHash: media.mediaHash,
            summary: `PDF extraction from ${path.basename(media.sourcePath)}: extraction unavailable`,
            metadata: { kind: "pdf" },
          },
        };
      }

      const result = normalizePdfResult(sidecarResult.result);
      const pages = result.pages ?? [];
      const extractedText = pages.map((page) => page.text ?? "").filter(Boolean).join("\n\n");
      const pageCount = result.pageCount ?? pages.length;

      return {
        kind: "pdf",
        sourcePath: media.sourcePath,
        mediaHash: media.mediaHash,
        extractedText,
        extractionWarnings: result.warnings ?? [],
        evidenceCandidate: {
          sourcePath: media.sourcePath,
          sourceHash: media.mediaHash,
          summary: `PDF extraction from ${path.basename(media.sourcePath)}: ${pageCount} pages, ${summarizeTextLength(extractedText, pageCount)} characters`,
          metadata: {
            kind: "pdf",
            pageCount,
            ...(result.title ? { title: result.title } : {}),
          },
        },
      };
    },

    async ingestImage(input: MediaIngestInput): Promise<MediaIngestResult> {
      const media = readMediaFile(config.repoRoot, input);
      const ocrMode = input.ocrMode ?? "off";
      const sidecarResult = await config.sidecar.run({
        job: "image_inspect",
        payload: {
          path: media.sourcePath,
          mediaHash: media.mediaHash,
          ocrMode,
        },
      });

      if (sidecarResult.ok === false) {
        if (ocrMode === "required") {
          throw new Error(sidecarResult.error ?? "Required OCR unavailable");
        }
        const warning = sidecarResult.error ?? "Image inspection failed";
        return {
          kind: "image",
          sourcePath: media.sourcePath,
          mediaHash: media.mediaHash,
          extractedText: "",
          extractionWarnings: [warning],
          evidenceCandidate: {
            sourcePath: media.sourcePath,
            sourceHash: media.mediaHash,
            summary: `Image inspection from ${path.basename(media.sourcePath)}: extraction unavailable`,
            metadata: { kind: "image" },
          },
        };
      }

      const result = normalizeImageResult(sidecarResult.result);
      const warnings = result.warnings ?? [];
      if (ocrMode === "required" && result.ocrAvailable === false) {
        throw new Error(warnings.find((warning) => /ocr/i.test(warning)) ?? "OCR unavailable");
      }
      const dimensions = result.width && result.height ? `${result.width}x${result.height}` : "unknown dimensions";

      return {
        kind: "image",
        sourcePath: media.sourcePath,
        mediaHash: media.mediaHash,
        extractedText: result.text ?? "",
        extractionWarnings: warnings,
        evidenceCandidate: {
          sourcePath: media.sourcePath,
          sourceHash: media.mediaHash,
          summary: `Image inspection from ${path.basename(media.sourcePath)}: ${dimensions}`,
          metadata: {
            kind: "image",
            ...(result.width ? { width: result.width } : {}),
            ...(result.height ? { height: result.height } : {}),
            ...(result.format ? { format: result.format } : {}),
            ...(result.mode ? { mode: result.mode } : {}),
            ocrMode,
          },
        },
      };
    },
  };
}
