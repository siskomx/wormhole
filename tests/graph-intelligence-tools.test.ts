import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import type { PythonSidecar } from "../src/python-sidecar.js";
import { createToolHandlers } from "../src/tools.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-graph-intelligence-tools-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ type: "module", scripts: { worker: "node dist/worker.js" } }, null, 2),
  );
  writeFileSync(
    path.join(repoRoot, "src", "api.ts"),
    ['import { queryDb } from "./db";', "export function apiHandler() { return queryDb(); }\n"].join("\n"),
  );
  writeFileSync(path.join(repoRoot, "src", "db.ts"), "export function queryDb() { return 'ok'; }\n");
  writeFileSync(path.join(repoRoot, "src", "worker.ts"), "export function runWorker() { return 'ok'; }\n");
  writeFileSync(path.join(repoRoot, "README.md"), "# API\n\nSee [api](src/api.ts).\n");
  return repoRoot;
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
            { id: "community-2", members: ["src/api.ts", "src/db.ts", "src/worker.ts"] },
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

describe("graph intelligence tool handlers", () => {
  it("refreshes and queries communities, connections, flows, wiki pages, and graph-node search", async () => {
    const repoRoot = createFixtureRepo();
    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
        pythonSidecar: fakeCommunitySidecar(),
      });

      const communities = await tools.graphCommunitiesRefresh({ repoRoot });
      const listedCommunities = tools.listCommunities({ repoRoot });
      const runtimeCommunity = listedCommunities.communities.find((community) =>
        community.members.includes("src/api.ts"),
      );
      const community = tools.getCommunity({ repoRoot, id: runtimeCommunity?.id ?? "" });
      const connections = tools.getSurprisingConnections({ repoRoot });
      const flows = tools.flowsRefresh({ repoRoot });
      const listedFlows = tools.listFlows({ repoRoot, query: "worker" });
      const flow = tools.getFlow({ repoRoot, idOrName: listedFlows.flows[0]?.id ?? "" });
      const graphSearchIndex = tools.graphNodeSemanticIndexRefresh({ repoRoot });
      const graphSearch = tools.graphNodeSemanticSearch({
        repoRoot,
        query: "apiHandler",
        kinds: ["symbol"],
      });
      const wiki = tools.graphWikiGenerate({ repoRoot });

      expect(communities.communities).toHaveLength(2);
      expect(community.files.map((file) => file.path)).toContain("src/api.ts");
      expect(connections.results[0]?.reason).toContain("crosses communities");
      expect(flows.flows.length).toBeGreaterThan(0);
      expect(flow.flow?.id).toBe(listedFlows.flows[0]?.id);
      expect(graphSearchIndex.records.length).toBeGreaterThan(0);
      expect(graphSearch.results.map((result) => result.kind)).toEqual(["symbol"]);
      expect(wiki.pages.map((page) => page.relativePath)).toContain(".wormhole/graph-wiki/index.md");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("surfaces derived graph artifact maintenance advisories without refreshing them implicitly", () => {
    const repoRoot = createFixtureRepo();
    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
        pythonSidecar: fakeCommunitySidecar(),
      });

      const maintenance = tools.stateMaintenanceRun({
        repoRoot,
        objective: "Check derived graph artifacts.",
        refreshGraph: false,
      });

      expect(maintenance.derivedGraphArtifacts?.statuses.map((status) => status.kind)).toEqual(
        expect.arrayContaining(["communities", "flows", "graph_node_semantic_index", "graph_wiki"]),
      );
      expect(maintenance.derivedGraphArtifacts?.warnings.join("\n")).toContain("graph_communities_refresh");
      expect(tools.listCommunities({ repoRoot }).refused).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
