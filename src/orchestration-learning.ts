import { createHash } from "node:crypto";

export type PolicyOutcome = {
  testsPassed: boolean;
  evidenceCount: number;
  openQuestions: number;
  durationMs: number;
  tokenEstimate: number;
  userCorrectionCount: number;
};

export type PolicyAction = {
  workerCount: number;
  verifierCount: number;
  maxDepth: number;
  modelProfile: string;
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

const SAFE_MODELS = new Set(["fast", "balanced", "deep", "ultra", "small-local", "deep-reviewer"]);

export function computeReward(outcome: PolicyOutcome): number {
  const testScore = outcome.testsPassed ? 10 : -8;
  const evidenceScore = Math.min(outcome.evidenceCount, 6) * 0.5;
  const questionPenalty = Math.min(outcome.openQuestions, 10) * 0.8;
  const correctionPenalty = Math.min(outcome.userCorrectionCount, 10) * 1.2;
  const durationPenalty = Math.min(outcome.durationMs / 60_000, 4);
  const tokenPenalty = Math.min(outcome.tokenEstimate / 50_000, 4);
  return Number(
    (testScore + evidenceScore - questionPenalty - correctionPenalty - durationPenalty - tokenPenalty).toFixed(4),
  );
}

export function clampPolicyAction(action: PolicyAction): PolicyAction {
  return {
    workerCount: Math.max(1, Math.min(6, Math.trunc(action.workerCount || 1))),
    verifierCount: Math.max(0, Math.min(2, Math.trunc(action.verifierCount || 0))),
    maxDepth: Math.max(1, Math.min(4, Math.trunc(action.maxDepth || 1))),
    modelProfile: SAFE_MODELS.has(action.modelProfile) ? action.modelProfile : "balanced",
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
  return [
    `workers=${action.workerCount}`,
    `verifiers=${action.verifierCount}`,
    `depth=${action.maxDepth}`,
    `model=${action.modelProfile}`,
  ].join("|");
}

function isActionSafe(action: string): boolean {
  const values = Object.fromEntries(action.split("|").map((part) => part.split("=")));
  const workerCount = Number(values.workers);
  const verifierCount = Number(values.verifiers);
  const maxDepth = Number(values.depth);
  return (
    workerCount >= 1 &&
    workerCount <= 6 &&
    verifierCount >= 0 &&
    verifierCount <= 2 &&
    maxDepth >= 1 &&
    maxDepth <= 4 &&
    SAFE_MODELS.has(values.model)
  );
}

function parseActionKey(action: string): PolicyAction | undefined {
  if (!isActionSafe(action)) {
    return undefined;
  }
  const values = Object.fromEntries(action.split("|").map((part) => part.split("=")));
  return {
    workerCount: Number(values.workers),
    verifierCount: Number(values.verifiers),
    maxDepth: Number(values.depth),
    modelProfile: values.model,
  };
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

export function createPolicyStore(): {
  record(trace: OrchestrationTrace): void;
  exportJsonl(): string;
  evaluate(policyJson: unknown): PolicyEvaluation;
  activate(input: PolicyActivationInput): ActivePolicy;
  getActive(): ActivePolicy | undefined;
} {
  const traces: OrchestrationTrace[] = [];
  const evaluations = new Map<string, PolicyEvaluation>();
  let active: ActivePolicy | undefined;

  return {
    record(trace) {
      traces.push({ ...trace, action: clampPolicyAction(trace.action) });
    },

    exportJsonl() {
      return traces.map(serializeTraceForTraining).join("\n");
    },

    evaluate(policyJson) {
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
        .filter(([action]) => isActionSafe(action))
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
      const policyId = candidate.policyId ?? hashPolicy(candidate);
      let matches = 0;
      const rewards: number[] = [];
      for (const trace of traces) {
        const actions = candidate.qTable?.[stateKey(trace)] ?? {};
        const selected = Object.entries(actions).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
        if (selected && isActionSafe(selected) && selected === actionKey(trace.action)) {
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
      const evaluation: PolicyEvaluation = {
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
      evaluations.set(evaluation.evaluationId, evaluation);
      return evaluation;
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
      return { ...active };
    },

    getActive() {
      return active ? { ...active } : undefined;
    },
  };
}
