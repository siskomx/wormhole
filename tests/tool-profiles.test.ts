import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY } from "../src/tool-registry.js";
import {
  getToolProfile,
  listToolProfiles,
  TOOL_CAPABILITY_PROFILES,
  validateToolProfiles,
} from "../src/tool-profiles.js";

describe("tool capability profiles", () => {
  it("defines valid profiles backed by registry tools", () => {
    const validation = validateToolProfiles(TOOL_CAPABILITY_PROFILES, TOOL_REGISTRY);

    expect(validation).toEqual({ valid: true, errors: [] });
    expect(listToolProfiles().map((profile) => profile.profileId)).toEqual([
      "feature-implementation",
      "bug-fix",
      "code-review",
      "repo-onboarding",
      "large-repo-intelligence",
    ]);
  });

  it("keeps risky mutation tools out of read-only review profiles", () => {
    const review = getToolProfile("code-review");

    expect(review?.allowedTools).toContain("diff_scope_review");
    expect(review?.allowedTools).toContain("test_quality_review");
    expect(review?.allowedTools).not.toContain("patch_apply");
    expect(review?.verificationGates).toContain("gate_request");
  });

  it("keeps feature implementation profile grounded in existing Wormhole gates", () => {
    const feature = getToolProfile("feature-implementation");

    expect(feature?.bootstrapTools).toEqual([
      "tool_layer_map",
      "tool_profile_list",
      "tool_search",
      "tool_admission_review",
    ]);
    expect(feature?.allowedTools).toEqual(
      expect.arrayContaining([
        "mission_route",
        "agent_context_prepare",
        "project_onboard",
        "context_pack_generate",
        "patch_checkpoint",
        "patch_apply",
        "verification_run",
        "record_evidence",
        "gate_request",
      ]),
    );
    expect(feature?.requiredEvidence).toEqual(
      expect.arrayContaining(["source_paths", "verification_output", "gate_decision"]),
    );
  });

  it("reports duplicate, unknown, and inconsistent profile entries", () => {
    const base = TOOL_CAPABILITY_PROFILES[0]!;
    const invalid = validateToolProfiles(
      [
        base,
        { ...base, profileId: base.profileId },
        { ...base, profileId: "bug-fix", allowedTools: [...base.allowedTools, "ghost_tool"] },
        { ...base, profileId: "code-review", bootstrapTools: ["patch_apply"], allowedTools: ["tool_layer_map"] },
        { ...base, profileId: "repo-onboarding", verificationGates: ["verification_run"], allowedTools: ["tool_layer_map"] },
      ],
      TOOL_REGISTRY,
    );

    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        `Duplicate tool profile: ${base.profileId}`,
        "bug-fix.allowedTools references unknown tool: ghost_tool",
        "code-review.bootstrapTools must also be allowed: patch_apply",
        "repo-onboarding.verificationGates must also be allowed: verification_run",
      ]),
    );
  });
});
