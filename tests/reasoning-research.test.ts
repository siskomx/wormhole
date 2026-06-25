import { describe, expect, it } from "vitest";
import {
  createReasoningResearchStore,
  scoreReasoningTrace,
  type ReasoningTrace,
} from "../src/reasoning-research.js";

function trace(overrides: Partial<ReasoningTrace> = {}): ReasoningTrace {
  return {
    traceId: "reason-1",
    strategy: "critique-revise",
    taskKind: "feature",
    planSummary: "Plan implementation from repo evidence.",
    critiqueSummary: "Critique missing tests and stale evidence.",
    revisionSummary: "Revise plan to add tests and refresh evidence.",
    verifierSummary: "Verifier checks the final plan against evidence.",
    evidenceReferenced: 4,
    evidenceAvailable: 5,
    openQuestionsResolved: 2,
    openQuestionsRemaining: 0,
    outcome: "succeeded",
    userCorrections: 0,
    ...overrides,
  };
}

describe("reasoning research", () => {
  it("scores reasoning traces from evidence coverage, critique, revision, verifier, and outcome", () => {
    const strong = scoreReasoningTrace(trace());
    const weak = scoreReasoningTrace(trace({
      traceId: "reason-weak",
      strategy: "critique-revise",
      critiqueSummary: undefined,
      revisionSummary: undefined,
      verifierSummary: undefined,
      evidenceReferenced: 0,
      evidenceAvailable: 6,
      openQuestionsResolved: 0,
      openQuestionsRemaining: 3,
      outcome: "failed",
      userCorrections: 3,
    }));

    expect(strong.total).toBeGreaterThan(weak.total);
    expect(strong.total).toBeLessThanOrEqual(1);
    expect(weak.total).toBeGreaterThanOrEqual(0);
    expect(strong.evidenceCoverage).toBeCloseTo(0.8);
    expect(strong.reasoningStructure).toBe(1);
  });

  it("records and exports reasoning traces as scored JSONL", () => {
    const store = createReasoningResearchStore();

    const recorded = store.record(trace());
    const line = store.exportJsonl();
    const parsed = JSON.parse(line);

    expect(recorded.score.total).toBeGreaterThan(0.8);
    expect(parsed.traceId).toBe("reason-1");
    expect(parsed.score.total).toBe(recorded.score.total);
  });

  it("evaluates reasoning strategies and recommends only supported winners", () => {
    const store = createReasoningResearchStore();
    store.record(trace({ traceId: "critique-1", outcome: "succeeded" }));
    store.record(trace({ traceId: "critique-2", outcome: "partial", userCorrections: 0 }));
    store.record(trace({
      traceId: "single-1",
      strategy: "plan-first",
      critiqueSummary: undefined,
      revisionSummary: undefined,
      verifierSummary: undefined,
      evidenceReferenced: 1,
      evidenceAvailable: 4,
      openQuestionsResolved: 0,
      openQuestionsRemaining: 2,
      outcome: "failed",
      userCorrections: 2,
    }));

    const evaluation = store.evaluateStrategies();

    expect(evaluation[0]).toMatchObject({
      strategy: "critique-revise",
      sampleCount: 2,
      recommended: true,
    });
    expect(evaluation[0]?.averageScore).toBeGreaterThan(evaluation[1]?.averageScore ?? 0);
    expect(evaluation.find((summary) => summary.strategy === "plan-first")?.recommended).toBe(false);
  });
});
