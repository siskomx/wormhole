import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type CachedEvidenceInput = {
  mediaType: string;
  source: string;
};

export type CachedEvidenceRecord = CachedEvidenceInput & {
  cacheKey: string;
  hash: string;
  byteLength: number;
  storedAt: string;
  content: string;
};

export type EvidenceCache = {
  put(content: string, input: CachedEvidenceInput): CachedEvidenceRecord;
  get(cacheKey: string): CachedEvidenceRecord;
  has(cacheKey: string): boolean;
  pathFor(cacheKey: string): string;
};

function cacheKeyFor(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function fileNameFor(cacheKey: string): string {
  return `${cacheKey.replace(":", "-")}.json`;
}

export function createEvidenceCache(root: string): EvidenceCache {
  const absoluteRoot = path.resolve(root);
  mkdirSync(absoluteRoot, { recursive: true });

  function pathFor(cacheKey: string): string {
    return path.join(absoluteRoot, fileNameFor(cacheKey));
  }

  return {
    put(content: string, input: CachedEvidenceInput): CachedEvidenceRecord {
      const cacheKey = cacheKeyFor(content);
      const record: CachedEvidenceRecord = {
        ...input,
        cacheKey,
        hash: cacheKey.slice("sha256:".length),
        byteLength: Buffer.byteLength(content, "utf8"),
        storedAt: new Date().toISOString(),
        content,
      };
      const existingPath = pathFor(cacheKey);
      if (existsSync(existingPath)) {
        return JSON.parse(readFileSync(existingPath, "utf8")) as CachedEvidenceRecord;
      }
      writeFileSync(existingPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      return record;
    },

    get(cacheKey: string): CachedEvidenceRecord {
      const recordPath = pathFor(cacheKey);
      if (!existsSync(recordPath)) {
        throw new Error(`Cached evidence not found: ${cacheKey}`);
      }
      return JSON.parse(readFileSync(recordPath, "utf8")) as CachedEvidenceRecord;
    },

    has(cacheKey: string): boolean {
      return existsSync(pathFor(cacheKey));
    },

    pathFor,
  };
}
