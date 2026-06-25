import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRepoActivityStore } from "../src/repo-activity.js";

function createRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-activity-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = 1;\n");
  writeFileSync(path.join(repoRoot, "src", "keep.ts"), "export const keep = 1;\n");
  return repoRoot;
}

function runGit(repoRoot: string, args: string[]): void {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    shell: false,
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

describe("repo activity watch layer", () => {
  it("detects added, modified, and deleted files from watch snapshots", () => {
    const repoRoot = createRepo();
    mkdirSync(path.join(repoRoot, ".wormhole"), { recursive: true });
    mkdirSync(path.join(repoRoot, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(repoRoot, ".wormhole", "runtime-state.json"), "{}\n");
    writeFileSync(path.join(repoRoot, "node_modules", "pkg", "index.js"), "ignored\n");

    try {
      const store = createRepoActivityStore();
      const watch = store.startWatch({ repoRoot });

      writeFileSync(path.join(repoRoot, "src", "keep.ts"), "export const keep = 2;\n");
      writeFileSync(path.join(repoRoot, "src", "new.ts"), "export const added = true;\n");
      unlinkSync(path.join(repoRoot, "src", "app.ts"));
      writeFileSync(path.join(repoRoot, ".wormhole", "runtime-state.json"), "{\"ignored\":true}\n");

      const scan = store.scanWatch({ watchId: watch.watchId });

      expect(scan.changedFiles).toEqual(["src/app.ts", "src/keep.ts", "src/new.ts"]);
      expect(scan.fileChanges).toEqual([
        expect.objectContaining({ path: "src/app.ts", kind: "deleted" }),
        expect.objectContaining({ path: "src/keep.ts", kind: "modified" }),
        expect.objectContaining({ path: "src/new.ts", kind: "added" }),
      ]);
      expect(scan.changedFiles).not.toContain(".wormhole/runtime-state.json");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reads git status and diff snapshots for changed working trees", () => {
    const repoRoot = createRepo();

    try {
      runGit(repoRoot, ["init"]);
      runGit(repoRoot, ["config", "user.email", "wormhole@example.test"]);
      runGit(repoRoot, ["config", "user.name", "Wormhole"]);
      runGit(repoRoot, ["add", "src/app.ts", "src/keep.ts"]);
      runGit(repoRoot, ["commit", "-m", "initial"]);

      writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = 2;\n");
      writeFileSync(path.join(repoRoot, "src", "untracked.ts"), "export const newFile = true;\n");

      const store = createRepoActivityStore();
      const scan = store.scanChanges({ repoRoot });

      expect(scan.git.available).toBe(true);
      expect(scan.git.changedFiles).toEqual(["src/app.ts", "src/untracked.ts"]);
      expect(scan.git.status).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "src/app.ts", worktreeStatus: "M" }),
          expect.objectContaining({ path: "src/untracked.ts", worktreeStatus: "?" }),
        ]),
      );
      expect(scan.git.diffText).toContain("-export const app = 1;");
      expect(scan.git.diffText).toContain("+export const app = 2;");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("records manual repo activity events in the runtime snapshot", () => {
    const repoRoot = createRepo();

    try {
      const store = createRepoActivityStore();
      const event = store.recordActivity({
        repoRoot,
        kind: "command_run",
        summary: "Ran focused tests.",
        paths: ["src/app.ts"],
        metadata: { command: "npm test -- tests/repo-activity.test.ts" },
      });
      const status = store.status({ repoRoot });

      expect(event.eventId).toMatch(/^activity:/);
      expect(event.kind).toBe("command_run");
      expect(status.events).toEqual([event]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
