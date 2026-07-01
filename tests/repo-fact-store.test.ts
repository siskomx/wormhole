import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRepoIndex, type RepoIndex } from "../src/repo-index.js";
import { createRepoFactGraphFromIndex, type RepoFactGraph } from "../src/repo-facts.js";
import {
  readRepoFactGraph,
  repoFactSqlitePath,
  repoFactStoreStatus,
  writeRepoFactGraph,
} from "../src/repo-fact-store.js";
import { writeSqliteRepoIndex } from "../src/sqlite-repo-index.js";

describe("repo fact store", () => {
  it("writes facts to the durable SQLite index and reads deterministic pages", () => {
    const { repoRoot, index, graph, cleanup } = createIndexedFactGraph();

    try {
      const written = writeRepoFactGraph(graph);
      const full = readRepoFactGraph({ repoRoot });
      const firstPage = readRepoFactGraph({ repoRoot, limit: 2 });
      const secondPage = readRepoFactGraph({ repoRoot, limit: 2, cursor: firstPage?.nextCursor });

      expect(written.repoRoot).toBe(repoRoot);
      expect(written.sqlitePath).toBe(path.join(repoRoot, ".wormhole", "indexes", "repo-index.sqlite"));
      expect(repoFactSqlitePath(repoRoot)).toBe(written.sqlitePath);
      expect(existsSync(written.sqlitePath)).toBe(true);
      expect(existsSync(path.join(repoRoot, ".wormhole", "indexes", "repo-facts.json"))).toBe(false);

      expect(full?.graph.fingerprint).toBe(index.fingerprint);
      expect(full?.graph.nodes.map((node) => node.id)).toEqual(
        [...graph.nodes.map((node) => node.id)].sort((left, right) => left.localeCompare(right)),
      );
      expect(full?.graph.edges.map((edge) => edge.id)).toEqual(
        [...graph.edges.map((edge) => edge.id)].sort((left, right) => left.localeCompare(right)),
      );
      expect(full?.nextCursor).toBeUndefined();

      expect(firstPage?.graph.nodes.map((node) => node.id)).toEqual(
        graph.nodes
          .map((node) => node.id)
          .sort((left, right) => left.localeCompare(right))
          .slice(0, 2),
      );
      expect(firstPage?.graph.edges).toEqual([]);
      expect(firstPage?.nextCursor).toBeDefined();
      expect(secondPage?.graph.nodes.map((node) => node.id)).toEqual(
        graph.nodes
          .map((node) => node.id)
          .sort((left, right) => left.localeCompare(right))
          .slice(2, 4),
      );
    } finally {
      cleanup();
    }
  });

  it("reports fresh status only when facts, durable metadata, and current index agree", () => {
    const { repoRoot, index, graph, cleanup } = createIndexedFactGraph();

    try {
      writeRepoFactGraph(graph);

      expect(repoFactStoreStatus({ repoRoot, currentIndex: index, requireFresh: true })).toMatchObject({
        repoRoot,
        sqlitePath: repoFactSqlitePath(repoRoot),
        present: true,
        fresh: true,
        fingerprint: index.fingerprint,
        extractorVersion: "ast-v1",
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        staleReasons: [],
        warnings: graph.warnings,
      });
    } finally {
      cleanup();
    }
  });

  it("reports missing fact tables as absent with zero counts", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-fact-store-missing-"));

    try {
      expect(repoFactStoreStatus({ repoRoot })).toMatchObject({
        repoRoot,
        sqlitePath: repoFactSqlitePath(repoRoot),
        present: false,
        fresh: false,
        nodeCount: 0,
        edgeCount: 0,
        staleReasons: ["fact_store_missing"],
        warnings: [],
      });
      expect(readRepoFactGraph({ repoRoot })).toBeUndefined();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports stale reasons for fact, extractor, build-option, durable, and current-index mismatches", () => {
    const { repoRoot, index, graph, cleanup } = createIndexedFactGraph();

    try {
      writeRepoFactGraph({ ...graph, fingerprint: "stale-fact-fingerprint" });
      expect(repoFactStoreStatus({ repoRoot, currentIndex: index }).staleReasons).toEqual(
        expect.arrayContaining(["fact_fingerprint_mismatch", "durable_index_fingerprint_mismatch"]),
      );

      writeRepoFactGraph({ ...graph, extractorVersion: "old-extractor" });
      expect(repoFactStoreStatus({ repoRoot, currentIndex: index }).staleReasons).toEqual(
        expect.arrayContaining(["fact_extractor_version_mismatch"]),
      );

      writeRepoFactGraph(graph);
      expect(
        repoFactStoreStatus({
          repoRoot,
          currentIndex: {
            ...index,
            buildOptions: { ...index.buildOptions, maxFiles: index.buildOptions.maxFiles + 1 },
          },
        }).staleReasons,
      ).toEqual(expect.arrayContaining(["build_options_mismatch"]));

      expect(repoFactStoreStatus({ repoRoot }).staleReasons).toEqual(
        expect.arrayContaining(["current_index_missing"]),
      );

      writeFileSync(path.join(repoRoot, "src", "app.ts"), "export function runApp() { return false; }\n");
      expect(repoFactStoreStatus({ repoRoot, currentIndex: index, requireFresh: true }).staleReasons).toEqual(
        expect.arrayContaining(["durable_index_stale", "current_index_stale"]),
      );
    } finally {
      cleanup();
    }
  });
});

function createIndexedFactGraph(): {
  repoRoot: string;
  index: RepoIndex;
  graph: RepoFactGraph;
  cleanup: () => void;
} {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-fact-store-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
  writeFileSync(path.join(repoRoot, "src", "app.ts"), "export function runApp() { return true; }\n");
  writeFileSync(
    path.join(repoRoot, "tests", "app.test.ts"),
    "import { runApp } from '../src/app'; test('runApp', () => runApp());\n",
  );
  const index = buildRepoIndex({ repoRoot });
  writeSqliteRepoIndex(index);
  const graph = createRepoFactGraphFromIndex({ index });
  return {
    repoRoot,
    index,
    graph,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}
