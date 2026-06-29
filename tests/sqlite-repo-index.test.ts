import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRepoIndex } from "../src/repo-index.js";
import {
  querySqliteRepoIndex,
  readSqliteRepoIndexStatus,
  writeSqliteRepoIndex,
} from "../src/sqlite-repo-index.js";

describe("sqlite repo index", () => {
  it("writes, queries, and reports stale status after repo content changes", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-sqlite-index-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export function runApp() { return true; }\n");

    const index = buildRepoIndex({ repoRoot });
    const indexPath = writeSqliteRepoIndex(index);
    const query = querySqliteRepoIndex({ repoRoot, query: "runApp" });

    expect(indexPath).toContain("repo-index.sqlite");
    expect(readSqliteRepoIndexStatus(repoRoot)?.fresh).toBe(true);
    expect(query?.results[0]).toMatchObject({ path: "src/app.ts" });

    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export function runApp() { return false; }\n");

    expect(readSqliteRepoIndexStatus(repoRoot)?.fresh).toBe(false);
  });
});
