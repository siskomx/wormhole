import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY } from "../src/tool-registry.js";
import {
  getToolProfile,
  listToolProfiles,
  TOOL_CAPABILITY_PROFILES,
  TOOL_PROFILE_IDS,
  type ToolCapabilityProfile,
  validateToolProfiles,
} from "../src/tool-profiles.js";

type MutableProfile = {
  profileId: ToolCapabilityProfile["profileId"];
  label: string;
  description: string;
  bootstrapTools: string[];
  allowedTools: string[];
  requiredEvidence: string[];
  verificationGates: string[];
  recoveryTools: string[];
};

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

  it("keeps profile ids and catalog entries in sync", () => {
    expect(TOOL_CAPABILITY_PROFILES.map((profile) => profile.profileId)).toEqual([...TOOL_PROFILE_IDS]);
  });

  it("freezes the exported canonical profile catalog", () => {
    expect(Object.isFrozen(TOOL_CAPABILITY_PROFILES)).toBe(true);
    for (const profile of TOOL_CAPABILITY_PROFILES) {
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.bootstrapTools)).toBe(true);
      expect(Object.isFrozen(profile.allowedTools)).toBe(true);
      expect(Object.isFrozen(profile.requiredEvidence)).toBe(true);
      expect(Object.isFrozen(profile.verificationGates)).toBe(true);
      expect(Object.isFrozen(profile.recoveryTools)).toBe(true);
    }
  });

  it("returns isolated profile clones", () => {
    const profile = listToolProfiles()[0]!;
    const beforeMutation = getToolProfile(profile.profileId);
    const mutableProfile = profile as unknown as MutableProfile;

    mutableProfile.label = "mutated";
    mutableProfile.bootstrapTools.push("ghost_bootstrap");
    mutableProfile.allowedTools.push("ghost_allowed");
    mutableProfile.requiredEvidence.push("ghost_evidence");
    mutableProfile.verificationGates.push("ghost_gate");
    mutableProfile.recoveryTools.push("ghost_recovery");

    expect(getToolProfile(profile.profileId)).toEqual(beforeMutation);
    expect(listToolProfiles()[0]).toEqual(TOOL_CAPABILITY_PROFILES[0]);
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

  it("starts large-repo intelligence from high-level relation-aware primitives", () => {
    const profile = getToolProfile("large-repo-intelligence");

    expect(profile?.allowedTools.slice(5, 14)).toEqual([
      "project_onboard",
      "repo_intelligence_search",
      "repo_relation_query",
      "change_impact_analyze",
      "context_pack_generate",
      "test_plan_select",
      "verification_run",
      "record_evidence",
      "gate_request",
    ]);
    expect(profile?.allowedTools).toEqual(
      expect.arrayContaining(["repo_index_query", "durable_repo_index_query", "graph_node_semantic_search"]),
    );
    expect(profile?.requiredEvidence).toEqual(
      expect.arrayContaining(["repo_facts_fresh", "relation_paths", "impact_analysis", "verification_output"]),
    );
  });

  it("requires recovery tools to be allowed profile tools", () => {
    const base = TOOL_CAPABILITY_PROFILES[0]!;
    const invalid = validateToolProfiles(
      [{ ...base, recoveryTools: ["patch_rollback"], allowedTools: ["tool_layer_map"] }],
      TOOL_REGISTRY,
    );

    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain(
      "feature-implementation.recoveryTools must also be allowed: patch_rollback",
    );
  });

  it("reports duplicate tool entries in profile tool lists", () => {
    const base = TOOL_CAPABILITY_PROFILES[0]!;
    const invalid = validateToolProfiles(
      [
        {
          ...base,
          bootstrapTools: [...base.bootstrapTools, base.bootstrapTools[0]!],
          allowedTools: [...base.allowedTools, base.allowedTools[0]!],
          verificationGates: [...base.verificationGates, base.verificationGates[0]!],
          recoveryTools: [...base.recoveryTools, base.recoveryTools[0]!],
        },
      ],
      TOOL_REGISTRY,
    );

    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual([
      "feature-implementation.bootstrapTools contains duplicate tool: tool_layer_map",
      "feature-implementation.allowedTools contains duplicate tool: tool_layer_map",
      "feature-implementation.verificationGates contains duplicate tool: verification_run",
      "feature-implementation.recoveryTools contains duplicate tool: patch_status",
    ]);
  });

  it("reports unknown tool references across every profile tool list", () => {
    const base = TOOL_CAPABILITY_PROFILES[0]!;
    const invalid = validateToolProfiles(
      [
        { ...base, bootstrapTools: [...base.bootstrapTools, "ghost_bootstrap"] },
        { ...base, profileId: "bug-fix", allowedTools: [...base.allowedTools, "ghost_allowed"] },
        { ...base, profileId: "code-review", verificationGates: [...base.verificationGates, "ghost_gate"] },
        { ...base, profileId: "repo-onboarding", recoveryTools: [...base.recoveryTools, "ghost_recovery"] },
      ],
      TOOL_REGISTRY,
    );

    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        "feature-implementation.bootstrapTools references unknown tool: ghost_bootstrap",
        "bug-fix.allowedTools references unknown tool: ghost_allowed",
        "code-review.verificationGates references unknown tool: ghost_gate",
        "repo-onboarding.recoveryTools references unknown tool: ghost_recovery",
      ]),
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
        { ...base, profileId: "large-repo-intelligence", recoveryTools: ["patch_rollback"], allowedTools: ["tool_layer_map"] },
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
        "large-repo-intelligence.recoveryTools must also be allowed: patch_rollback",
      ]),
    );
  });
});
