import { describe, expect, it } from "vitest";
import { createOptimizationStats } from "../src/optimization-stats.js";

describe("optimization stats", () => {
  it("tracks command output compaction totals and per-kind savings", () => {
    const stats = createOptimizationStats();

    stats.record({
      kind: "command_output_compaction",
      originalCharCount: 1000,
      optimizedCharCount: 250,
      estimatedTokensBefore: 250,
      estimatedTokensAfter: 63,
    });

    expect(stats.snapshot()).toEqual({
      runCount: 1,
      originalCharCount: 1000,
      optimizedCharCount: 250,
      estimatedTokensBefore: 250,
      estimatedTokensAfter: 63,
      estimatedTokensSaved: 187,
      byKind: {
        command_output_compaction: {
          runCount: 1,
          estimatedTokensSaved: 187,
        },
      },
    });
  });
});
