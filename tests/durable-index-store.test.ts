import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  refreshDurableRepoIndex,
  refreshDurableSemanticIndex,
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
      expect(status.sqliteIndex?.fresh).toBe(true);
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

      const result = queryDurableShardedRepoIndex({
        repoRoot,
        query: "connectDatabase",
        lanes: ["runtime"],
        limit: 5,
      });

      expect(result.usedSqlite).toBe(true);
      expect(result.usedManifest).toBe(false);
      expect(result.indexPaths).toEqual([path.join(repoRoot, ".wormhole", "indexes", "repo-index.sqlite")]);
      expect(result.queriedLanes).toEqual(["runtime"]);
      expect(result.results.map((candidate) => candidate.path)).toContain("src/db.ts");
      expect(result.results.map((candidate) => candidate.path)).not.toContain("docs/usage.md");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
