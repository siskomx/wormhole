import { describe, expect, it } from "vitest";
import { createModelProfileRegistry } from "../src/model-profile.js";

describe("native model profile learning", () => {
  it("selects deterministic profiles from task mode, privacy, and provider policy", () => {
    const registry = createModelProfileRegistry();
    registry.register({
      profileId: "small-local",
      providerId: "local",
      modelId: "mini-coder",
      strengths: ["coding", "fast"],
      modes: ["fast", "balanced"],
      costTier: "low",
      latencyTier: "low",
      privacy: "local",
      contextWindow: 32_000,
    });
    registry.register({
      profileId: "deep-cloud",
      providerId: "cloud",
      modelId: "deep-coder",
      strengths: ["coding", "review"],
      modes: ["deep"],
      costTier: "high",
      latencyTier: "high",
      privacy: "external",
      contextWindow: 200_000,
    });

    const selected = registry.select({
      taskType: "coding",
      mode: "fast",
      requiredStrengths: ["coding"],
      requiresPrivacy: true,
      deniedProviders: ["cloud"],
    });

    expect(selected.profile.profileId).toBe("small-local");
    expect(selected.reasonCodes).toContain("privacy:local-required");
    expect(selected.traceId).toMatch(/^route:sha256:/);
  });

  it("records outcomes and exports replayable traces", () => {
    const registry = createModelProfileRegistry();
    registry.register({
      profileId: "small-local",
      providerId: "local",
      modelId: "mini-coder",
      strengths: ["research"],
      modes: ["fast"],
      costTier: "low",
      latencyTier: "low",
      privacy: "local",
      contextWindow: 16_000,
    });

    const selected = registry.select({
      taskType: "research",
      mode: "fast",
      requiredStrengths: ["research"],
    });
    const outcome = registry.recordOutcome({
      traceId: selected.traceId,
      status: "succeeded",
      latencyMs: 120,
      outputQuality: 4,
      notes: "Good enough for routing.",
    });
    const traces = registry.exportTraces();

    expect(outcome.profileStats.successCount).toBe(1);
    expect(outcome.profileStats.averageQuality).toBe(4);
    expect(traces).toContain(selected.traceId);
    expect(JSON.parse(traces)[0].outcome.status).toBe("succeeded");
  });
});
