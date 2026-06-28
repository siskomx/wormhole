import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

describe("repo activity MCP tool handlers", () => {
  it("auto-records mission evidence and refreshes the durable graph during watch scans", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-watch-tools-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = 1;\n");

    try {
      const kernel = createInMemoryKernel();
      const tools = createToolHandlers(kernel, { allowedRepoRoots: [repoRoot] });
      const mission = tools.missionStart({
        objective: "Track repo changes",
        repoRoot,
      });
      tools.roundStart({ missionId: mission.missionId });
      const watch = tools.repoWatchStart({
        repoRoot,
        missionId: mission.missionId,
        autoRecord: true,
        autoRefreshGraph: true,
      });

      writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = 2;\n");

      const scan = tools.repoWatchScan({ watchId: watch.watchId });
      const status = tools.missionStatus({ missionId: mission.missionId });
      const indexStatus = tools.durableIndexStatus({ repoRoot });

      expect(scan.changedFiles).toEqual(["src/app.ts"]);
      expect(scan.recordedEvidence).toHaveLength(1);
      expect(scan.recordedEvidence[0]).toEqual(
        expect.objectContaining({
          retrievalMethod: "repo_watch_scan",
          sourceType: "derived_note",
        }),
      );
      expect(scan.graphRefresh?.summary.fileCount).toBe(1);
      expect(existsSync(scan.graphRefresh?.indexPath ?? "")).toBe(true);
      expect(status.evidenceCount).toBe(1);
      expect(indexStatus.repoIndex?.fresh).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refreshes the repo graph incrementally from changed files and records activity", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-graph-refresh-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "app.ts"),
      [
        "export function runApp() {",
        "  return 'app';",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(repoRoot, "src", "app.test.ts"),
      "import { runApp } from './app';\ntest('runApp', () => runApp());\n",
    );

    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const refresh = tools.repoGraphRefreshIncremental({
        repoRoot,
        changedFiles: ["src/app.ts"],
        diffText: "diff --git a/src/app.ts b/src/app.ts\n@@ -1,3 +1,3 @@\n export function runApp() {\n-  return 'app';\n+  return 'new app';\n }\n",
      });
      const fullRefresh = tools.repoGraphRefreshFull({
        repoRoot,
        changedFiles: ["src/app.ts"],
      });
      const activity = tools.repoWatchStatus({ repoRoot });

      expect(refresh.changedFiles).toEqual(["src/app.ts"]);
      expect(refresh.refreshMode).toBe("full_rebuild");
      expect(fullRefresh.refreshMode).toBe("full_rebuild");
      expect(refresh.index.summary.fileCount).toBe(2);
      expect(refresh.testImpact.changedSymbols.map((symbol) => symbol.name)).toContain("runApp");
      expect(refresh.testImpact.likelyTests[0]?.path).toBe("src/app.test.ts");
      expect(refresh.activity.kind).toBe("graph_refreshed");
      expect(activity.events.map((event) => event.kind)).toContain("graph_refreshed");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("persists failed state maintenance runs and retries with corrected inputs", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-state-maintenance-failure-"));
    const runtimeStatePath = path.join(repoRoot, ".wormhole", "runtime-state.json");
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = 1;\n");

    try {
      const kernel = createInMemoryKernel();
      const tools = createToolHandlers(kernel, {
        allowedRepoRoots: [repoRoot],
        runtimeStatePath,
      });
      const mission = tools.missionStart({
        objective: "Persist failed maintenance",
        repoRoot,
      });
      tools.roundStart({ missionId: mission.missionId });

      const failed = tools.stateMaintenanceRun({
        repoRoot,
        missionId: mission.missionId,
        objective: "Persist failed maintenance",
        changedFiles: ["src/app.ts"],
        refreshGraph: true,
        workspace: {
          workspaceId: "missing-workspace",
          key: "state",
          value: "will fail",
        },
      });
      const workspace = tools.agentWorkspaceCreate({
        missionId: mission.missionId,
        objective: "Correct retry workspace",
      });
      const retried = tools.stateMaintenanceRetry({
        runId: failed.runId,
        overrides: {
          workspace: {
            workspaceId: workspace.workspaceId,
            key: "state",
            value: "retry succeeds",
            merge: true,
          },
        },
      });
      const restarted = createToolHandlers(kernel, {
        allowedRepoRoots: [repoRoot],
        runtimeStatePath,
      });
      const status = restarted.stateMaintenanceStatus({ runId: failed.runId });

      expect(failed.status).toBe("failed");
      expect(failed.error).toContain("Agent workspace not found");
      expect(failed.actions.map((action) => action.status)).toContain("failed");
      expect(status.runs[0]?.status).toBe("failed");
      expect(status.runs[0]?.actions.map((action) => action.toolName)).toContain("repo_graph_refresh_incremental");
      expect(retried.retryOf).toBe(failed.runId);
      expect(retried.status).toBe("completed");
      expect(retried.workspace?.written?.value).toBe("retry succeeds");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("optionally runs source conflict analysis and durable freshness checks during state maintenance", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-state-maintenance-freshness-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, ".wormhole", "workflows"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify(
        {
          type: "module",
          scripts: { test: "vitest run tests" },
          devDependencies: { typescript: "^6.0.3", vitest: "^4.1.9" },
        },
        null,
        2,
      ),
    );
    writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = 1;\n");
    writeFileSync(
      path.join(repoRoot, ".wormhole", "workflows", "stale.json"),
      `${JSON.stringify({ indexFingerprint: "old-fingerprint" }, null, 2)}\n`,
    );

    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      tools.durableIndexManifestRefresh({ repoRoot });
      writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = 2;\n");

      const result = tools.stateMaintenanceRun({
        repoRoot,
        objective: "Refresh maintenance signals",
        changedFiles: ["src/app.ts"],
        refreshGraph: false,
        sourceConflicts: true,
        freshness: true,
      });

      expect(result.status).toBe("completed");
      expect(result.actions.map((action: { toolName: string }) => action.toolName)).toEqual(
        expect.arrayContaining([
          "source_conflicts_analyze",
          "durable_index_status",
          "durable_index_manifest_status",
          "mission_route",
        ]),
      );
      expect(result.sourceConflicts?.conflicts).toContainEqual(
        expect.objectContaining({
          subject: ".wormhole/workflows/stale.json#indexFingerprint",
          severity: "warning",
        }),
      );
      expect(result.freshness?.durableIndex.repoIndex?.fresh).toBe(false);
      expect(result.freshness?.durableIndexManifest.manifest?.fresh).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("runs graph, context, evidence, route, and workspace maintenance as one audited tool call", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-state-maintenance-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "app.ts"),
      "export function runApp() {\n  return 'old app';\n}\n",
    );
    writeFileSync(
      path.join(repoRoot, "tests", "app.test.ts"),
      "import { runApp } from '../src/app';\ntest('runApp', () => runApp());\n",
    );

    try {
      const kernel = createInMemoryKernel();
      const tools = createToolHandlers(kernel, { allowedRepoRoots: [repoRoot] });
      const mission = tools.missionStart({
        objective: "Maintain state after app changes",
        repoRoot,
      });
      tools.roundStart({ missionId: mission.missionId });
      const pinned = tools.ctxRecord({
        source: "src/app.ts",
        sourceType: "file",
        text: "runApp implementation is the source of truth for app behavior.",
        tags: ["app"],
      });
      const stale = tools.ctxRecord({
        source: "src/old.ts",
        sourceType: "file",
        text: "Old app behavior notes should be evicted.",
        tags: ["stale"],
      });
      const workspace = tools.agentWorkspaceCreate({
        missionId: mission.missionId,
        objective: "Share maintenance state.",
      });

      writeFileSync(
        path.join(repoRoot, "src", "app.ts"),
        "export function runApp() {\n  return 'new app';\n}\n",
      );

      const result = tools.stateMaintenanceRun({
        repoRoot,
        missionId: mission.missionId,
        objective: "Maintain state after app changes",
        query: "runApp tests",
        changedFiles: ["src/app.ts"],
        diffText:
          "diff --git a/src/app.ts b/src/app.ts\n@@ -1,3 +1,3 @@\n export function runApp() {\n-  return 'old app';\n+  return 'new app';\n }\n",
        refreshGraph: true,
        recordEvidence: true,
        context: {
          maxChars: 160,
          recordIds: [pinned.contextId, stale.contextId],
          pinnedRecordIds: [pinned.contextId],
          staleRecordIds: [stale.contextId],
        },
        workspace: {
          workspaceId: workspace.workspaceId,
          runId: "state-maintenance",
          key: "state_maintenance",
          value: { summary: "runApp changed; graph and context refreshed." },
          merge: true,
        },
      });
      const status = tools.missionStatus({ missionId: mission.missionId });
      const indexStatus = tools.durableIndexStatus({ repoRoot });

      expect(result.status).toBe("completed");
      expect(result.changedFiles).toEqual(["src/app.ts"]);
      expect(result.actions.map((action: { toolName: string }) => action.toolName)).toEqual(
        expect.arrayContaining([
          "repo_graph_refresh_incremental",
          "ctx_pack_refresh",
          "record_evidence",
          "agent_workspace_write",
          "agent_workspace_merge",
          "mission_route",
        ]),
      );
      expect(result.graph?.refreshMode).toBe("full_rebuild");
      expect(result.graph?.index.summary.fileCount).toBe(2);
      expect(result.context?.pack.contextIds).toEqual([pinned.contextId]);
      expect(result.recordedEvidence).toHaveLength(1);
      expect(result.workspace?.written?.key).toBe("state_maintenance");
      expect(result.workspace?.merge?.conflicts).toEqual([]);
      if (!result.route) {
        throw new Error("Expected completed state maintenance run to include a route");
      }
      expect(result.route.stateMaintenance.coordinator.toolName).toBe("state_maintenance_run");
      expect(status.evidenceCount).toBe(1);
      expect(indexStatus.repoIndex?.fresh).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
