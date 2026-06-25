import { describe, expect, it } from "vitest";
import {
  clampPolicyAction,
  computeReward,
  createPolicyStore,
  serializeTraceForTraining,
  type OrchestrationTrace,
} from "../src/orchestration-learning.js";

const passingOutcome = {
  testsPassed: true,
  evidenceCount: 4,
  openQuestions: 0,
  durationMs: 20_000,
  tokenEstimate: 12_000,
  userCorrectionCount: 0,
};

function trace(overrides: Partial<OrchestrationTrace> = {}): OrchestrationTrace {
  return {
    traceId: "trace-1",
    taskKind: "feature",
    graphNodeCount: 240,
    evidenceCount: 4,
    openQuestions: 0,
    action: {
      workerCount: 3,
      verifierCount: 1,
      maxDepth: 3,
      modelProfile: "balanced",
    },
    outcome: passingOutcome,
    ...overrides,
  };
}

describe("orchestration learning", () => {
  it("computes reward with passing tests as the dominant positive signal", () => {
    const passingReward = computeReward(passingOutcome);
    const failingReward = computeReward({ ...passingOutcome, testsPassed: false, evidenceCount: 20 });

    expect(passingReward).toBeGreaterThan(0);
    expect(passingReward).toBeGreaterThan(failingReward);
  });

  it("caps evidence benefits and bounds duration and token penalties", () => {
    const cappedEvidenceReward = computeReward({ ...passingOutcome, evidenceCount: 99 });
    const normalEvidenceReward = computeReward({ ...passingOutcome, evidenceCount: 6 });
    const expensiveReward = computeReward({
      ...passingOutcome,
      durationMs: 24 * 60 * 60 * 1_000,
      tokenEstimate: 2_000_000,
    });

    expect(cappedEvidenceReward).toBe(normalEvidenceReward);
    expect(expensiveReward).toBeGreaterThan(0);
  });

  it("penalizes open questions and user corrections", () => {
    const cleanReward = computeReward(passingOutcome);
    const correctedReward = computeReward({
      ...passingOutcome,
      openQuestions: 3,
      userCorrectionCount: 2,
    });

    expect(correctedReward).toBeLessThan(cleanReward);
  });

  it("clamps learned actions to runtime safety limits and safe model defaults", () => {
    const action = clampPolicyAction({
      workerCount: 50,
      verifierCount: 10,
      maxDepth: 99,
      modelProfile: "unknown",
    });

    expect(action).toEqual({
      workerCount: 6,
      verifierCount: 2,
      maxDepth: 4,
      modelProfile: "balanced",
      splitStrategy: "single",
      contextBudget: "medium",
      evidenceMode: "standard",
      stopRule: "verify",
    });
  });

  it("clamps expanded orchestration policy actions to safe research decisions", () => {
    const action = clampPolicyAction({
      workerCount: 8,
      verifierCount: 9,
      maxDepth: 99,
      modelProfile: "untrusted",
      splitStrategy: "chaos",
      contextBudget: "everything",
      evidenceMode: "none",
      stopRule: "ignore",
    } as any);

    expect(action).toEqual({
      workerCount: 6,
      verifierCount: 2,
      maxDepth: 4,
      modelProfile: "balanced",
      splitStrategy: "single",
      contextBudget: "medium",
      evidenceMode: "standard",
      stopRule: "verify",
    });
  });

  it("serializes traces as deterministic JSONL records with computed reward", () => {
    const serialized = serializeTraceForTraining(trace());
    const parsed = JSON.parse(serialized);

    expect(serialized.endsWith("\n")).toBe(false);
    expect(parsed).toMatchObject({
      traceId: "trace-1",
      state: {
        taskKind: "feature",
        graphNodeCount: 240,
        evidenceCount: 4,
        openQuestions: 0,
      },
      action: {
        workerCount: 3,
        verifierCount: 1,
        maxDepth: 3,
        modelProfile: "balanced",
      },
    });
    expect(parsed.reward).toBe(computeReward(passingOutcome));
  });

  it("records traces, exports JSONL, and evaluates candidate safety", () => {
    const store = createPolicyStore();

    store.record(trace());
    store.record(trace({ traceId: "trace-2", action: { workerCount: 99, verifierCount: 0, maxDepth: 9, modelProfile: "risky" } }));

    const lines = store.exportJsonl().split("\n");
    const evaluation = store.evaluate({
      policyId: "candidate",
      qTable: {
        "feature|graph:medium|evidence:medium|risk:low": {
          "workers=99|verifiers=5|depth=9|model=risky|split=single|context=medium|evidence=standard|stop=verify": 2,
        },
      },
    });

    expect(lines).toHaveLength(2);
    expect(evaluation.evaluationId).toMatch(/^evaluation:[a-f0-9]{16}$/);
    expect(evaluation.sampleCount).toBe(2);
    expect(evaluation.replayPassRate).toBe(0);
    expect(evaluation.safetyViolations).toContain(
      "workers=99|verifiers=5|depth=9|model=risky|split=single|context=medium|evidence=standard|stop=verify",
    );
  });

  it("does not activate a policy below replay thresholds", () => {
    const store = createPolicyStore();
    const evaluation = store.evaluate({
      policyId: "weak",
      qTable: {},
    });

    expect(() =>
      store.activate({ evaluationId: evaluation.evaluationId }),
    ).toThrow(/replay threshold/i);
  });

  it("does not accept forged activation metrics without a stored evaluation", () => {
    const store = createPolicyStore();

    expect(() =>
      store.activate({ evaluationId: "evaluation:forged" }),
    ).toThrow(/prior server evaluation/i);
  });

  it("activates only policies that satisfy replay, sample, and reward gates", () => {
    const store = createPolicyStore();
    for (let index = 0; index < 75; index += 1) {
      store.record(trace({ traceId: `trace-${index}` }));
    }
    const activation = store.evaluate({
      policyId: "strong",
      qTable: {
        "feature|graph:medium|evidence:medium|risk:low": {
          "workers=3|verifiers=1|depth=3|model=balanced|split=single|context=medium|evidence=standard|stop=verify": 1,
        },
      },
    });

    store.activate({ evaluationId: activation.evaluationId });

    expect(store.getActive()).toEqual({
      policyId: "strong",
      evaluationId: activation.evaluationId,
      replayPassRate: 1,
      averageReward: computeReward(passingOutcome),
      sampleCount: 75,
      recommendedAction: {
        workerCount: 3,
        verifierCount: 1,
        maxDepth: 3,
        modelProfile: "balanced",
        splitStrategy: "single",
        contextBudget: "medium",
        evidenceMode: "standard",
        stopRule: "verify",
      },
    });
  });

  it("compares a candidate policy against deterministic orchestration baselines", () => {
    const store = createPolicyStore();
    for (let index = 0; index < 12; index += 1) {
      store.record(trace({
        traceId: `trace-${index}`,
        action: {
          workerCount: 3,
          verifierCount: 1,
          maxDepth: 3,
          modelProfile: "balanced",
          splitStrategy: "parallel",
          contextBudget: "large",
          evidenceMode: "strict",
          stopRule: "verify",
        },
      }));
    }

    const comparison = store.comparePolicyToBaselines({
      policyId: "candidate",
      qTable: {
        "feature|graph:medium|evidence:medium|risk:low": {
          "workers=3|verifiers=1|depth=3|model=balanced|split=parallel|context=large|evidence=strict|stop=verify": 1,
        },
      },
    });

    expect(comparison.candidate.policyId).toBe("candidate");
    expect(comparison.candidate.replayPassRate).toBe(1);
    expect(comparison.baselines.map((baseline) => baseline.policyId)).toEqual([
      "baseline:single-balanced",
      "baseline:parallel-verify",
      "baseline:strict-deep",
    ]);
    expect(comparison.best.policyId).toBe("candidate");
  });

  it("records live policy feedback as advisory hints without activating a policy", () => {
    const store = createPolicyStore();
    const feedback = store.recordLiveFeedback(
      trace({
        traceId: "live-failure",
        openQuestions: 2,
        outcome: {
          testsPassed: false,
          evidenceCount: 1,
          openQuestions: 2,
          durationMs: 90_000,
          tokenEstimate: 80_000,
          userCorrectionCount: 1,
        },
      }),
    );

    expect(feedback.reward).toBeLessThan(0);
    expect(feedback.advisory.activationChanged).toBe(false);
    expect(feedback.advisory.recommendedAction).toEqual(
      expect.objectContaining({
        verifierCount: 2,
        evidenceMode: "strict",
        stopRule: "escalate",
        contextBudget: "small",
      }),
    );
    expect(feedback.advisory.reasons).toEqual(
      expect.arrayContaining([
        "Failed tests require stricter verification before policy activation.",
        "Open questions require escalation instead of automatic continuation.",
      ]),
    );
    expect(store.getActive()).toBeUndefined();
    expect(store.exportJsonl()).toContain("live-failure");
  });
});
