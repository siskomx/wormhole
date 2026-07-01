import { describe, expect, it } from "vitest";
import { classifyDogfoodResult } from "../scripts/dogfood-result.js";

describe("dogfood result classification", () => {
  it("treats returned failed tool records as failed dogfood results", () => {
    const result = classifyDogfoodResult({
      status: "failed",
      result: {
        status: "failed",
        summary: "CLI agent timed out after 25ms",
        output: {
          transport: "cli",
          durationMs: 180,
          stderrHash: "sha256:timeout",
        },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("CLI agent timed out after 25ms");
    expect(result.detail).toEqual(
      expect.objectContaining({
        status: "failed",
        resultStatus: "failed",
        summary: "CLI agent timed out after 25ms",
        transport: "cli",
        durationMs: 180,
      }),
    );
  });

  it("preserves explicit guarded dispositions", () => {
    expect(classifyDogfoodResult({ status: "guarded", detail: "requires live network" })).toEqual({
      status: "guarded",
      detail: "requires live network",
    });
  });

  it("summarizes failed domain tools with first command evidence", () => {
    const result = classifyDogfoodResult({
      status: "failed",
      results: [
        {
          name: "node-smoke",
          status: "failed",
          exitCode: null,
          durationMs: 4900,
          stderrHash: "sha256:stderr",
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("first result was failed");
    expect(result.detail).toEqual(
      expect.objectContaining({
        resultCount: 1,
        firstResultName: "node-smoke",
        firstResultStatus: "failed",
        firstResultExitCode: null,
        firstResultDurationMs: 4900,
        firstResultStderrHash: "sha256:stderr",
      }),
    );
  });
});
