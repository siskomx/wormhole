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

  it("restores totals from a snapshot and emits changes", () => {
    const changes: unknown[] = [];
    const first = createOptimizationStats(undefined, (snapshot) => changes.push(snapshot));

    first.record({
      kind: "command_output_compaction",
      originalCharCount: 80,
      optimizedCharCount: 20,
    });

    const second = createOptimizationStats(first.snapshot());
    second.record({
      kind: "dense_summary",
      originalCharCount: 40,
      optimizedCharCount: 10,
    });

    expect(changes).toHaveLength(1);
    expect(second.snapshot()).toMatchObject({
      runCount: 2,
      originalCharCount: 120,
      optimizedCharCount: 30,
      byKind: {
        command_output_compaction: { runCount: 1 },
        dense_summary: { runCount: 1 },
      },
    });
  });
});
