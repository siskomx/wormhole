export type LargeRepoEvalMetric =
  | "relation_query_precision"
  | "impact_recall"
  | "test_selection_recall"
  | "search_mrr"
  | "workflow_completeness";

export type LargeRepoEvalResult = {
  fixtureId: string;
  metrics: Partial<Record<LargeRepoEvalMetric, number>>;
  passed: boolean;
  warnings: string[];
};

export function scoreLargeRepoIntelligence(input: {
  fixtureId: string;
  expectedFiles?: string[];
  expectedTests?: string[];
  expectedRelations?: string[];
  expectedWorkflowTools?: string[];
  relationResults?: string[];
  impactResults?: string[];
  searchResults?: string[];
  plannedTools?: string[];
}): LargeRepoEvalResult {
  const metrics: Partial<Record<LargeRepoEvalMetric, number>> = {};
  const warnings: string[] = [];

  if (input.expectedRelations && input.expectedRelations.length > 0) {
    metrics.relation_query_precision = precision(input.relationResults ?? [], input.expectedRelations);
  } else {
    warnings.push("expectedRelations missing; relation_query_precision not scored.");
  }

  if (input.expectedFiles && input.expectedFiles.length > 0) {
    metrics.impact_recall = recall(input.impactResults ?? [], input.expectedFiles);
    metrics.search_mrr = meanReciprocalRank(input.searchResults ?? [], input.expectedFiles);
  } else {
    warnings.push("expectedFiles missing; impact_recall and search_mrr not fully scored.");
  }

  if (input.expectedTests && input.expectedTests.length > 0) {
    metrics.test_selection_recall = recall(input.impactResults ?? [], input.expectedTests);
  } else {
    warnings.push("expectedTests missing; test_selection_recall not scored.");
  }

  if (input.expectedWorkflowTools && input.expectedWorkflowTools.length > 0) {
    metrics.workflow_completeness = recall(input.plannedTools ?? [], input.expectedWorkflowTools);
  } else {
    warnings.push("expectedWorkflowTools missing; workflow_completeness not scored.");
  }

  const scored = Object.values(metrics);
  return {
    fixtureId: input.fixtureId,
    metrics,
    passed: scored.length > 0 && scored.every((score) => score >= 0.8),
    warnings,
  };
}

function precision(actual: readonly string[], expected: readonly string[]): number {
  if (actual.length === 0) {
    return 0;
  }
  const expectedSet = new Set(expected);
  const hits = actual.filter((item) => expectedSet.has(item)).length;
  return round(hits / actual.length);
}

function recall(actual: readonly string[], expected: readonly string[]): number {
  if (expected.length === 0) {
    return 1;
  }
  const actualSet = new Set(actual);
  const hits = expected.filter((item) => actualSet.has(item)).length;
  return round(hits / expected.length);
}

function meanReciprocalRank(actual: readonly string[], expected: readonly string[]): number {
  if (expected.length === 0) {
    return 1;
  }
  let total = 0;
  for (const expectedItem of expected) {
    const rank = actual.findIndex((item) => item === expectedItem);
    total += rank === -1 ? 0 : 1 / (rank + 1);
  }
  return round(total / expected.length);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
