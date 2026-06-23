import { describe, expect, it } from "vitest";
import { loadBenchmarkSuite } from "../src/benchmarks.js";
import { runBenchmarkComparison } from "../src/benchmark-runner.js";

describe("benchmark comparison runner", () => {
  it("runs unaided and Wormhole planners and anonymizes review pairs", async () => {
    const suite = loadBenchmarkSuite();
    const result = await runBenchmarkComparison({
      fixtures: suite.fixtures.slice(0, 2),
      runUnaided: async (fixture) => ({
        fixtureId: fixture.id,
        plan: `Unaided plan for ${fixture.id}`,
      }),
      runWormhole: async (fixture) => ({
        fixtureId: fixture.id,
        plan: `Wormhole plan for ${fixture.id}`,
      }),
    });

    expect(result.runs).toHaveLength(4);
    expect(result.reviewPairs).toHaveLength(2);
    expect(result.reviewPairs[0].plans).toHaveLength(2);
    expect(result.reviewPairs[0].plans[0].label).toMatch(/^Plan [AB]$/);
    expect(JSON.stringify(result.reviewPairs)).not.toContain("Wormhole");
    expect(JSON.stringify(result.reviewPairs)).not.toContain("Unaided");
  });
});
