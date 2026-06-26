import { describe, expect, it } from "vitest";
import { createVerificationPlan, runVerificationPlan } from "../src/verification-runner.js";

describe("verification runner", () => {
  it("selects focused test commands from the project contract and impact analysis", () => {
    const plan = createVerificationPlan({
      contract: {
        repoRoot: "/repo",
        packageManager: "npm",
        scripts: [
          { name: "build", command: "tsc -p tsconfig.json" },
          { name: "test", command: "vitest run tests" },
        ],
      },
      impact: {
        changedFiles: ["src/user.ts"],
        impactedFiles: ["src/server.ts"],
        likelyTests: ["tests/user.test.ts"],
        riskLevel: "medium",
        reasons: ["Changed file has inbound dependents."],
      },
    });

    expect(plan.commands[0]).toEqual(
      expect.objectContaining({
        name: "test",
        command: "npm",
        args: ["test", "--", "tests/user.test.ts"],
        tier: "focused",
        lanes: ["runtime"],
      }),
    );
    expect(plan.commands.map((command) => command.name)).toContain("build");
    expect(plan.reasons).toContain("Focused tests were selected from impacted files.");
  });

  it("uses smoke tier for docs-only changes without scheduling the full suite", () => {
    const plan = createVerificationPlan({
      contract: {
        repoRoot: "/repo",
        packageManager: "npm",
        scripts: [
          { name: "build", command: "tsc -p tsconfig.json" },
          { name: "test", command: "vitest run tests" },
        ],
      },
      changedFiles: ["README.md", "docs/usage.md"],
      tier: "smoke",
    });

    expect(plan.commands).toEqual([]);
    expect(plan.reasons).toContain("Docs-only changes do not require automated test commands at smoke tier.");
  });

  it("adds benchmark validation in full tier when benchmark lanes change", () => {
    const plan = createVerificationPlan({
      contract: {
        repoRoot: "/repo",
        packageManager: "npm",
        scripts: [
          { name: "test", command: "vitest run tests" },
          { name: "benchmarks:validate", command: "tsx scripts/validate-benchmarks.ts" },
        ],
      },
      changedFiles: ["benchmarks/cases/sample.json"],
      tier: "full",
    });

    expect(plan.commands.map((command) => command.name)).toEqual(
      expect.arrayContaining(["test", "benchmarks:validate"]),
    );
    expect(plan.commands.find((command) => command.name === "benchmarks:validate")).toEqual(
      expect.objectContaining({
        tier: "full",
        lanes: ["benchmarks"],
      }),
    );
  });

  it("runs verification commands through the optimized command runner", async () => {
    const result = await runVerificationPlan({
      commands: [
        {
          name: "node-smoke",
          command: process.execPath,
          args: ["-e", "console.log('verified')"],
          timeoutMs: 2_000,
        },
      ],
    });

    expect(result.status).toBe("passed");
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        name: "node-smoke",
        status: "completed",
        exitCode: 0,
      }),
    );
    expect(result.results[0]?.stdout).toContain("verified");
    expect(result.results[0]?.stdoutHash).toMatch(/^sha256:/);
  });
});
