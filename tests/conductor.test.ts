import { describe, expect, it } from "vitest";
import { createConductorPlan, replayConductorPlan } from "../src/conductor.js";

describe("conductor plan generation", () => {
  it("uses a single-pass worker scaffold for low risk and low complexity", () => {
    const plan = createConductorPlan({
      objective: "Inspect docs",
      risk: "low",
      complexity: "low",
      requiredStrengths: ["research"],
      modelProfileIds: ["small-local"],
    });

    expect(plan.scaffoldId).toBe("single-pass");
    expect(plan.steps).toEqual([
      expect.objectContaining({
        role: "worker",
        stepId: "worker-1",
      }),
    ]);
    expect(plan.trace.traceId).toMatch(/^conductor:sha256:[a-f0-9]{64}$/);
    expect(plan.trace.reasonCodes).toEqual(
      expect.arrayContaining(["risk:low", "complexity:low", "scaffold:single-pass"]),
    );
  });

  it("uses a planner-worker-verifier scaffold for high risk work", () => {
    const plan = createConductorPlan({
      objective: "Refactor repo index and verify behavior",
      risk: "high",
      complexity: "medium",
      requiredStrengths: ["coding", "review"],
      modelProfileIds: ["small-local", "deep-reviewer"],
    });

    expect(plan.scaffoldId).toBe("plan-execute-verify");
    expect(plan.steps.map((step) => step.role)).toEqual(["planner", "worker", "verifier"]);
    expect(plan.trace.reasonCodes).toContain("risk:high");
  });

  it("uses an iterative-repair scaffold for high complexity work", () => {
    const plan = createConductorPlan({
      objective: "Untangle a complex runtime flow",
      risk: "low",
      complexity: "high",
      requiredStrengths: ["analysis"],
      modelProfileIds: ["planner", "worker", "verifier"],
    });

    expect(plan.scaffoldId).toBe("iterative-repair");
    expect(plan.steps.map((step) => step.role)).toEqual(["planner", "worker", "verifier"]);
  });

  it("replays the same scaffold from trace input", () => {
    const original = createConductorPlan({
      objective: "Inspect docs",
      risk: "low",
      complexity: "medium",
      requiredStrengths: ["research"],
      modelProfileIds: ["small-local"],
    });

    expect(replayConductorPlan(original.trace)).toEqual(original);
  });
});
