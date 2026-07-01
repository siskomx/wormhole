import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRepoIndex, type RepoIndex } from "../src/repo-index.js";
import {
  createRepoFactGraphFromIndex,
  repoFactEdgeKindSchema,
  stableFactHash,
  type RepoFactGraph,
  validateRepoFactGraph,
} from "../src/repo-facts.js";

describe("repo fact graph", () => {
  it("converts repo index files, symbols, and edges into canonical facts", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-facts-"));
    writeFileSync(path.join(repoRoot, "user.ts"), "export function loadUser() { return true; }\n");
    writeFileSync(
      path.join(repoRoot, "user.test.ts"),
      "import { loadUser } from './user'; test('loadUser', () => loadUser());\n",
    );

    try {
      const index = buildRepoIndex({ repoRoot });
      const graph = createRepoFactGraphFromIndex({ index });

      expect(graph.version).toBe(1);
      expect(graph.fingerprint).toBe(index.fingerprint);
      expect(graph.extractorVersion).toBe("ast-v1");
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({ id: "file:user.ts", kind: "file", path: "user.ts" }),
      );
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({ id: "file:user.test.ts", kind: "test", path: "user.test.ts" }),
      );
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({ id: "symbol:user.ts#loadUser:1", kind: "symbol", label: "loadUser" }),
      );
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: "file:user.ts",
          to: "symbol:user.ts#loadUser:1",
          kind: "defines",
          provenance: "extracted",
        }),
      );
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: "file:user.test.ts",
          to: "symbol:user.ts#loadUser:1",
          kind: "tests",
          provenance: "derived",
        }),
      );
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: "symbol:user.ts#loadUser:1",
          to: "file:user.test.ts",
          kind: "tested_by",
          provenance: "derived",
        }),
      );
      expect(validateRepoFactGraph(graph)).toEqual({ valid: true, errors: [] });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("preserves ambiguous provenance and external endpoint normalization", () => {
    const index: RepoIndex = {
      repoRoot: "/tmp/repo",
      builtAt: "2026-06-30T00:00:00.000Z",
      buildOptions: {
        preset: "default",
        maxFiles: 100,
        maxFileBytes: 100,
        maxTotalBytes: 100,
      },
      fingerprint: "fingerprint",
      files: [
        {
          path: "src/a.ts",
          language: "typescript",
          lineCount: 1,
          byteLength: 20,
          mtimeMs: 1,
          hash: "hash",
          symbols: [],
          content: "import 'left-pad';\n",
        },
      ],
      symbols: [],
      edges: [
        {
          from: "src/a.ts",
          to: "external:left-pad",
          kind: "imports",
          provenance: "ambiguous",
          confidence: 0.4,
          line: 1,
          label: "left-pad",
        },
      ],
      truncated: false,
      skippedFiles: [],
    };

    const graph = createRepoFactGraphFromIndex({ index });

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ id: "external:left-pad", kind: "external", label: "left-pad" }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: "file:src/a.ts",
        to: "external:left-pad",
        kind: "imports",
        provenance: "ambiguous",
        confidence: 0.4,
      }),
    );
    expect(repoFactEdgeKindSchema.parse("tested_by")).toBe("tested_by");
  });

  it("creates deterministic stable hashes", () => {
    expect(stableFactHash(["file:a.ts", "symbol:a.ts#load:1"])).toBe(
      stableFactHash(["file:a.ts", "symbol:a.ts#load:1"]),
    );
    expect(stableFactHash(["file:a.ts", "symbol:a.ts#load:1"])).not.toBe(
      stableFactHash(["symbol:a.ts#load:1", "file:a.ts"]),
    );
  });

  it("rejects dangling fact edges", () => {
    const graph: RepoFactGraph = {
      version: 1,
      repoRoot: "/tmp/repo",
      builtAt: "2026-06-30T00:00:00.000Z",
      fingerprint: "fingerprint",
      extractorVersion: "test",
      nodes: [],
      edges: [
        {
          id: "edge:missing",
          from: "missing:a",
          to: "missing:b",
          kind: "imports",
          provenance: "extracted",
          confidence: 1,
          metadata: {
            analyzer: "test",
            source: "test",
            builtAt: "2026-06-30T00:00:00.000Z",
            fingerprint: "fingerprint",
            confidence: 1,
            freshness: "fresh",
          },
        },
      ],
      warnings: [],
    };

    expect(validateRepoFactGraph(graph).valid).toBe(false);
    expect(validateRepoFactGraph(graph).errors.join("\n")).toContain("missing edge endpoint");
  });
});
