import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GraphCommunityRecord } from "../src/graph-communities.js";
import { getSurprisingConnections } from "../src/surprising-connections.js";
import { buildRepoIndex } from "../src/repo-index.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-surprising-connections-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(path.join(repoRoot, "src", "api.ts"), 'import { queryDb } from "./db";\nexport const api = queryDb();\n');
  writeFileSync(path.join(repoRoot, "src", "db.ts"), "export function queryDb() { return 'ok'; }\n");
  writeFileSync(path.join(repoRoot, "docs.md"), "# Docs\n\nSee [api](src/api.ts).\n");
  return repoRoot;
}

describe("surprising graph connections", () => {
  it("ranks cross-community edges with path and reason evidence", () => {
    const repoRoot = createFixtureRepo();
    try {
      const index = buildRepoIndex({ repoRoot });
      const communities: GraphCommunityRecord[] = [
        {
          id: "community:docs",
          sidecarId: "community-1",
          label: "docs",
          members: ["docs.md"],
          fileCount: 1,
          symbolCount: 0,
          topFiles: ["docs.md"],
        },
        {
          id: "community:runtime",
          sidecarId: "community-2",
          label: "src",
          members: ["src/api.ts", "src/db.ts"],
          fileCount: 2,
          symbolCount: 2,
          topFiles: ["src/api.ts", "src/db.ts"],
        },
      ];

      const result = getSurprisingConnections({ repoRoot, index, communities, limit: 5 });

      expect(result.results[0]).toEqual(
        expect.objectContaining({
          from: "docs.md",
          to: "src/api.ts",
          fromCommunityId: "community:docs",
          toCommunityId: "community:runtime",
          path: ["docs.md", "src/api.ts"],
          edgeKinds: ["links"],
          reason: expect.stringContaining("crosses communities"),
        }),
      );
      expect(result.results.map((connection) => connection.fromCommunityId)).not.toContain(
        "community:runtime|community:runtime",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses when community data is unavailable", () => {
    const repoRoot = createFixtureRepo();
    try {
      const index = buildRepoIndex({ repoRoot });
      const result = getSurprisingConnections({ repoRoot, index, communities: [] });

      expect(result).toEqual(
        expect.objectContaining({
          refused: true,
          hint: expect.stringContaining("graph_communities_refresh"),
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
