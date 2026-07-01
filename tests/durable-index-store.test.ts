import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  refreshDurableRepoIndex,
  refreshDurableSemanticIndex,
  durableRepoIndexBuildOptions,
  searchDurableSemanticIndex,
  durableIndexStatus,
  queryDurableShardedRepoIndex,
} from "../src/durable-index-store.js";

describe("durable index store", () => {
  it("persists repo and semantic indexes under .wormhole/indexes", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-durable-index-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "db.ts"), "export function connectDatabase() { return 'pool'; }\n");

    try {
      const repo = refreshDurableRepoIndex({ repoRoot });
      const semantic = refreshDurableSemanticIndex({
        repoRoot,
        records: [{ id: "db", path: "src/db.ts", text: "database connection pool" }],
      });
      const status = durableIndexStatus({ repoRoot });
      const search = searchDurableSemanticIndex({ repoRoot, query: "database pool" });

      expect(repo.summary.fileCount).toBe(1);
      expect(existsSync(repo.indexPath)).toBe(true);
      expect(repo.sqliteIndexPath).toMatch(/repo-index\.sqlite$/);
      expect(existsSync(repo.sqliteIndexPath)).toBe(true);
      expect(semantic.index.provider).toBe("deterministic-token-overlap");
      expect(status.repoIndex?.fresh).toBe(true);
      expect(status.repoIndex?.indexHealth.status).toBe("fresh");
      expect(status.sqliteIndex?.fresh).toBe(true);
      expect(status.sqliteIndex?.ftsAvailable).toEqual(expect.any(Boolean));
      expect(status.sqliteIndex?.retrievalModes).toEqual(expect.arrayContaining(["sqlite_like"]));
      expect(status.sqliteIndex?.indexHealth.status).toBe("fresh");
      expect(status.sqliteIndex?.summary.fileCount).toBe(1);
      expect(search.results[0]?.id).toBe("db");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("queries the durable SQLite repo index before falling back to JSON", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-durable-sqlite-index-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "db.ts"),
      "export function connectDatabase() { return 'sqlite pool'; }\n",
    );
    writeFileSync(path.join(repoRoot, "docs", "usage.md"), "# Usage\n\nCall connectDatabase.\n");

    try {
      refreshDurableRepoIndex({ repoRoot });
      const status = durableIndexStatus({ repoRoot });

      const result = queryDurableShardedRepoIndex({
        repoRoot,
        query: "connectDatabase",
        lanes: ["runtime"],
        limit: 5,
      });

      expect(result.usedSqlite).toBe(true);
      expect(result.retrievalMode).toBe(
        status.sqliteIndex?.ftsAvailable ? "sqlite_fts" : "sqlite_like",
      );
      expect(result.indexHealth.status).toBe("fresh");
      expect(result.warnings).toEqual([]);
      expect(result.usedManifest).toBe(false);
      expect(result.indexPaths).toEqual([path.join(repoRoot, ".wormhole", "indexes", "repo-index.sqlite")]);
      expect(result.queriedLanes).toEqual(["runtime"]);
      expect(result.results.map((candidate) => candidate.path)).toContain("src/db.ts");
      expect(result.results.map((candidate) => candidate.path)).not.toContain("docs/usage.md");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("surfaces stale durable index health and only refuses results when freshness is required", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-durable-stale-index-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    const filePath = path.join(repoRoot, "src", "service.ts");
    writeFileSync(filePath, "export function loadService() { return 'old durable value'; }\n");

    try {
      refreshDurableRepoIndex({ repoRoot });
      writeFileSync(filePath, "export function loadService() { return 'new durable value'; }\n");

      const stale = queryDurableShardedRepoIndex({
        repoRoot,
        query: "old durable value",
        limit: 5,
      });
      const refused = queryDurableShardedRepoIndex({
        repoRoot,
        query: "old durable value",
        limit: 5,
        requireFresh: true,
      });

      expect(stale.indexHealth.status).toBe("stale");
      expect(stale.warnings).toContain("Durable repo index is stale; refresh before relying on generated repo guidance.");
      expect(stale.results.map((candidate) => candidate.path)).toContain("src/service.ts");
      expect(refused.refused).toBe(true);
      expect(refused.results).toEqual([]);
      expect(refused.indexHealth.status).toBe("stale");
      expect(refused.indexHealth.recommendedAction).toBe("refresh_index");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports time-limited durable indexes as fresh but degraded immediately after writing", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-durable-time-limited-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "one.ts"), "export const one = 1;\n");
    writeFileSync(path.join(repoRoot, "src", "two.ts"), "export const two = 2;\n");

    try {
      refreshDurableRepoIndex({ repoRoot, maxElapsedMs: 0 });
      const status = durableIndexStatus({ repoRoot });

      expect(status.repoIndex?.fresh).toBe(true);
      expect(status.repoIndex?.indexHealth.status).toBe("degraded");
      expect(status.sqliteIndex?.fresh).toBe(true);
      expect(status.sqliteIndex?.indexHealth.status).toBe("degraded");
      expect(status.factGraph?.fresh).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("preserves traversal bounds from durable repo index build options", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-durable-index-options-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "root.ts"), "export const root = true;\n");
    writeFileSync(path.join(repoRoot, "src", "nested.ts"), "export const nested = true;\n");

    try {
      refreshDurableRepoIndex({
        repoRoot,
        maxDepth: 0,
        maxDirs: 1,
        maxElapsedMs: 1_000,
      });

      expect(durableRepoIndexBuildOptions({ repoRoot })).toEqual(
        expect.objectContaining({
          maxDepth: 0,
          maxDirs: 1,
          maxElapsedMs: 1_000,
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
