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
      }),
    );
    expect(plan.commands.map((command) => command.name)).toContain("build");
    expect(plan.reasons).toContain("Focused tests were selected from impacted files.");
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
