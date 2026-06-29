import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDocsSync } from "../src/docs-sync.js";
import { detectProjectContract } from "../src/project-contract.js";
import { buildRepoIndex } from "../src/repo-index.js";

describe("docs sync", () => {
  it("reports stale docs conflicts from source conflict analysis", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-docs-stale-"));
    try {
      writeFileSync(path.join(repoRoot, "README.md"), "[Missing](docs/missing.md)\n");
      const index = buildRepoIndex({ repoRoot });
      const result = checkDocsSync({ repoRoot, index });

      expect(result.decision).toBe("warn");
      expect(result.findings).toContainEqual(
        expect.objectContaining({ kind: "source_conflict", path: "README.md" }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails public surface changes without docs when required", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-docs-required-"));
    try {
      mkdirSync(path.join(repoRoot, "src", "routes"), { recursive: true });
      writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
      writeFileSync(path.join(repoRoot, "README.md"), "# API\n");
      writeFileSync(path.join(repoRoot, "src", "routes", "users.ts"), "export const usersRoute = true;\n");
      const index = buildRepoIndex({ repoRoot });
      const contract = detectProjectContract({ repoRoot });

      const result = checkDocsSync({
        repoRoot,
        index,
        contract,
        changedFiles: ["src/routes/users.ts"],
        requireDocsForPublicChanges: true,
      });

      expect(result.decision).toBe("fail");
      expect(result.findings).toContainEqual(
        expect.objectContaining({ kind: "missing_docs_update", path: "src/routes/users.ts" }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("passes public surface changes when docs changed in the same scope", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-docs-pass-"));
    try {
      mkdirSync(path.join(repoRoot, "src"), { recursive: true });
      writeFileSync(path.join(repoRoot, "README.md"), "# API\n");
      writeFileSync(path.join(repoRoot, "src", "index.ts"), "export const api = true;\n");
      const index = buildRepoIndex({ repoRoot });

      const result = checkDocsSync({
        repoRoot,
        index,
        changedFiles: ["src/index.ts", "README.md"],
        requireDocsForPublicChanges: true,
      });

      expect(result.decision).toBe("pass");
      expect(result.findings).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
