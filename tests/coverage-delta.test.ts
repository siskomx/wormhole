import { describe, expect, it } from "vitest";
import { analyzeCoverageDelta } from "../src/coverage-delta.js";

describe("coverage delta", () => {
  it("fails when coverage drops beyond threshold", () => {
    const result = analyzeCoverageDelta({
      before: "Lines: 90%\nBranches: 80%\nFunctions: 75%\nStatements: 88%",
      after: "Lines: 88%\nBranches: 80%\nFunctions: 75%\nStatements: 88%",
      failBelowDelta: -0.5,
    });

    expect(result.decision).toBe("fail");
    expect(result.metrics.lines?.delta).toBe(-2);
  });

  it("passes when coverage does not drop", () => {
    const result = analyzeCoverageDelta({
      before: { lines: 90, branches: 80 },
      after: { lines: 91, branches: 80 },
    });

    expect(result.decision).toBe("pass");
  });

  it("warns when coverage cannot be parsed", () => {
    const result = analyzeCoverageDelta({
      before: "no coverage here",
      after: "still none",
    });

    expect(result.decision).toBe("warn");
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "coverage_parse_failed" }));
  });
});
