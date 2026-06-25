import { createHash } from "node:crypto";

export type PolicyOutcome = {
  testsPassed: boolean;
  evidenceCount: number;
  openQuestions: number;
  durationMs: number;
  tokenEstimate: number;
  userCorrectionCount: number;
  reasoningScore?: number;
};

export type PolicyAction = {
  workerCount: number;
  verifierCount: number;
  maxDepth: number;
  modelProfile: string;
  splitStrategy?: "single" | "parallel" | "sequential";
  contextBudget?: "small" | "medium" | "large";
  evidenceMode?: "minimal" | "standard" | "strict";
  stopRule?: "continue" | "verify" | "escalate";
};

export type OrchestrationTrace = {
  traceId: string;
  taskKind: string;
  graphNodeCount: number;
  evidenceCount: number;
  openQuestions: number;
  action: PolicyAction;
  outcome: PolicyOutcome;
};

export type PolicyEvaluation = {
  evaluationId: string;
  policyId: string;
  replayPassRate: number;
  averageReward: number;
  sampleCount: number;
  safetyViolations: string[];
  recommendedAction?: PolicyAction;
};

export type PolicyActivationInput = {
  evaluationId: string;
};

export type ActivePolicy = {
  policyId: string;
  evaluationId: string;
  replayPassRate: number;
  averageReward: number;
  sampleCount: number;
  recommendedAction?: PolicyAction;
};

export type PolicyBaselineComparison = {
  candidate: PolicyEvaluation;
  baselines: PolicyEvaluation[];
  best: PolicyEvaluation;
};

export type PolicyLiveFeedbackReport = {
  trace: OrchestrationTrace;
  reward: number;
  advisory: {
    activationChanged: false;
    recommendedAction: PolicyAction;
    reasons: string[];
  };
};

export type PolicyStoreSnapshot = {
  traces: OrchestrationTrace[];
  evaluations: PolicyEvaluation[];
  active?: ActivePolicy;
};

const SAFE_MODELS = new Set(["fast", "balanced", "deep", "ultra", "small-local", "deep-reviewer"]);
const SAFE_SPLIT_STRATEGIES = new Set(["single", "parallel", "sequential"]);
const SAFE_CONTEXT_BUDGETS = new Set(["small", "medium", "large"]);
const SAFE_EVIDENCE_MODES = new Set(["minimal", "standard", "strict"]);
const SAFE_STOP_RULES = new Set(["continue", "verify", "escalate"]);

export function computeReward(outcome: PolicyOutcome): number {
  const testScore = outcome.testsPassed ? 10 : -8;
  const evidenceScore = Math.min(outcome.evidenceCount, 6) * 0.5;
  const questionPenalty = Math.min(outcome.openQuestions, 10) * 0.8;
  const correctionPenalty = Math.min(outcome.userCorrectionCount, 10) * 1.2;
  const durationPenalty = Math.min(outcome.durationMs / 60_000, 4);
  const tokenPenalty = Math.min(outcome.tokenEstimate / 50_000, 4);
  const reasoningScore = Math.max(0, Math.min(outcome.reasoningScore ?? 0, 1)) * 2;
  return Number(
    (
      testScore +
      evidenceScore +
      reasoningScore -
      questionPenalty -
      correctionPenalty -
      durationPenalty -
      tokenPenalty
    ).toFixed(4),
  );
}

export function clampPolicyAction(action: PolicyAction): PolicyAction {
  return {
    workerCount: Math.max(1, Math.min(6, Math.trunc(action.workerCount || 1))),
    verifierCount: Math.max(0, Math.min(2, Math.trunc(action.verifierCount || 0))),
    maxDepth: Math.max(1, Math.min(4, Math.trunc(action.maxDepth || 1))),
    modelProfile: SAFE_MODELS.has(action.modelProfile) ? action.modelProfile : "balanced",
    splitStrategy: SAFE_SPLIT_STRATEGIES.has(action.splitStrategy ?? "") ? action.splitStrategy : "single",
    contextBudget: SAFE_CONTEXT_BUDGETS.has(action.contextBudget ?? "") ? action.contextBudget : "medium",
    evidenceMode: SAFE_EVIDENCE_MODES.has(action.evidenceMode ?? "") ? action.evidenceMode : "standard",
    stopRule: SAFE_STOP_RULES.has(action.stopRule ?? "") ? action.stopRule : "verify",
  };
}

function graphBucket(value: number): string {
  if (value < 50) return "small";
  if (value < 500) return "medium";
  return "large";
}

function evidenceBucket(value: number): string {
  if (value < 2) return "low";
  if (value < 8) return "medium";
  return "high";
}

function riskBucket(trace: OrchestrationTrace): string {
  return trace.openQuestions > 0 || !trace.outcome.testsPassed ? "high" : "low";
}

function stateKey(trace: OrchestrationTrace): string {
  return [
    trace.taskKind,
    `graph:${graphBucket(trace.graphNodeCount)}`,
    `evidence:${evidenceBucket(trace.evidenceCount)}`,
    `risk:${riskBucket(trace)}`,
  ].join("|");
}

function actionKey(action: PolicyAction): string {
  const clamped = clampPolicyAction(action);
  return [
    `workers=${clamped.workerCount}`,
    `verifiers=${clamped.verifierCount}`,
    `depth=${clamped.maxDepth}`,
    `model=${clamped.modelProfile}`,
    `split=${clamped.splitStrategy}`,
    `context=${clamped.contextBudget}`,
    `evidence=${clamped.evidenceMode}`,
    `stop=${clamped.stopRule}`,
  ].join("|");
}

function parseActionValues(action: string): Record<string, string> | undefined {
  const entries: Array<[string, string]> = [];
  for (const part of action.split("|")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      return undefined;
    }
    entries.push([part.slice(0, separatorIndex), part.slice(separatorIndex + 1)]);
  }
  return Object.fromEntries(entries);
}

function isActionSafe(action: string): boolean {
  const values = parseActionValues(action);
  if (!values) {
    return false;
  }
  const workerCount = Number(values.workers);
  const verifierCount = Number(values.verifiers);
  const maxDepth = Number(values.depth);
  return (
    Number.isInteger(workerCount) &&
    Number.isInteger(verifierCount) &&
    Number.isInteger(maxDepth) &&
    workerCount >= 1 &&
    workerCount <= 6 &&
    verifierCount >= 0 &&
    verifierCount <= 2 &&
    maxDepth >= 1 &&
    maxDepth <= 4 &&
    SAFE_MODELS.has(values.model) &&
    SAFE_SPLIT_STRATEGIES.has(values.split ?? "single") &&
    SAFE_CONTEXT_BUDGETS.has(values.context ?? "medium") &&
    SAFE_EVIDENCE_MODES.has(values.evidence ?? "standard") &&
    SAFE_STOP_RULES.has(values.stop ?? "verify")
  );
}

function parseActionKey(action: string): PolicyAction | undefined {
  if (!isActionSafe(action)) {
    return undefined;
  }
  const values = parseActionValues(action);
  if (!values) {
    return undefined;
  }
  return clampPolicyAction({
    workerCount: Number(values.workers),
    verifierCount: Number(values.verifiers),
    maxDepth: Number(values.depth),
    modelProfile: values.model,
    splitStrategy: values.split as PolicyAction["splitStrategy"],
    contextBudget: values.context as PolicyAction["contextBudget"],
    evidenceMode: values.evidence as PolicyAction["evidenceMode"],
    stopRule: values.stop as PolicyAction["stopRule"],
  });
}

function normalizeActionKey(action: string): string | undefined {
  const parsed = parseActionKey(action);
  return parsed ? actionKey(parsed) : undefined;
}

function bestActionForState(actions: Record<string, number> = {}): string | undefined {
  return Object.entries(actions).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

function fixedPolicyForTraces(
  policyId: string,
  traces: OrchestrationTrace[],
  action: PolicyAction,
): { policyId: string; qTable: Record<string, Record<string, number>> } {
  const qTable: Record<string, Record<string, number>> = {};
  const key = actionKey(action);
  for (const trace of traces) {
    qTable[stateKey(trace)] = { [key]: 1 };
  }
  return { policyId, qTable };
}

export function serializeTraceForTraining(trace: OrchestrationTrace): string {
  return JSON.stringify({
    traceId: trace.traceId,
    state: {
      taskKind: trace.taskKind,
      graphNodeCount: trace.graphNodeCount,
      evidenceCount: trace.evidenceCount,
      openQuestions: trace.openQuestions,
      stateKey: stateKey(trace),
    },
    action: trace.action,
    actionKey: actionKey(trace.action),
    outcome: trace.outcome,
    reward: computeReward(trace.outcome),
  });
}

function hashPolicy(input: unknown): string {
  return `policy:${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16)}`;
}

function liveFeedbackAdvice(trace: OrchestrationTrace): {
  recommendedAction: PolicyAction;
  reasons: string[];
} {
  const recommendedAction = clampPolicyAction(trace.action);
  const reasons: string[] = [];
  if (!trace.outcome.testsPassed) {
    recommendedAction.verifierCount = 2;
    recommendedAction.evidenceMode = "strict";
    recommendedAction.stopRule = "escalate";
    reasons.push("Failed tests require stricter verification before policy activation.");
  }
  if (trace.outcome.openQuestions > 0 || trace.openQuestions > 0) {
    recommendedAction.stopRule = "escalate";
    reasons.push("Open questions require escalation instead of automatic continuation.");
  }
  if (trace.outcome.tokenEstimate > 50_000) {
    recommendedAction.contextBudget = "small";
    reasons.push("High token use requires a smaller context budget on the next run.");
  }
  if (trace.outcome.evidenceCount < 2) {
    recommendedAction.evidenceMode = "strict";
    reasons.push("Low evidence count requires strict evidence mode.");
  }
  if (reasons.length === 0) {
    reasons.push("Live feedback recorded without policy activation changes.");
  }
  return { recommendedAction: clampPolicyAction(recommendedAction), reasons };
}

export function createPolicyStore(
  snapshot: Partial<PolicyStoreSnapshot> = {},
  onChange?: (snapshot: PolicyStoreSnapshot) => void,
): {
  record(trace: OrchestrationTrace): void;
  exportJsonl(): string;
  evaluate(policyJson: unknown): PolicyEvaluation;
  comparePolicyToBaselines(policyJson: unknown): PolicyBaselineComparison;
  activate(input: PolicyActivationInput): ActivePolicy;
  getActive(): ActivePolicy | undefined;
  recordLiveFeedback(trace: OrchestrationTrace): PolicyLiveFeedbackReport;
  snapshot(): PolicyStoreSnapshot;
} {
  const traces: OrchestrationTrace[] = (snapshot.traces ?? []).map((trace) => ({
    ...trace,
    action: { ...trace.action },
    outcome: { ...trace.outcome },
  }));
  const evaluations = new Map<string, PolicyEvaluation>(
    (snapshot.evaluations ?? []).map((evaluation) => [
      evaluation.evaluationId,
      {
        ...evaluation,
        safetyViolations: [...evaluation.safetyViolations],
        recommendedAction: evaluation.recommendedAction ? { ...evaluation.recommendedAction } : undefined,
      },
    ]),
  );
  let active: ActivePolicy | undefined = snapshot.active
    ? {
        ...snapshot.active,
        recommendedAction: snapshot.active.recommendedAction ? { ...snapshot.active.recommendedAction } : undefined,
      }
    : undefined;

  function snapshotState(): PolicyStoreSnapshot {
    return {
      traces: traces.map((trace) => ({
        ...trace,
        action: { ...trace.action },
        outcome: { ...trace.outcome },
      })),
      evaluations: [...evaluations.values()].map((evaluation) => ({
        ...evaluation,
        safetyViolations: [...evaluation.safetyViolations],
        recommendedAction: evaluation.recommendedAction ? { ...evaluation.recommendedAction } : undefined,
      })),
      active: active
        ? {
            ...active,
            recommendedAction: active.recommendedAction ? { ...active.recommendedAction } : undefined,
          }
        : undefined,
    };
  }

  function notifyChange(): void {
    onChange?.(snapshotState());
  }

  function evaluateCandidate(policyJson: unknown): PolicyEvaluation {
    const candidate = typeof policyJson === "object" && policyJson !== null ? policyJson as {
      policyId?: string;
      replayPassRate?: number;
      averageReward?: number;
      sampleCount?: number;
      qTable?: Record<string, Record<string, number>>;
    } : {};
    const safetyViolations = Object.values(candidate.qTable ?? {})
      .flatMap((actions) => Object.keys(actions))
      .filter((action) => !isActionSafe(action));
    const safeActions = Object.values(candidate.qTable ?? {})
      .flatMap((actions) => Object.entries(actions))
      .filter(([selectedAction]) => isActionSafe(selectedAction))
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    const policyId = candidate.policyId ?? hashPolicy(candidate);
    let matches = 0;
    const rewards: number[] = [];
    for (const trace of traces) {
      const actions = candidate.qTable?.[stateKey(trace)] ?? {};
      const selected = bestActionForState(actions);
      if (selected && normalizeActionKey(selected) === actionKey(trace.action)) {
        matches += 1;
      }
      rewards.push(computeReward(trace.outcome));
    }
    const sampleCount = traces.length;
    const replayPassRate = sampleCount > 0 && safetyViolations.length === 0 ? matches / sampleCount : 0;
    const averageReward =
      rewards.length > 0
        ? Number((rewards.reduce((sum, reward) => sum + reward, 0) / rewards.length).toFixed(4))
        : 0;
    return {
      evaluationId: hashPolicy({
        policyId,
        replayPassRate,
        averageReward,
        sampleCount,
        safetyViolations,
        qTable: candidate.qTable ?? {},
      }).replace("policy:", "evaluation:"),
      policyId,
      replayPassRate,
      averageReward,
      sampleCount,
      safetyViolations,
      recommendedAction: safeActions[0] ? parseActionKey(safeActions[0][0]) : undefined,
    };
  }

  return {
    record(trace) {
      traces.push({ ...trace, action: clampPolicyAction(trace.action) });
      notifyChange();
    },

    exportJsonl() {
      return traces.map(serializeTraceForTraining).join("\n");
    },

    evaluate(policyJson) {
      const evaluation = evaluateCandidate(policyJson);
      evaluations.set(evaluation.evaluationId, evaluation);
      notifyChange();
      return evaluation;
    },

    comparePolicyToBaselines(policyJson) {
      const candidate = evaluateCandidate(policyJson);
      const baselines = [
        fixedPolicyForTraces("baseline:single-balanced", traces, {
          workerCount: 1,
          verifierCount: 0,
          maxDepth: 1,
          modelProfile: "balanced",
          splitStrategy: "single",
          contextBudget: "medium",
          evidenceMode: "standard",
          stopRule: "verify",
        }),
        fixedPolicyForTraces("baseline:parallel-verify", traces, {
          workerCount: 3,
          verifierCount: 1,
          maxDepth: 3,
          modelProfile: "balanced",
          splitStrategy: "parallel",
          contextBudget: "large",
          evidenceMode: "standard",
          stopRule: "verify",
        }),
        fixedPolicyForTraces("baseline:strict-deep", traces, {
          workerCount: 2,
          verifierCount: 2,
          maxDepth: 4,
          modelProfile: "deep",
          splitStrategy: "sequential",
          contextBudget: "large",
          evidenceMode: "strict",
          stopRule: "escalate",
        }),
      ].map(evaluateCandidate);
      const best = [candidate, ...baselines].sort(
        (left, right) =>
          right.replayPassRate - left.replayPassRate ||
          right.averageReward - left.averageReward ||
          left.policyId.localeCompare(right.policyId),
      )[0];
      return { candidate, baselines, best };
    },

    activate(input) {
      const evaluation = evaluations.get(input.evaluationId);
      if (!evaluation) {
        throw new Error("Policy activation requires a prior server evaluation");
      }
      if (evaluation.safetyViolations.length > 0) {
        throw new Error("Policy activation rejected due to safety violations");
      }
      if (evaluation.replayPassRate < 0.9 || evaluation.sampleCount < 50 || evaluation.averageReward <= 0) {
        throw new Error("Policy replay threshold not satisfied");
      }
      active = {
        policyId: evaluation.policyId,
        evaluationId: input.evaluationId,
        replayPassRate: evaluation.replayPassRate,
        averageReward: evaluation.averageReward,
        sampleCount: evaluation.sampleCount,
        recommendedAction: evaluation.recommendedAction,
      };
      notifyChange();
      return { ...active };
    },

    getActive() {
      return active ? { ...active } : undefined;
    },

    recordLiveFeedback(trace) {
      const recordedTrace = { ...trace, action: clampPolicyAction(trace.action), outcome: { ...trace.outcome } };
      traces.push(recordedTrace);
      notifyChange();
      const advisory = liveFeedbackAdvice(recordedTrace);
      return {
        trace: {
          ...recordedTrace,
          action: { ...recordedTrace.action },
          outcome: { ...recordedTrace.outcome },
        },
        reward: computeReward(recordedTrace.outcome),
        advisory: {
          activationChanged: false,
          recommendedAction: advisory.recommendedAction,
          reasons: advisory.reasons,
        },
      };
    },

    snapshot: snapshotState,
  };
}
