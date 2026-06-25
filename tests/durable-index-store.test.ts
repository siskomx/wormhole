import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  refreshDurableRepoIndex,
  refreshDurableSemanticIndex,
  searchDurableSemanticIndex,
  durableIndexStatus,
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
      expect(semantic.index.provider).toBe("deterministic-token-overlap");
      expect(status.repoIndex?.fresh).toBe(true);
      expect(search.results[0]?.id).toBe("db");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
