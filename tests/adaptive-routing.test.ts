import { describe, expect, it } from "vitest";
import { createProviderRegistry, selectRoutingPlan } from "../src/adaptive-routing.js";

describe("adaptive routing and model selection", () => {
  it("selects deep mode for high-risk ambiguous missions", () => {
    const registry = createProviderRegistry([
      {
        providerId: "local",
        modelId: "fast-coder",
        strengths: ["coding"],
        maxDepth: 2,
        costTier: "low",
        privacy: "local",
      },
      {
        providerId: "frontier",
        modelId: "deep-reviewer",
        strengths: ["coding", "planning", "review"],
        maxDepth: 4,
        costTier: "high",
        privacy: "external",
      },
    ]);

    const plan = selectRoutingPlan(
      {
        taskCategory: "migration",
        ambiguity: "high",
        risk: "high",
        repoSize: "large",
        requiresPrivacy: false,
      },
      registry,
    );

    expect(plan.mode).toBe("deep");
    expect(plan.maxDepth).toBe(4);
    expect(plan.verifierCount).toBeGreaterThanOrEqual(2);
    expect(plan.selectedModel.modelId).toBe("deep-reviewer");
  });

  it("respects local-only privacy requirements", () => {
    const registry = createProviderRegistry([
      {
        providerId: "local",
        modelId: "local-coder",
        strengths: ["coding", "planning"],
        maxDepth: 3,
        costTier: "medium",
        privacy: "local",
      },
      {
        providerId: "external",
        modelId: "external-deep",
        strengths: ["coding", "planning", "review"],
        maxDepth: 4,
        costTier: "high",
        privacy: "external",
      },
    ]);

    const plan = selectRoutingPlan(
      {
        taskCategory: "feature",
        ambiguity: "medium",
        risk: "medium",
        repoSize: "medium",
        requiresPrivacy: true,
      },
      registry,
    );

    expect(plan.selectedModel.providerId).toBe("local");
    expect(plan.rejectedModels).toContainEqual(
      expect.objectContaining({
        modelId: "external-deep",
        reason: "privacy requirement",
      }),
    );
  });
});
