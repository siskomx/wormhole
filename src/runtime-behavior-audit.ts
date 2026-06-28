export type RuntimeBehaviorPhase =
  | "orient"
  | "plan"
  | "impact"
  | "context"
  | "act"
  | "verify"
  | "gate"
  | "maintain"
  | "unknown";

export type RuntimeBehaviorStatus = "ok" | "warning" | "blocker";
export type RuntimeObservedToolStatus = "ran" | "skipped" | "failed";
export type RuntimeBehaviorScope = "wormhole" | "all";

export type RuntimeRecommendedTool = {
  toolName: string;
  recommendationId?: string;
  phase?: RuntimeBehaviorPhase | string;
  priority?: number;
  required?: boolean;
  minCalls?: number;
  after?: string[];
  reason?: string;
};

export type RuntimeObservedToolCall = {
  toolName: string;
  recommendationId?: string;
  calledAt?: string;
  status?: RuntimeObservedToolStatus;
  reason?: string;
};

export type RuntimeOrderingViolation = {
  toolName: string;
  recommendationId?: string;
  after: string[];
  missingPredecessors: string[];
  observedIndex: number;
  reason: string;
};

export type RuntimeBehaviorAuditInput = {
  recommendedTools: RuntimeRecommendedTool[];
  observedToolCalls: RuntimeObservedToolCall[];
  requiredTools?: string[];
  knownToolNames?: string[];
  ignoredToolNames?: string[];
  scope?: RuntimeBehaviorScope;
};

export type RuntimeBehaviorAudit = {
  summary: {
    recommendedToolCount: number;
    observedToolCount: number;
    coveredToolCount: number;
    missingToolCount: number;
    unexpectedToolCount: number;
    failedToolCount: number;
    skippedToolCount: number;
    uncoveredRequiredToolCount: number;
    orderingViolationCount: number;
    coverageRatio: number;
    status: RuntimeBehaviorStatus;
  };
  coveredTools: RuntimeRecommendedTool[];
  missingTools: RuntimeRecommendedTool[];
  unexpectedTools: RuntimeObservedToolCall[];
  failedTools: RuntimeObservedToolCall[];
  skippedTools: RuntimeObservedToolCall[];
  uncoveredRequiredTools: RuntimeRecommendedTool[];
  orderingViolations: RuntimeOrderingViolation[];
  blockingReasons: string[];
  nextActions: string[];
};

type NormalizedRecommendedTool = RuntimeRecommendedTool & {
  toolName: string;
  minCalls: number;
  order: number;
};

type NormalizedObservedToolCall = RuntimeObservedToolCall & {
  toolName: string;
  status: RuntimeObservedToolStatus;
  order: number;
};

export function auditRuntimeBehavior(input: RuntimeBehaviorAuditInput): RuntimeBehaviorAudit {
  const recommendedTools = normalizeRecommendedTools(input.recommendedTools);
  const observedToolCalls = normalizeObservedToolCalls(input.observedToolCalls);
  const recommendedNames = new Set(recommendedTools.map((tool) => tool.toolName));
  const requiredNames = orderedUnique([
    ...(input.requiredTools ?? []).map((toolName) => normalizeName(toolName)),
    ...recommendedTools.filter((tool) => tool.required === true).map((tool) => tool.toolName),
  ]);
  const requiredNameSet = new Set(requiredNames);
  const knownNameSet = new Set((input.knownToolNames ?? []).map((toolName) => normalizeName(toolName)).filter(Boolean));
  const ignoredNameSet = new Set((input.ignoredToolNames ?? []).map((toolName) => normalizeName(toolName)).filter(Boolean));
  const scope = input.scope ?? "wormhole";

  const { coveredTools, missingTools } = classifyCoverage(recommendedTools, observedToolCalls);
  const failedTools = relevantObservedTools(
    observedToolCalls.filter((tool) => tool.status === "failed"),
    { recommendedNames, requiredNameSet, knownNameSet, ignoredNameSet, scope },
  );
  const skippedTools = relevantObservedTools(
    observedToolCalls.filter((tool) => tool.status === "skipped"),
    { recommendedNames, requiredNameSet, knownNameSet, ignoredNameSet, scope },
  );
  const unexpectedTools = findUnexpectedTools(observedToolCalls, {
    recommendedNames,
    requiredNameSet,
    knownNameSet,
    ignoredNameSet,
    scope,
  });
  const orderingViolations = findOrderingViolations(recommendedTools, observedToolCalls);
  const { uncoveredRequiredTools, blockingReasons } = findRequiredGaps({
    requiredNames,
    recommendedTools,
    missingTools,
    observedToolCalls,
    failedTools,
    skippedTools,
    orderingViolations,
  });
  const nextActions = createNextActions({
    missingTools,
    uncoveredRequiredTools,
    unexpectedTools,
    orderingViolations,
  });
  const coverageRatio =
    recommendedTools.length === 0 ? 1 : coveredTools.length / recommendedTools.length;
  const status = blockingReasons.length > 0
    ? "blocker"
    : missingTools.length > 0 ||
        unexpectedTools.length > 0 ||
        failedTools.length > 0 ||
        skippedTools.length > 0 ||
        orderingViolations.length > 0
      ? "warning"
      : "ok";

  return {
    summary: {
      recommendedToolCount: recommendedTools.length,
      observedToolCount: observedToolCalls.length,
      coveredToolCount: coveredTools.length,
      missingToolCount: missingTools.length,
      unexpectedToolCount: unexpectedTools.length,
      failedToolCount: failedTools.length,
      skippedToolCount: skippedTools.length,
      uncoveredRequiredToolCount: uncoveredRequiredTools.length,
      orderingViolationCount: orderingViolations.length,
      coverageRatio,
      status,
    },
    coveredTools,
    missingTools,
    unexpectedTools,
    failedTools,
    skippedTools,
    uncoveredRequiredTools,
    orderingViolations,
    blockingReasons,
    nextActions,
  };
}

function classifyCoverage(
  recommendedTools: NormalizedRecommendedTool[],
  observedToolCalls: NormalizedObservedToolCall[],
): {
  coveredTools: RuntimeRecommendedTool[];
  missingTools: RuntimeRecommendedTool[];
} {
  const consumedObservationIndexes = new Set<number>();
  const coveredTools: RuntimeRecommendedTool[] = [];
  const missingTools: RuntimeRecommendedTool[] = [];

  for (const recommendation of recommendedTools) {
    const candidates = observedToolCalls.filter((observation) => {
      if (observation.status !== "ran" || consumedObservationIndexes.has(observation.order)) {
        return false;
      }
      if (observation.toolName !== recommendation.toolName) {
        return false;
      }
      return recommendation.recommendationId
        ? observation.recommendationId === recommendation.recommendationId
        : true;
    });

    if (candidates.length >= recommendation.minCalls) {
      for (const observation of candidates.slice(0, recommendation.minCalls)) {
        consumedObservationIndexes.add(observation.order);
      }
      coveredTools.push(toRecommendedOutput(recommendation));
    } else {
      missingTools.push(toRecommendedOutput(recommendation));
    }
  }

  return { coveredTools, missingTools };
}

function findUnexpectedTools(
  observedToolCalls: NormalizedObservedToolCall[],
  input: {
    recommendedNames: Set<string>;
    requiredNameSet: Set<string>;
    knownNameSet: Set<string>;
    ignoredNameSet: Set<string>;
    scope: RuntimeBehaviorScope;
  },
): RuntimeObservedToolCall[] {
  const unexpectedTools: RuntimeObservedToolCall[] = [];
  const seen = new Set<string>();
  for (const observation of observedToolCalls) {
    if (
      input.recommendedNames.has(observation.toolName) ||
      input.requiredNameSet.has(observation.toolName) ||
      input.ignoredNameSet.has(observation.toolName) ||
      seen.has(observation.toolName)
    ) {
      continue;
    }
    if (isObservedToolInScope(observation.toolName, input)) {
      unexpectedTools.push(toObservedOutput(observation));
      seen.add(observation.toolName);
    }
  }
  return unexpectedTools;
}

function relevantObservedTools(
  observedToolCalls: NormalizedObservedToolCall[],
  input: {
    recommendedNames: Set<string>;
    requiredNameSet: Set<string>;
    knownNameSet: Set<string>;
    ignoredNameSet: Set<string>;
    scope: RuntimeBehaviorScope;
  },
): RuntimeObservedToolCall[] {
  return observedToolCalls
    .filter((observation) => !input.ignoredNameSet.has(observation.toolName))
    .filter(
      (observation) =>
        input.recommendedNames.has(observation.toolName) ||
        input.requiredNameSet.has(observation.toolName) ||
        isObservedToolInScope(observation.toolName, input),
    )
    .map((observation) => toObservedOutput(observation));
}

function isObservedToolInScope(
  toolName: string,
  input: {
    knownNameSet: Set<string>;
    scope: RuntimeBehaviorScope;
  },
): boolean {
  if (input.scope === "all") {
    return true;
  }
  return input.knownNameSet.has(toolName);
}

function findOrderingViolations(
  recommendedTools: NormalizedRecommendedTool[],
  observedToolCalls: NormalizedObservedToolCall[],
): RuntimeOrderingViolation[] {
  const firstRanIndexByToolName = new Map<string, number>();
  const firstRanIndexByRecommendation = new Map<string, number>();
  for (const observation of observedToolCalls) {
    if (observation.status !== "ran") {
      continue;
    }
    if (!firstRanIndexByToolName.has(observation.toolName)) {
      firstRanIndexByToolName.set(observation.toolName, observation.order);
    }
    if (observation.recommendationId) {
      const key = recommendationKey(observation.toolName, observation.recommendationId);
      if (!firstRanIndexByRecommendation.has(key)) {
        firstRanIndexByRecommendation.set(key, observation.order);
      }
    }
  }

  const violations: RuntimeOrderingViolation[] = [];
  for (const recommendation of recommendedTools) {
    const after = orderedUnique((recommendation.after ?? []).map((toolName) => normalizeName(toolName)));
    if (after.length === 0) {
      continue;
    }
    const observedIndex = recommendation.recommendationId
      ? firstRanIndexByRecommendation.get(recommendationKey(recommendation.toolName, recommendation.recommendationId))
      : firstRanIndexByToolName.get(recommendation.toolName);
    if (observedIndex === undefined) {
      continue;
    }
    const missingPredecessors = after.filter((toolName) => {
      const predecessorIndex = firstRanIndexByToolName.get(toolName);
      return predecessorIndex === undefined || predecessorIndex > observedIndex;
    });
    if (missingPredecessors.length > 0) {
      violations.push({
        toolName: recommendation.toolName,
        ...(recommendation.recommendationId ? { recommendationId: recommendation.recommendationId } : {}),
        after,
        missingPredecessors,
        observedIndex,
        reason: `${recommendation.toolName} ran before ${missingPredecessors.join(", ")}.`,
      });
    }
  }
  return violations;
}

function findRequiredGaps(input: {
  requiredNames: string[];
  recommendedTools: NormalizedRecommendedTool[];
  missingTools: RuntimeRecommendedTool[];
  observedToolCalls: NormalizedObservedToolCall[];
  failedTools: RuntimeObservedToolCall[];
  skippedTools: RuntimeObservedToolCall[];
  orderingViolations: RuntimeOrderingViolation[];
}): {
  uncoveredRequiredTools: RuntimeRecommendedTool[];
  blockingReasons: string[];
} {
  const recommendedByName = new Map(input.recommendedTools.map((tool) => [tool.toolName, tool]));
  const missingRequiredNames = new Set(
    input.missingTools
      .filter((tool) => tool.required === true || input.requiredNames.includes(tool.toolName))
      .map((tool) => tool.toolName),
  );
  const failedNames = new Set(input.failedTools.map((tool) => tool.toolName));
  const skippedNames = new Set(input.skippedTools.map((tool) => tool.toolName));
  const ranNames = new Set(
    input.observedToolCalls.filter((tool) => tool.status === "ran").map((tool) => tool.toolName),
  );
  const orderedViolationNames = new Set(input.orderingViolations.map((violation) => violation.toolName));
  const uncoveredRequiredTools: RuntimeRecommendedTool[] = [];
  const blockingReasons: string[] = [];

  for (const toolName of input.requiredNames) {
    const isMissingRecommendedCall = missingRequiredNames.has(toolName);
    const isOutOfOrder = orderedViolationNames.has(toolName);
    const isMissingRun = !ranNames.has(toolName);
    if (!isMissingRun && !isMissingRecommendedCall && !isOutOfOrder) {
      continue;
    }

    uncoveredRequiredTools.push(toRequiredOutput(recommendedByName.get(toolName), toolName));
    if (isMissingRun && failedNames.has(toolName)) {
      blockingReasons.push(`Required tool failed: ${toolName}.`);
    } else if (isMissingRun && skippedNames.has(toolName)) {
      blockingReasons.push(`Required tool was skipped: ${toolName}.`);
    } else if (isMissingRun) {
      blockingReasons.push(`Required tool was not observed: ${toolName}.`);
    } else if (isMissingRecommendedCall) {
      blockingReasons.push(`Required tool did not meet minimum call count: ${toolName}.`);
    }

    for (const violation of input.orderingViolations.filter((candidate) => candidate.toolName === toolName)) {
      for (const predecessor of violation.missingPredecessors) {
        blockingReasons.push(`Required tool ran before required predecessor: ${toolName} before ${predecessor}.`);
      }
    }
  }

  return {
    uncoveredRequiredTools,
    blockingReasons: orderedUnique(blockingReasons),
  };
}

function createNextActions(input: {
  missingTools: RuntimeRecommendedTool[];
  uncoveredRequiredTools: RuntimeRecommendedTool[];
  unexpectedTools: RuntimeObservedToolCall[];
  orderingViolations: RuntimeOrderingViolation[];
}): string[] {
  const requiredNames = new Set(input.uncoveredRequiredTools.map((tool) => tool.toolName));
  return orderedUnique([
    ...input.uncoveredRequiredTools.map((tool) => `Run required tool before final claims: ${tool.toolName}.`),
    ...input.missingTools
      .filter((tool) => !requiredNames.has(tool.toolName))
      .map((tool) => `Run or justify missing recommended tool: ${tool.toolName}.`),
    ...input.orderingViolations.map(
      (violation) => `Run ${violation.toolName} after ${violation.missingPredecessors.join(", ")}.`,
    ),
    ...input.unexpectedTools.map((tool) => `Review unexpected Wormhole tool call for relevance: ${tool.toolName}.`),
  ]);
}

function normalizeRecommendedTools(recommendedTools: RuntimeRecommendedTool[]): NormalizedRecommendedTool[] {
  return recommendedTools
    .map((tool, order) => ({
      ...tool,
      toolName: normalizeName(tool.toolName),
      minCalls: normalizeMinCalls(tool.minCalls),
      order,
      ...(tool.recommendationId ? { recommendationId: tool.recommendationId.trim() } : {}),
      ...(tool.after ? { after: orderedUnique(tool.after.map((toolName) => normalizeName(toolName))) } : {}),
    }))
    .filter((tool) => tool.toolName.length > 0);
}

function normalizeObservedToolCalls(observedToolCalls: RuntimeObservedToolCall[]): NormalizedObservedToolCall[] {
  return observedToolCalls
    .map((tool, order) => ({
      ...tool,
      toolName: normalizeName(tool.toolName),
      status: tool.status ?? "ran",
      order,
      ...(tool.recommendationId ? { recommendationId: tool.recommendationId.trim() } : {}),
    }))
    .filter((tool) => tool.toolName.length > 0);
}

function normalizeName(toolName: string): string {
  return toolName.trim();
}

function normalizeMinCalls(minCalls: number | undefined): number {
  if (!Number.isFinite(minCalls) || minCalls === undefined) {
    return 1;
  }
  return Math.max(1, Math.floor(minCalls));
}

function orderedUnique(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function recommendationKey(toolName: string, recommendationId: string): string {
  return `${toolName}\u0000${recommendationId}`;
}

function toRecommendedOutput(tool: NormalizedRecommendedTool): RuntimeRecommendedTool {
  return {
    toolName: tool.toolName,
    ...(tool.recommendationId ? { recommendationId: tool.recommendationId } : {}),
    ...(tool.phase ? { phase: tool.phase } : {}),
    ...(tool.priority !== undefined ? { priority: tool.priority } : {}),
    ...(tool.required !== undefined ? { required: tool.required } : {}),
    ...(tool.minCalls !== 1 ? { minCalls: tool.minCalls } : {}),
    ...(tool.after && tool.after.length > 0 ? { after: tool.after } : {}),
    ...(tool.reason ? { reason: tool.reason } : {}),
  };
}

function toRequiredOutput(tool: NormalizedRecommendedTool | undefined, toolName: string): RuntimeRecommendedTool {
  if (!tool) {
    return { toolName, required: true };
  }
  return {
    ...toRecommendedOutput(tool),
    required: true,
  };
}

function toObservedOutput(tool: NormalizedObservedToolCall): RuntimeObservedToolCall {
  return {
    toolName: tool.toolName,
    ...(tool.recommendationId ? { recommendationId: tool.recommendationId } : {}),
    ...(tool.calledAt ? { calledAt: tool.calledAt } : {}),
    ...(tool.status !== "ran" ? { status: tool.status } : {}),
    ...(tool.reason ? { reason: tool.reason } : {}),
  };
}
