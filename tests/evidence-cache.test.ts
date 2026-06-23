import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEvidenceCache } from "../src/evidence-cache.js";

describe("content-addressed evidence cache", () => {
  it("stores and retrieves content by stable sha256 address", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-cache-"));
    const cache = createEvidenceCache(root);

    const first = cache.put("same evidence", {
      mediaType: "text/plain",
      source: "command:npm test",
    });
    const second = cache.put("same evidence", {
      mediaType: "text/plain",
      source: "command:npm test",
    });

    expect(first.cacheKey).toBe(second.cacheKey);
    expect(first.cacheKey).toMatch(/^sha256:/);
    expect(cache.has(first.cacheKey)).toBe(true);
    expect(cache.get(first.cacheKey)).toEqual(
      expect.objectContaining({
        cacheKey: first.cacheKey,
        content: "same evidence",
        source: "command:npm test",
      }),
    );
  });
});
