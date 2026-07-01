import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { walkRepoFiles } from "../src/repo-walker.js";

describe("repo walker", () => {
  it("records files skipped after the file limit is reached", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-walker-files-"));
    writeFileSync(path.join(repoRoot, "a.ts"), "export const a = true;\n");
    writeFileSync(path.join(repoRoot, "b.ts"), "export const b = true;\n");
    writeFileSync(path.join(repoRoot, "c.ts"), "export const c = true;\n");

    try {
      const result = walkRepoFiles(repoRoot, { maxFiles: 1 });

      expect(result.files.map((file) => file.relativePath)).toEqual(["a.ts"]);
      expect(result.hitLimit).toBe(true);
      expect(result.reasons).toEqual(["file_limit"]);
      expect(result.skipped).toEqual([
        { path: "b.ts", reason: "file_limit" },
        { path: "c.ts", reason: "file_limit" },
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("records current depth-limit behavior for deep directories and files", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-walker-depth-"));
    mkdirSync(path.join(repoRoot, "src", "deep"), { recursive: true });
    writeFileSync(path.join(repoRoot, "root.ts"), "export const root = true;\n");
    writeFileSync(path.join(repoRoot, "src", "visible.ts"), "export const visible = true;\n");
    writeFileSync(path.join(repoRoot, "src", "deep", "hidden.ts"), "export const hidden = true;\n");

    try {
      const result = walkRepoFiles(repoRoot, { maxDepth: 1 });

      expect(result.files.map((file) => file.relativePath)).toEqual(["root.ts"]);
      expect(result.hitLimit).toBe(true);
      expect(result.reasons).toEqual(["depth_limit"]);
      expect(result.skipped).toEqual([
        { path: "src/deep", reason: "depth_limit" },
        { path: "src/visible.ts", reason: "depth_limit" },
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
