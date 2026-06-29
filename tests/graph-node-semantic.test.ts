import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionFlowRecord } from "../src/execution-flow-store.js";
import {
  createGraphNodeSemanticRecords,
  refreshGraphNodeSemanticIndex,
  searchGraphNodeSemanticIndex,
} from "../src/graph-node-semantic.js";
import type { GraphCommunityRecord } from "../src/graph-communities.js";
import { buildRepoIndex } from "../src/repo-index.js";

function createFixtureRepo(): { repoRoot: string; communities: GraphCommunityRecord[]; flows: ExecutionFlowRecord[] } {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-graph-node-semantic-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "src", "billing.ts"),
    "export function invoiceApprovalWorkflow() { return 'approved'; }\n",
  );
  return {
    repoRoot,
    communities: [
      {
        id: "community:billing",
        sidecarId: "community-1",
        label: "billing",
        members: ["src/billing.ts"],
        fileCount: 1,
        symbolCount: 1,
        topFiles: ["src/billing.ts"],
      },
    ],
    flows: [
      {
        id: "flow:invoice-approval",
        name: "invoice approval",
        kind: "worker",
        entrypointId: "entrypoint:worker:src/billing.ts",
        path: "src/billing.ts",
        symbol: "invoiceApprovalWorkflow",
        downstreamFiles: [],
        communityIds: ["community:billing"],
        evidence: [],
      },
    ],
  };
}

describe("graph-node semantic index", () => {
  it("emits graph-node records for files, symbols, communities, and flows", () => {
    const { repoRoot, communities, flows } = createFixtureRepo();
    try {
      const index = buildRepoIndex({ repoRoot });
      const records = createGraphNodeSemanticRecords({ index, communities, flows });

      expect(records.map((record) => record.id)).toEqual(
        expect.arrayContaining([
          "graph:file:src/billing.ts",
          "graph:community:community:billing",
          "graph:flow:flow:invoice-approval",
        ]),
      );
      expect(records.some((record) => record.id.startsWith("graph:symbol:"))).toBe(true);
      expect(records.find((record) => record.id === "graph:flow:flow:invoice-approval")?.text).toContain(
        "invoice approval",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("persists and searches graph-node records with a kind filter", () => {
    const { repoRoot, communities, flows } = createFixtureRepo();
    try {
      const index = buildRepoIndex({ repoRoot });
      refreshGraphNodeSemanticIndex({ repoRoot, index, communities, flows });

      const allResults = searchGraphNodeSemanticIndex({ repoRoot, query: "invoice approval", limit: 10 });
      const flowOnly = searchGraphNodeSemanticIndex({
        repoRoot,
        query: "invoice approval",
        kinds: ["flow"],
        limit: 10,
      });

      expect(allResults.results.map((result) => result.id)).toContain("graph:flow:flow:invoice-approval");
      expect(flowOnly.results.map((result) => result.kind)).toEqual(["flow"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns an empty result with a refresh hint when the index is missing", () => {
    const { repoRoot } = createFixtureRepo();
    try {
      const result = searchGraphNodeSemanticIndex({ repoRoot, query: "anything" });

      expect(result.results).toEqual([]);
      expect(result.hint).toContain("graph_node_semantic_index_refresh");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
