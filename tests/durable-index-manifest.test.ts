import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  durableIndexManifestStatus,
  queryDurableShardedRepoIndex,
  refreshDurableIndexManifest,
} from "../src/durable-index-store.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-durable-manifest-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
  mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ scripts: { test: "vitest run tests" } }, null, 2),
  );
  writeFileSync(
    path.join(repoRoot, "src", "user.ts"),
    [
      "export function loadUser(id: string) {",
      "  return { id, name: 'Ada' };",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "tests", "user.test.ts"),
    [
      "import { loadUser } from '../src/user';",
      "test('loads users', () => {",
      "  expect(loadUser('7').name).toBe('Ada');",
      "});",
    ].join("\n"),
  );
  writeFileSync(path.join(repoRoot, "docs", "usage.md"), "# Usage\n\nCall loadUser from runtime code.\n");
  return repoRoot;
}

describe("durable index manifest and shards", () => {
  it("writes a master manifest with lane shard metadata", () => {
    const repoRoot = createFixtureRepo();
    try {
      const manifest = refreshDurableIndexManifest({ repoRoot });

      expect(existsSync(manifest.manifestPath)).toBe(true);
      expect(manifest.fullIndex.fileCount).toBeGreaterThanOrEqual(4);
      expect(manifest.totalFileCount).toBe(manifest.fullIndex.fileCount);
      expect(manifest.lanes.map((lane) => lane.lane)).toEqual(
        expect.arrayContaining(["runtime", "tests", "docs"]),
      );
      expect(manifest.strategy).toBe("root");
      expect(manifest.shards.map((shard) => shard.shardRoot)).toEqual(
        expect.arrayContaining(["src", "tests", "docs"]),
      );
      for (const lane of manifest.lanes) {
        expect(lane.indexId).toMatch(/^repo-index:/);
        expect(existsSync(lane.indexPath)).toBe(true);
        expect(lane.fileCount).toBeGreaterThan(0);
        expect(lane.byteLength).toBeGreaterThan(0);
        expect(lane.fingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(lane.fresh).toBe(true);
      }
      for (const shard of manifest.shards) {
        expect(shard.shardId).toMatch(/^root:/);
        expect(existsSync(shard.indexPath)).toBe(true);
        expect(shard.fileCount).toBeGreaterThan(0);
      }

      const status = durableIndexManifestStatus({ repoRoot });
      expect(status.manifest?.fresh).toBe(true);
      expect(status.manifest?.lanes.map((lane) => lane.lane)).toEqual(
        expect.arrayContaining(["runtime", "tests", "docs"]),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("queries selected durable shards and falls back through the manifest", () => {
    const repoRoot = createFixtureRepo();
    try {
      refreshDurableIndexManifest({ repoRoot });

      const runtime = queryDurableShardedRepoIndex({
        repoRoot,
        query: "loadUser",
        lanes: ["runtime"],
      });
      const tests = queryDurableShardedRepoIndex({
        repoRoot,
        query: "loadUser",
        lanes: ["tests"],
      });
      const docs = queryDurableShardedRepoIndex({
        repoRoot,
        query: "loadUser",
        lanes: ["docs"],
      });

      expect(runtime.results.map((result) => result.path)).toContain("src/user.ts");
      expect(tests.results.map((result) => result.path)).toContain("tests/user.test.ts");
      expect(docs.results.map((result) => result.path)).toContain("docs/usage.md");
      expect(runtime.queriedLanes).toEqual(["runtime"]);
      expect(tests.usedSqlite).toBe(true);
      expect(tests.usedManifest).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
