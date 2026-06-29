import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getExecutionFlow,
  listExecutionFlows,
  refreshExecutionFlows,
} from "../src/execution-flow-store.js";
import type { GraphCommunityRecord } from "../src/graph-communities.js";
import { discoverEntrypointFlows } from "../src/project-intelligence.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-execution-flows-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ type: "module", scripts: { worker: "node dist/worker.js" } }, null, 2),
  );
  writeFileSync(path.join(repoRoot, "src", "worker.ts"), "export function runWorker() { return 'ok'; }\n");
  return repoRoot;
}

describe("execution flow store", () => {
  it("refreshes stable named flows and attaches community membership", () => {
    const repoRoot = createFixtureRepo();
    try {
      const discovery = discoverEntrypointFlows({ repoRoot });
      const communities: GraphCommunityRecord[] = [
        {
          id: "community:worker",
          sidecarId: "community-1",
          label: "src",
          members: ["src/worker.ts"],
          fileCount: 1,
          symbolCount: 1,
          topFiles: ["src/worker.ts"],
        },
      ];

      const first = refreshExecutionFlows({ repoRoot, discovery, communities });
      const second = refreshExecutionFlows({ repoRoot, discovery, communities });
      const listed = listExecutionFlows({ repoRoot, currentFingerprint: discovery.fingerprint, kind: "worker" });

      expect(first.flows.map((flow) => flow.id)).toEqual(second.flows.map((flow) => flow.id));
      expect(listed.refused).toBeUndefined();
      expect(listed.flows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "worker",
            communityIds: ["community:worker"],
          }),
        ]),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("gets flows by id or name and filters list results by query", () => {
    const repoRoot = createFixtureRepo();
    try {
      const discovery = discoverEntrypointFlows({ repoRoot });
      const store = refreshExecutionFlows({ repoRoot, discovery });
      const flow = store.flows.find((candidate) => candidate.kind === "worker");
      expect(flow).toBeDefined();

      const byId = getExecutionFlow({ repoRoot, idOrName: flow?.id ?? "" });
      const byName = getExecutionFlow({ repoRoot, idOrName: flow?.name ?? "" });
      const queried = listExecutionFlows({ repoRoot, query: "worker" });

      expect(byId.flow?.id).toBe(flow?.id);
      expect(byName.flow?.id).toBe(flow?.id);
      expect(queried.flows.map((candidate) => candidate.id)).toContain(flow?.id);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses stale flow lists when the caller supplies a different fingerprint", () => {
    const repoRoot = createFixtureRepo();
    try {
      const discovery = discoverEntrypointFlows({ repoRoot });
      refreshExecutionFlows({ repoRoot, discovery });

      expect(listExecutionFlows({ repoRoot, currentFingerprint: "stale" })).toEqual(
        expect.objectContaining({
          refused: true,
          hint: expect.stringContaining("flows_refresh"),
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
