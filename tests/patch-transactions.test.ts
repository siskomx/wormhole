import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPatchTransactionStore } from "../src/patch-transactions.js";

function tempRepo() {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-patch-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const name = 'old';\n", "utf8");
  return repoRoot;
}

const diff = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1 +1 @@",
  "-export const name = 'old';",
  "+export const name = 'new';",
  "",
].join("\n");

describe("patch transaction store", () => {
  it("creates a checkpoint and applies a unified diff with rollback metadata", () => {
    const repoRoot = tempRepo();
    try {
      const store = createPatchTransactionStore();
      const checkpoint = store.checkpoint({
        repoRoot,
        label: "before rename",
        files: ["src/app.ts"],
      });
      const applied = store.apply({
        repoRoot,
        checkpointId: checkpoint.checkpointId,
        unifiedDiff: diff,
        verificationCommands: [
          { name: "typecheck", command: "npm", args: ["run", "typecheck"] },
        ],
      });

      expect(readFileSync(path.join(repoRoot, "src", "app.ts"), "utf8")).toContain("'new'");
      expect(applied.status).toBe("applied");
      expect(applied.rollbackAvailable).toBe(true);
      expect(applied.filesChanged).toEqual(["src/app.ts"]);
      expect(applied.verification.commands[0]).toMatchObject({
        name: "typecheck",
        command: "npm",
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rolls an applied transaction back to checkpoint content", () => {
    const repoRoot = tempRepo();
    try {
      const store = createPatchTransactionStore();
      const checkpoint = store.checkpoint({ repoRoot, files: ["src/app.ts"] });
      const applied = store.apply({
        repoRoot,
        checkpointId: checkpoint.checkpointId,
        unifiedDiff: diff,
      });

      const rolledBack = store.rollback({ repoRoot, transactionId: applied.transactionId });

      expect(rolledBack.status).toBe("rolled_back");
      expect(readFileSync(path.join(repoRoot, "src", "app.ts"), "utf8")).toContain("'old'");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not leave partial writes when a later file hunk fails", () => {
    const repoRoot = tempRepo();
    const secondFile = path.join(repoRoot, "src", "other.ts");
    writeFileSync(secondFile, "export const other = 'old';\n", "utf8");

    try {
      const store = createPatchTransactionStore();
      const checkpoint = store.checkpoint({ repoRoot, files: ["src/app.ts", "src/other.ts"] });
      const failingDiff = [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1 +1 @@",
        "-export const name = 'old';",
        "+export const name = 'new';",
        "diff --git a/src/other.ts b/src/other.ts",
        "index 3333333..4444444 100644",
        "--- a/src/other.ts",
        "+++ b/src/other.ts",
        "@@ -1 +1 @@",
        "-export const other = 'missing';",
        "+export const other = 'new';",
        "",
      ].join("\n");

      expect(() =>
        store.apply({
          repoRoot,
          checkpointId: checkpoint.checkpointId,
          unifiedDiff: failingDiff,
        }),
      ).toThrow(/did not match/);
      expect(readFileSync(path.join(repoRoot, "src", "app.ts"), "utf8")).toBe(
        "export const name = 'old';\n",
      );
      expect(readFileSync(secondFile, "utf8")).toBe("export const other = 'old';\n");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects diffs that target paths outside the repo root", () => {
    const repoRoot = tempRepo();
    try {
      const store = createPatchTransactionStore();
      const checkpoint = store.checkpoint({ repoRoot, files: ["src/app.ts"] });
      const unsafeDiff = [
        "diff --git a/src/app.ts b/../escape.txt",
        "--- a/src/app.ts",
        "+++ b/../escape.txt",
        "@@ -1 +1 @@",
        "-export const name = 'old';",
        "+escape",
        "",
      ].join("\n");

      expect(() =>
        store.apply({
          repoRoot,
          checkpointId: checkpoint.checkpointId,
          unifiedDiff: unsafeDiff,
        }),
      ).toThrow(/outside repo root/i);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
