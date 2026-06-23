import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashFixtureDirectory, loadBenchmarkSuite } from "../src/benchmarks.js";

describe("benchmark suite scaffolding", () => {
  it("loads five frozen planning fixtures and the shared rubric", () => {
    const suite = loadBenchmarkSuite();

    expect(suite.fixtures).toHaveLength(5);
    expect(new Set(suite.fixtures.map((fixture) => fixture.category)).size).toBe(5);
    expect(suite.rubric.dimensions.map((dimension) => dimension.id)).toEqual([
      "evidence_coverage",
      "correctness",
      "assumption_handling",
      "risk_awareness",
      "implementation_specificity",
    ]);

    for (const fixture of suite.fixtures) {
      expect(fixture.taskPrompt.length).toBeGreaterThan(20);
      expect(fixture.allowedPaths.length).toBeGreaterThan(0);
      expect(fixture.expectedPlanningConcerns.length).toBeGreaterThan(0);
      expect(hashFixtureDirectory(fixture.absoluteRepoPath)).toBe(fixture.fixtureHash);
    }
  });

  it("hashes text fixtures the same way after a CRLF checkout", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wormhole-benchmark-hash-"));
    const lfRoot = path.join(tempDir, "lf");
    const crlfRoot = path.join(tempDir, "crlf");
    mkdirSync(lfRoot);
    mkdirSync(crlfRoot);

    try {
      writeFileSync(path.join(lfRoot, "fixture.ts"), "const value = 1;\n", "utf8");
      writeFileSync(path.join(crlfRoot, "fixture.ts"), "const value = 1;\r\n", "utf8");

      expect(hashFixtureDirectory(crlfRoot)).toBe(hashFixtureDirectory(lfRoot));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
