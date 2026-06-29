import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getGraphCommunity,
  listGraphCommunities,
  refreshGraphCommunities,
} from "../src/graph-communities.js";
import type { PythonSidecar } from "../src/python-sidecar.js";
import { buildRepoIndex, type RepoIndex } from "../src/repo-index.js";

function createFixtureRepo(): { repoRoot: string; index: RepoIndex } {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-graph-communities-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "src", "api.ts"),
    ['import { queryDb } from "./db";', "export function apiHandler() { return queryDb(); }\n"].join("\n"),
  );
  writeFileSync(path.join(repoRoot, "src", "db.ts"), "export function queryDb() { return 'ok'; }\n");
  writeFileSync(path.join(repoRoot, "README.md"), "# API\n\nSee [api](src/api.ts).\n");
  return { repoRoot, index: buildRepoIndex({ repoRoot }) };
}

function fakeCommunitySidecar(): PythonSidecar {
  return {
    async run() {
      return {
        ok: true,
        job: "graph_communities",
        result: {
          communityCount: 2,
          communities: [
            { id: "community-1", members: ["README.md"] },
            { id: "community-2", members: ["src/api.ts", "src/db.ts"] },
          ],
        },
        timedOut: false,
        exitCode: 0,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        evidenceHash: "sha256:test",
      };
    },
  };
}

describe("graph communities", () => {
  it("refreshes a deterministic community store and lists current communities", async () => {
    const { repoRoot, index } = createFixtureRepo();
    try {
      const first = await refreshGraphCommunities({ repoRoot, index, sidecar: fakeCommunitySidecar() });
      const second = await refreshGraphCommunities({ repoRoot, index, sidecar: fakeCommunitySidecar() });
      const listed = listGraphCommunities({ repoRoot, index });

      expect(first.communities.map((community) => community.id)).toEqual(
        second.communities.map((community) => community.id),
      );
      expect(listed.refused).toBeUndefined();
      expect(listed.communities).toHaveLength(2);
      expect(listed.communities.find((community) => community.members.includes("src/api.ts"))).toEqual(
        expect.objectContaining({
          label: "src",
          fileCount: 2,
          symbolCount: expect.any(Number),
          topFiles: expect.arrayContaining(["src/api.ts"]),
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses list and get queries when the store is missing or stale", async () => {
    const { repoRoot, index } = createFixtureRepo();
    try {
      expect(listGraphCommunities({ repoRoot, index })).toEqual(
        expect.objectContaining({
          refused: true,
          hint: expect.stringContaining("graph_communities_refresh"),
        }),
      );

      await refreshGraphCommunities({ repoRoot, index, sidecar: fakeCommunitySidecar() });
      const staleIndex = { ...index, fingerprint: "stale-fingerprint" };

      expect(listGraphCommunities({ repoRoot, index: staleIndex })).toEqual(
        expect.objectContaining({
          refused: true,
          reason: expect.stringContaining("stale"),
        }),
      );
      expect(getGraphCommunity({ repoRoot, index: staleIndex, id: "missing" })).toEqual(
        expect.objectContaining({
          refused: true,
          hint: expect.stringContaining("graph_communities_refresh"),
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns a community slice with internal and external edge evidence", async () => {
    const { repoRoot, index } = createFixtureRepo();
    try {
      const store = await refreshGraphCommunities({ repoRoot, index, sidecar: fakeCommunitySidecar() });
      const sourceCommunity = store.communities.find((community) => community.members.includes("src/api.ts"));
      expect(sourceCommunity).toBeDefined();

      const slice = getGraphCommunity({ repoRoot, index, id: sourceCommunity?.id ?? "" });

      expect(slice.community?.members).toEqual(["src/api.ts", "src/db.ts"]);
      expect(slice.files.map((file) => file.path)).toEqual(["src/api.ts", "src/db.ts"]);
      expect(slice.symbols.map((symbol) => symbol.name)).toEqual(
        expect.arrayContaining(["apiHandler", "queryDb"]),
      );
      expect(slice.internalEdges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "src/api.ts", to: "src/db.ts" }),
        ]),
      );
      expect(slice.incomingEdges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "README.md", to: "src/api.ts" }),
        ]),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
