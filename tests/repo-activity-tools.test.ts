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
      const activity = tools.repoWatchStatus({ repoRoot });

      expect(refresh.changedFiles).toEqual(["src/app.ts"]);
      expect(refresh.index.summary.fileCount).toBe(2);
      expect(refresh.testImpact.changedSymbols.map((symbol) => symbol.name)).toContain("runApp");
      expect(refresh.testImpact.likelyTests[0]?.path).toBe("src/app.test.ts");
      expect(refresh.activity.kind).toBe("graph_refreshed");
      expect(activity.events.map((event) => event.kind)).toContain("graph_refreshed");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
