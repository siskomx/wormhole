import type { OptimizationKind } from "./optimization.js";

export type OptimizationStatsInput = {
  kind: OptimizationKind;
  originalCharCount: number;
  optimizedCharCount: number;
  estimatedTokensBefore?: number;
  estimatedTokensAfter?: number;
};

export type OptimizationStatsSnapshot = {
  runCount: number;
  originalCharCount: number;
  optimizedCharCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  estimatedTokensSaved: number;
  byKind: Record<string, { runCount: number; estimatedTokensSaved: number }>;
};

export type OptimizationStats = {
  record(input: OptimizationStatsInput): void;
  snapshot(): OptimizationStatsSnapshot;
};

export function createOptimizationStats(): OptimizationStats {
  const snapshot: OptimizationStatsSnapshot = {
    runCount: 0,
    originalCharCount: 0,
    optimizedCharCount: 0,
    estimatedTokensBefore: 0,
    estimatedTokensAfter: 0,
    estimatedTokensSaved: 0,
    byKind: {},
  };

  return {
    record(input) {
      const before = input.estimatedTokensBefore ?? Math.ceil(input.originalCharCount / 4);
      const after = input.estimatedTokensAfter ?? Math.ceil(input.optimizedCharCount / 4);
      const saved = Math.max(0, before - after);
      snapshot.runCount += 1;
      snapshot.originalCharCount += input.originalCharCount;
      snapshot.optimizedCharCount += input.optimizedCharCount;
      snapshot.estimatedTokensBefore += before;
      snapshot.estimatedTokensAfter += after;
      snapshot.estimatedTokensSaved += saved;
      const current = snapshot.byKind[input.kind] ?? { runCount: 0, estimatedTokensSaved: 0 };
      current.runCount += 1;
      current.estimatedTokensSaved += saved;
      snapshot.byKind[input.kind] = current;
    },
    snapshot() {
      return {
        ...snapshot,
        byKind: Object.fromEntries(
          Object.entries(snapshot.byKind).map(([kind, value]) => [kind, { ...value }]),
        ),
      };
    },
  };
}
