import { describe, expect, it } from "vitest";
import { classifyProjectLane, summarizeProjectLanes } from "../src/project-lanes.js";

describe("project lanes", () => {
  it.each([
    ["dist/server.js", "generated"],
    ["src/generated/client.ts", "generated"],
    ["benchmarks/fixtures/app.ts", "benchmarks"],
    ["fixtures/user.json", "fixtures"],
    ["tests/user.test.ts", "tests"],
    ["src/user.spec.ts", "tests"],
    ["docs/architecture.md", "docs"],
    ["README.md", "docs"],
    ["src/user.ts", "runtime"],
    ["package.json", "runtime"],
  ] as const)("classifies %s as %s", (repoPath, lane) => {
    expect(classifyProjectLane(repoPath)).toBe(lane);
  });

  it("summarizes lanes for changed paths", () => {
    expect(summarizeProjectLanes(["src/user.ts", "tests/user.test.ts", "README.md"])).toEqual({
      runtime: 1,
      tests: 1,
      fixtures: 0,
      benchmarks: 0,
      docs: 1,
      generated: 0,
    });
  });
});
