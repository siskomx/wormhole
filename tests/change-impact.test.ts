import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeChangeImpact } from "../src/change-impact.js";
import { buildRepoIndex } from "../src/repo-index.js";

describe("relation-aware change impact", () => {
  it("finds callers through import/call relations and relation-backed tests", () => {
    const repoRoot = createImpactFixture();

    try {
      const index = buildRepoIndex({ repoRoot });
      const result = analyzeChangeImpact({
        repoRoot,
        changedFiles: ["src/a.ts"],
        diffText: [
          "diff --git a/src/a.ts b/src/a.ts",
          "@@ -1,3 +1,3 @@",
          " export function loadA() {",
          "-  return 'a';",
          "+  return 'a2';",
          " }",
        ].join("\n"),
        index,
      });

      expect(result.changedSymbols.map((symbol) => symbol.name)).toContain("loadA");
      expect(result.impactedFiles).toContainEqual(
        expect.objectContaining({
          path: "src/b.ts",
          relationPath: expect.arrayContaining([expect.stringContaining("imports")]),
        }),
      );
      expect(result.impactedTests).toContainEqual(
        expect.objectContaining({
          path: "tests/a.test.ts",
          confidence: 0.95,
          relationPath: expect.arrayContaining([expect.stringContaining("imports")]),
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("ranks symbol-reference tests above basename-only tests", () => {
    const repoRoot = createImpactFixture();

    try {
      const index = buildRepoIndex({ repoRoot });
      const result = analyzeChangeImpact({
        repoRoot,
        changedFiles: ["src/a.ts"],
        index,
      });

      const symbolTest = result.impactedTests.find((test) => test.path === "tests/a.test.ts");
      const basenameTest = result.impactedTests.find((test) => test.path === "tests/a-basename.test.ts");
      expect(symbolTest?.confidence).toBeGreaterThan(basenameTest?.confidence ?? 0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns high risk and a clear warning when no likely tests exist", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-change-impact-no-tests-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "solo.ts"), "export function solo() { return true; }\n");

    try {
      const result = analyzeChangeImpact({
        repoRoot,
        changedFiles: ["src/solo.ts"],
      });

      expect(result.riskLevel).toBe("high");
      expect(result.impactedTests).toEqual([]);
      expect(result.warnings).toContain("No likely tests were found for changed files or symbols.");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses stale index state when freshness is required", () => {
    const repoRoot = createImpactFixture();

    try {
      const index = buildRepoIndex({ repoRoot });
      writeFileSync(path.join(repoRoot, "src", "a.ts"), "export function loadA() { return 'stale'; }\n");

      const result = analyzeChangeImpact({
        repoRoot,
        changedFiles: ["src/a.ts"],
        index,
        requireFresh: true,
      });

      expect(result.impactedFiles).toEqual([]);
      expect(result.impactedTests).toEqual([]);
      expect(result.warnings.join("\n")).toContain("refused stale repo index");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("bounds changed-symbol relation expansion for large changed files", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-change-impact-bounded-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "large.ts"),
      [
        "export function one() { return 1; }",
        "export function two() { return 2; }",
        "export function three() { return 3; }",
        "export function four() { return 4; }",
      ].join("\n"),
    );

    try {
      const index = buildRepoIndex({ repoRoot });
      const result = analyzeChangeImpact({
        repoRoot,
        changedFiles: ["src/large.ts"],
        index,
        maxChangedSymbols: 2,
      } as Parameters<typeof analyzeChangeImpact>[0] & { maxChangedSymbols: number });

      expect(result.changedSymbols.map((symbol) => symbol.name)).toEqual(["one", "two"]);
      expect(result.warnings.join("\n")).toContain("Changed symbol expansion capped at 2 of 4 symbols.");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

function createImpactFixture(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-change-impact-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "src", "a.ts"),
    ["export function loadA() {", "  return 'a';", "}", ""].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "b.ts"),
    ["import { loadA } from './a';", "export function loadB() {", "  return loadA();", "}", ""].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "tests", "a.test.ts"),
    "import { loadA } from '../src/a'; test('loadA', () => loadA());\n",
  );
  writeFileSync(
    path.join(repoRoot, "tests", "a-basename.test.ts"),
    "test('a module smoke', () => expect('a').toBeTruthy());\n",
  );
  return repoRoot;
}
