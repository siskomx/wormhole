import { describe, expect, it } from "vitest";
import { getToolProfile } from "../src/tool-profiles.js";
import { TOOL_REGISTRY, reviewToolAdmission, type ToolRegistryEntry } from "../src/tool-registry.js";
import {
  createToolPromotionRecord,
  reviewToolPromotion,
  searchToolsForPromotion,
} from "../src/tool-promotion.js";

describe("tool promotion search", () => {
  it("searches registry metadata and uses the selected profile recovery tools", () => {
    const profile = getToolProfile("feature-implementation");
    const result = searchToolsForPromotion({
      profileId: "feature-implementation",
      query: "patch verify evidence",
      limit: 20,
    });

    const promotedToolNames = result.promotedTools.map((candidate) => candidate.tool.name);
    expect(promotedToolNames).toEqual(
      expect.arrayContaining(["patch_apply", "verification_run", "record_evidence"]),
    );
    expect(result.recoveryTools).toEqual(profile?.recoveryTools);
    expect(result.candidates.find((candidate) => candidate.tool.name === "patch_apply")).toEqual(
      expect.objectContaining({
        profileAllowed: true,
        score: expect.any(Number),
      }),
    );
  });

  it("falls back to catalog and admission recovery tools when no profile applies", () => {
    const result = searchToolsForPromotion({ query: "catalog admission", limit: 5 });

    expect(result.profileId).toBeUndefined();
    expect(result.recoveryTools).toEqual(["tool_catalog_query", "tool_admission_review"]);
  });

  it("applies structured filters deterministically", () => {
    const input = {
      profileId: "large-repo-intelligence" as const,
      objective: "query domain schema tables",
      plane: "project" as const,
      phase: "gather" as const,
      pack: "large-repo" as const,
      risk: "read" as const,
      limit: 8,
    };

    const first = searchToolsForPromotion(input);
    const second = searchToolsForPromotion(input);

    expect(second).toEqual(first);
    expect(first.promotedTools.length).toBeGreaterThan(0);
    for (const candidate of first.promotedTools) {
      expect(candidate.tool).toEqual(
        expect.objectContaining({
          plane: "project",
          phase: "gather",
          pack: "large-repo",
          risk: "read",
        }),
      );
    }
  });

  it("treats empty explicit tool names as normal search input", () => {
    const withoutToolNames = searchToolsForPromotion({
      profileId: "feature-implementation",
      query: "patch",
      limit: 10,
    });
    const withEmptyToolNames = searchToolsForPromotion({
      profileId: "feature-implementation",
      query: "patch",
      toolNames: [],
      limit: 10,
    });

    expect(withEmptyToolNames.promotedTools.map((candidate) => candidate.tool.name)).toEqual(
      withoutToolNames.promotedTools.map((candidate) => candidate.tool.name),
    );
    expect(withEmptyToolNames.promotedTools.map((candidate) => candidate.tool.name)).toContain("patch_apply");
  });

  it("does not match query terms inside unrelated words", () => {
    const result = searchToolsForPromotion({ query: "patch" });
    const candidateNames = result.candidates.map((candidate) => candidate.tool.name);

    expect(candidateNames).toContain("patch_apply");
    expect(candidateNames).not.toContain("agent_dispatch");
    expect(candidateNames).not.toContain("agent_dispatch_execute");
  });

  it("searches hyphenated metadata as free text", () => {
    const registry: ToolRegistryEntry[] = [
      {
        name: "custom_lookup",
        plane: "project",
        phase: "gather",
        pack: "large-repo",
        risk: "read",
        summary: "Find owned schema facts.",
        inputs: ["workspace"],
      },
      {
        name: "local_lookup",
        plane: "project",
        phase: "gather",
        pack: "core",
        risk: "read",
        summary: "Find owned schema facts.",
        inputs: ["workspace"],
      },
    ];

    const result = searchToolsForPromotion({ query: "large-repo", registry });

    expect(result.promotedTools.map((candidate) => candidate.tool.name)).toEqual(["custom_lookup"]);
  });

  it("hides out-of-profile tools unless an override includes a reason", () => {
    const hiddenReason =
      "Tool is outside profile code-review. Pass allowOutOfProfile with overrideReason to include it.";
    const blocked = reviewToolPromotion({
      profileId: "code-review",
      toolNames: ["patch_apply", "diff_scope_review"],
    });

    expect(blocked.promotedTools.map((candidate) => candidate.tool.name)).toEqual(["diff_scope_review"]);
    expect(blocked.hiddenTools).toEqual([
      expect.objectContaining({
        toolName: "patch_apply",
        requested: true,
        reason: hiddenReason,
      }),
    ]);
    expect(blocked.hiddenRequestedToolCount).toBe(1);
    expect(blocked.outOfProfileToolCount).toBe(1);

    const missingReason = reviewToolPromotion({
      profileId: "code-review",
      toolNames: ["patch_apply"],
      allowOutOfProfile: true,
      overrideReason: "   ",
    });
    expect(missingReason.promotedTools).toHaveLength(0);
    expect(missingReason.hiddenTools[0]?.reason).toBe(hiddenReason);
    expect(missingReason.warnings.join("\n")).toContain("overrideReason");

    const overridden = reviewToolPromotion({
      profileId: "code-review",
      toolNames: ["patch_apply"],
      allowOutOfProfile: true,
      overrideReason: "Emergency patch review",
    });
    expect(overridden.promotedTools.map((candidate) => candidate.tool.name)).toEqual(["patch_apply"]);
    expect(overridden.hiddenTools).toEqual([]);
    expect(overridden.warnings.join("\n")).toContain("Emergency patch review");
  });

  it("reports unknown requested tools and preserves known requested order", () => {
    const result = searchToolsForPromotion({
      profileId: "feature-implementation",
      toolNames: ["record_evidence", "ghost_tool", "patch_apply", "missing_tool", "verification_run"],
    });

    expect(result.unknownTools).toEqual(["ghost_tool", "missing_tool"]);
    expect(result.promotedTools.map((candidate) => candidate.tool.name)).toEqual([
      "record_evidence",
      "patch_apply",
      "verification_run",
    ]);
  });

  it("includes admission guidance for promoted write and execute tools", () => {
    const result = reviewToolPromotion({
      profileId: "feature-implementation",
      toolNames: ["patch_apply", "verification_run"],
    });

    expect(result.profile?.profileId).toBe("feature-implementation");
    expect(result.admission).toEqual(
      reviewToolAdmission({ toolNames: ["patch_apply", "verification_run"] }),
    );
    expect(
      result.admission.decisions.find((decision) => decision.toolName === "patch_apply")
        ?.requiredPreflightTools,
    ).toEqual(expect.arrayContaining(["action_policy_review", "patch_checkpoint", "diff_scope_review"]));
  });

  it("creates deterministic promotion records with normalized scope ids", () => {
    const baseInput = {
      missionId: "Mission: Alpha/42",
      sessionId: " session!* ",
      profileId: "feature-implementation" as const,
      toolNames: ["patch_apply"],
      objective: "Apply verification patch",
      query: "patch",
      registry: TOOL_REGISTRY,
      createdAt: "2026-06-30T12:00:00.000Z",
    };

    const first = createToolPromotionRecord({ ...baseInput, sequence: 1 });
    const second = createToolPromotionRecord({ ...baseInput, sequence: 2 });

    expect(first.promotionId).toBe("tool-promotion-Mission-Alpha-42-session-1");
    expect(second.promotionId).toBe("tool-promotion-Mission-Alpha-42-session-2");
    expect(first.createdAt).toBe("2026-06-30T12:00:00.000Z");
    expect(first.scope).toEqual({ missionId: "Mission: Alpha/42", sessionId: " session!* " });
    expect(first.objective).toBe("Apply verification patch");
    expect(first.query).toBe("patch");
    expect(first.promotedTools.map((candidate) => candidate.tool.name)).toEqual(["patch_apply"]);
    expect(first.promotedTools[0]).toEqual(
      expect.objectContaining({
        tool: expect.objectContaining({ name: "patch_apply" }),
        requested: true,
      }),
    );
    expect(first.admission).toEqual(reviewToolAdmission({ toolNames: ["patch_apply"] }));

    const normalized = createToolPromotionRecord({
      missionId: "***",
      sessionId: `${"a".repeat(70)}!`,
      profileId: "feature-implementation",
      toolNames: ["patch_apply"],
      createdAt: "2026-06-30T12:00:00.000Z",
    });
    expect(normalized.promotionId).toBe(`tool-promotion-none-${"a".repeat(64)}-1`);
  });
});
