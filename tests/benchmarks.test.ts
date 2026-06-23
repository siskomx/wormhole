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
});
