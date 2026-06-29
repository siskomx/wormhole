import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  analyzeGitConflicts,
  createGitBranch,
  createGitCommit,
  gitLifecycleStatus,
  prepareGitBranch,
  prepareGitCommit,
  prepareGitPr,
} from "../src/git-lifecycle.js";

function runGit(repoRoot: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function createRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-git-life-"));
  runGit(repoRoot, ["init", "-b", "main"]);
  runGit(repoRoot, ["config", "user.name", "Wormhole Test"]);
  runGit(repoRoot, ["config", "user.email", "wormhole@example.test"]);
  writeFileSync(path.join(repoRoot, "README.md"), "# Test\n");
  runGit(repoRoot, ["add", "--", "README.md"]);
  runGit(repoRoot, ["commit", "--no-verify", "--message=initial"]);
  return repoRoot;
}

describe("git lifecycle", () => {
  it("summarizes git status and prepares branch, commit, and PR text", () => {
    const repoRoot = createRepo();
    try {
      writeFileSync(path.join(repoRoot, "src.ts"), "export const value = 1;\n");
      runGit(repoRoot, ["add", "--", "src.ts"]);
      writeFileSync(path.join(repoRoot, "README.md"), "# Test\n\nUpdated docs.\n");
      writeFileSync(path.join(repoRoot, "scratch.txt"), "scratch\n");

      const status = gitLifecycleStatus({ repoRoot });
      const branch = prepareGitBranch({ objective: "Add lifecycle gap tools", prefix: "IQx" });
      const commit = prepareGitCommit({ repoRoot, objective: "Add lifecycle gap tools" });
      const pr = prepareGitPr({ repoRoot, baseRef: "main", objective: "Add lifecycle gap tools" });

      expect(status.isGitRepo).toBe(true);
      expect(status.branch).toBe("main");
      expect(status.clean).toBe(false);
      expect(status.staged.map((entry) => entry.path)).toContain("src.ts");
      expect(status.unstaged.map((entry) => entry.path)).toContain("README.md");
      expect(status.untracked.map((entry) => entry.path)).toContain("scratch.txt");
      expect(branch.branchName).toBe("IQx/add-lifecycle-gap-tools");
      expect(commit.advisory).toBe(true);
      expect(commit.message).toMatch(/^feat:/);
      expect(commit.changedFiles).toEqual(expect.arrayContaining(["README.md", "scratch.txt", "src.ts"]));
      expect(pr.title).toContain("Add lifecycle gap tools");
      expect(pr.baseRef).toBe("main");
      expect(pr.headRef).toBe("main");
      expect(pr.body).toContain("## Summary");
      expect(pr.checklist).toContain("Run focused verification");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("creates branches and commits with explicit safe paths", () => {
    const repoRoot = createRepo();
    try {
      const branch = createGitBranch({ repoRoot, branchName: "IQx/safe-branch", checkout: true });
      writeFileSync(path.join(repoRoot, "feature.ts"), "export const feature = true;\n");

      const commit = createGitCommit({
        repoRoot,
        files: ["feature.ts"],
        message: "feat: add safe branch feature",
      });

      if (branch.refused === true) {
        throw new Error(branch.hint);
      }
      if (commit.refused === true) {
        throw new Error(commit.hint);
      }
      expect(branch.created).toBe(true);
      expect(branch.checkedOut).toBe(true);
      expect(runGit(repoRoot, ["branch", "--show-current"])).toBe("IQx/safe-branch");
      expect(commit.committed).toBe(true);
      expect(commit.commitHash).toMatch(/^[a-f0-9]{7,40}$/);
      expect(runGit(repoRoot, ["status", "--porcelain"])).toBe("");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses unsafe commit paths before staging anything", () => {
    const repoRoot = createRepo();
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-git-outside-"));
    try {
      writeFileSync(path.join(repoRoot, "safe.ts"), "export const safe = true;\n");
      writeFileSync(path.join(outsideRoot, "outside.ts"), "outside\n");
      const outsidePath = path.join(outsideRoot, "outside.ts");

      expect(createGitCommit({ repoRoot, files: [], message: "feat: empty" })).toMatchObject({
        refused: true,
      });
      expect(createGitCommit({ repoRoot, files: [outsidePath], message: "feat: outside" })).toMatchObject({
        refused: true,
      });
      expect(createGitCommit({ repoRoot, files: ["../outside.ts"], message: "feat: escape" })).toMatchObject({
        refused: true,
      });
      expect(createGitCommit({ repoRoot, files: ["missing.ts"], message: "feat: missing" })).toMatchObject({
        refused: true,
      });

      try {
        symlinkSync(outsidePath, path.join(repoRoot, "linked-outside.ts"));
        expect(createGitCommit({ repoRoot, files: ["linked-outside.ts"], message: "feat: symlink" })).toMatchObject({
          refused: true,
        });
      } catch {
        expect(realpathSync(repoRoot)).toBeTruthy();
      }

      try {
        const outsideDir = path.join(outsideRoot, "outside-dir");
        mkdirSync(outsideDir);
        writeFileSync(path.join(outsideDir, "nested.ts"), "outside\n");
        symlinkSync(outsideDir, path.join(repoRoot, "linked-dir"), "dir");
        expect(createGitCommit({ repoRoot, files: ["linked-dir/nested.ts"], message: "feat: parent symlink" })).toMatchObject({
          refused: true,
        });
      } catch {
        expect(realpathSync(repoRoot)).toBeTruthy();
      }

      expect(runGit(repoRoot, ["diff", "--cached", "--name-only"])).toBe("");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("bounds conflict analysis to unmerged files", () => {
    const repoRoot = createRepo();
    try {
      writeFileSync(
        path.join(repoRoot, "conflicted.ts"),
        ["<<<<<<< HEAD", "export const value = 1;", "=======", "export const value = 2;", ">>>>>>> branch", ""].join(
          "\n",
        ),
      );
      const conflicts = analyzeGitConflicts({
        repoRoot,
        unmergedFilesForTest: ["conflicted.ts"],
        maxFileBytes: 256,
        maxTotalBytes: 256,
      });

      expect(conflicts.conflictFiles.map((file) => file.path)).toEqual(["conflicted.ts"]);
      expect(conflicts.markerFiles.map((file) => file.path)).toEqual(["conflicted.ts"]);
      expect(conflicts.markerFiles[0]?.markerCount).toBe(3);
      expect(conflicts.scannedFiles).toBe(1);
      expect(conflicts.bytesScanned).toBeLessThanOrEqual(256);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
