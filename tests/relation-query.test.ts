import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { refreshDurableRepoIndex } from "../src/durable-index-store.js";
import { queryRepoRelations } from "../src/relation-query.js";

describe("repo relation query", () => {
  it("queries outbound and inbound relations from the SQLite-backed fact store", () => {
    const repoRoot = createRelationFixture();

    try {
      refreshDurableRepoIndex({ repoRoot });

      const outbound = queryRepoRelations({
        repoRoot,
        from: "src/b.ts",
        kinds: ["imports"],
        direction: "outbound",
        limit: 5,
      });
      const inbound = queryRepoRelations({
        repoRoot,
        to: "src/a.ts",
        kinds: ["imports"],
        direction: "inbound",
        limit: 5,
      });

      expect(outbound.refused).toBeUndefined();
      expect(outbound.edges).toContainEqual(
        expect.objectContaining({
          from: "file:src/b.ts",
          to: "file:src/a.ts",
          kind: "imports",
          provenance: "extracted",
        }),
      );
      expect(inbound.edges).toContainEqual(
        expect.objectContaining({
          from: "file:src/b.ts",
          to: "file:src/a.ts",
          kind: "imports",
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("finds bounded relation paths between files", () => {
    const repoRoot = createRelationFixture();

    try {
      refreshDurableRepoIndex({ repoRoot });
      const result = queryRepoRelations({
        repoRoot,
        from: "src/c.ts",
        to: "src/a.ts",
        kinds: ["imports"],
        maxDepth: 2,
      });

      expect(result.paths[0]?.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual([
        "file:src/c.ts->file:src/b.ts",
        "file:src/b.ts->file:src/a.ts",
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("paginates direct relation evidence", () => {
    const repoRoot = createRelationFixture();

    try {
      refreshDurableRepoIndex({ repoRoot });
      const first = queryRepoRelations({ repoRoot, kinds: ["defines"], limit: 1 });
      const second = queryRepoRelations({ repoRoot, kinds: ["defines"], limit: 1, cursor: first.nextCursor });

      expect(first.edges).toHaveLength(1);
      expect(first.truncated).toBe(true);
      expect(first.nextCursor).toBeDefined();
      expect(second.edges).toHaveLength(1);
      expect(second.edges[0]?.id).not.toBe(first.edges[0]?.id);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses stale fact state when freshness is required", () => {
    const repoRoot = createRelationFixture();

    try {
      refreshDurableRepoIndex({ repoRoot });
      writeFileSync(path.join(repoRoot, "src", "a.ts"), "export function loadA() { return 'stale'; }\n");

      const result = queryRepoRelations({
        repoRoot,
        from: "src/b.ts",
        requireFresh: true,
      });

      expect(result.refused).toBe(true);
      expect(result.edges).toEqual([]);
      expect(result.warnings.join("\n")).toContain("STALE:");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

function createRelationFixture(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-relation-query-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "src", "a.ts"),
    [
      "export function loadA() {",
      "  return 'a';",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "b.ts"),
    [
      "import { loadA } from './a';",
      "export function loadB() {",
      "  return loadA();",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "c.ts"),
    [
      "import { loadB } from './b';",
      "export function loadC() {",
      "  return loadB();",
      "}",
      "",
    ].join("\n"),
  );
  return repoRoot;
}
