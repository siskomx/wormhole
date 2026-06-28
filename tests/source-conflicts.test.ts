import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectProjectContract } from "../src/project-contract.js";
import { buildRepoIndex } from "../src/repo-index.js";
import { analyzeSourceConflicts } from "../src/source-conflicts.js";

function createConflictFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-source-conflicts-"));
  mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  mkdirSync(path.join(repoRoot, "migrations"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        scripts: {
          test: "vitest run tests",
        },
        dependencies: {
          react: "^19.2.0",
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(path.join(repoRoot, "src", "existing.ts"), "export const existing = true;\n");
  writeFileSync(path.join(repoRoot, "migrations", "001_users.sql"), "create table users(id text primary key);\n");
  writeFileSync(
    path.join(repoRoot, "docs", "architecture.md"),
    [
      "# Architecture",
      "",
      "See [existing](../src/existing.ts) and [missing](../src/missing.ts).",
      "Run `npm run test` and `npm run deploy` before release.",
      "Dependencies: react, lodash.",
      "Tables: users, missing_accounts.",
    ].join("\n"),
  );
  return repoRoot;
}

describe("source conflicts", () => {
  it("detects doc claims that conflict with current links, package facts, and table facts", () => {
    const repoRoot = createConflictFixtureRepo();
    try {
      const index = buildRepoIndex({ repoRoot });
      const contract = detectProjectContract({ repoRoot });

      const result = analyzeSourceConflicts({ repoRoot, index, contract });

      expect(result.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subject: "docs/architecture.md -> src/missing.ts",
            severity: "warning",
            resolution: "needs_validation",
          }),
          expect.objectContaining({
            subject: "script:deploy",
            severity: "warning",
            resolution: "trust_authoritative",
          }),
          expect.objectContaining({
            subject: "dependency:lodash",
            severity: "warning",
            resolution: "trust_authoritative",
          }),
          expect.objectContaining({
            subject: "table:missing_accounts",
            severity: "warning",
            resolution: "trust_authoritative",
          }),
        ]),
      );
      expect(result.conflicts.map((conflict) => conflict.subject)).not.toEqual(
        expect.arrayContaining([
          "docs/architecture.md -> src/existing.ts",
          "script:test",
          "dependency:react",
          "table:users",
        ]),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("detects generated wormhole artifacts with stale index fingerprints", () => {
    const repoRoot = createConflictFixtureRepo();
    try {
      mkdirSync(path.join(repoRoot, ".wormhole", "workflows"), { recursive: true });
      const index = buildRepoIndex({ repoRoot });
      writeFileSync(
        path.join(repoRoot, ".wormhole", "workflows", "stale.json"),
        `${JSON.stringify({ indexFingerprint: "old-fingerprint" }, null, 2)}\n`,
      );

      const result = analyzeSourceConflicts({
        repoRoot,
        index,
        contract: detectProjectContract({ repoRoot }),
      });

      expect(result.conflicts).toContainEqual(
        expect.objectContaining({
          subject: ".wormhole/workflows/stale.json#indexFingerprint",
          severity: "warning",
          resolution: "needs_validation",
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
