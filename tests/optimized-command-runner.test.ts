import { describe, expect, it } from "vitest";
import { createOptimizedCommandRunner } from "../src/optimized-command-runner.js";
import { createOptimizationStats } from "../src/optimization-stats.js";

describe("optimized command runner", () => {
  it("runs a command, compacts stdout, and records optimization metadata", async () => {
    const stats = createOptimizationStats();
    const runner = createOptimizedCommandRunner({ stats });

    const script = [
      "for (let i = 0; i < 120; i += 1) {",
      "  if (i === 60) console.log('ERROR middle diagnostic');",
      "  else console.log(`line ${i}`);",
      "}",
    ].join(" ");

    const result = await runner.run({
      command: process.execPath,
      args: ["-e", script],
      timeoutMs: 2_000,
    });

    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("line 0");
    expect(result.optimizedStdout).toContain("ERROR middle diagnostic");
    expect(result.optimization.retrievalId).toMatch(/^opt:sha256:/);
    expect(result.stdoutHash).toMatch(/^sha256:/);
    expect(result.stderrHash).toMatch(/^sha256:/);
    expect(stats.snapshot()).toMatchObject({
      runCount: 1,
      byKind: {
        command_output_compaction: {
          runCount: 1,
        },
      },
    });
    expect(stats.snapshot().estimatedTokensSaved).toBeGreaterThanOrEqual(0);
  });

  it("reports timed out runs", async () => {
    const runner = createOptimizedCommandRunner();

    const result = await runner.run({
      command: process.execPath,
      args: [
        "-e",
        "setTimeout(() => console.log('late output'), 200); setTimeout(() => {}, 500);",
      ],
      timeoutMs: 25,
    });

    expect(result.status).toBe("timed_out");
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("timed out");
    expect(result.optimization.retrievalId).toMatch(/^opt:sha256:/);
  });
});
