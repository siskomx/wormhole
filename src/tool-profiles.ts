import type { ToolRegistryEntry } from "./tool-registry.js";

export const TOOL_PROFILE_IDS = [
  "feature-implementation",
  "bug-fix",
  "code-review",
  "repo-onboarding",
  "large-repo-intelligence",
] as const;

export type ToolProfileId = (typeof TOOL_PROFILE_IDS)[number];

export type ToolCapabilityProfile = {
  readonly profileId: ToolProfileId;
  readonly label: string;
  readonly description: string;
  readonly bootstrapTools: readonly string[];
  readonly allowedTools: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly verificationGates: readonly string[];
  readonly recoveryTools: readonly string[];
};

export type ToolProfileValidation = {
  valid: boolean;
  errors: string[];
};

const PLANNED_TOOL_PROFILE_TOOLS = new Set([
  "tool_profile_list",
  "tool_profile_get",
  "tool_search",
  "tool_promote",
  "tool_promotion_status",
]);

export const TOOL_CAPABILITY_PROFILES = freezeProfiles([
  {
    profileId: "feature-implementation",
    label: "Feature Implementation",
    description:
      "Guided implementation profile for scoped feature work that needs repo orientation, patching, verification, evidence, and gate review.",
    bootstrapTools: ["tool_layer_map", "tool_profile_list", "tool_search", "tool_admission_review"],
    allowedTools: [
      "tool_layer_map",
      "tool_profile_list",
      "tool_profile_get",
      "tool_search",
      "tool_admission_review",
      "workflow_start_feature",
      "mission_route",
      "agent_context_prepare",
      "project_onboard",
      "repo_native_pack_build",
      "feature_slice_query",
      "context_pack_generate",
      "ctx_pack_query",
      "ctx_pack_create",
      "impact_analyze",
      "test_plan_select",
      "action_policy_review",
      "diff_scope_review",
      "test_quality_review",
      "patch_checkpoint",
      "patch_apply",
      "patch_status",
      "patch_rollback",
      "verification_run",
      "coverage_delta_analyze",
      "docs_sync_check",
      "record_evidence",
      "gate_request",
      "mission_delta_replan",
      "resume_checkpoint",
      "resume_load",
      "git_lifecycle_status",
    ],
    requiredEvidence: ["source_paths", "implementation_diff", "verification_output", "gate_decision"],
    verificationGates: ["verification_run", "gate_request"],
    recoveryTools: ["patch_status", "patch_rollback", "mission_delta_replan", "resume_load"],
  },
  {
    profileId: "bug-fix",
    label: "Bug Fix",
    description:
      "Reproduction-first repair profile for diagnostics, impact analysis, minimal patching, regression verification, and gate review.",
    bootstrapTools: ["tool_layer_map", "tool_profile_list", "tool_search", "tool_admission_review"],
    allowedTools: [
      "tool_layer_map",
      "tool_profile_list",
      "tool_profile_get",
      "tool_search",
      "tool_admission_review",
      "workflow_fix_bug",
      "mission_route",
      "agent_context_prepare",
      "project_onboard",
      "context_pack_generate",
      "diagnostics_from_command",
      "diagnostics_from_lsp",
      "diagnostics_record",
      "diagnostics_query",
      "lsp_feedback_replan",
      "impact_analyze",
      "test_impact_analyze_v2",
      "test_plan_select",
      "action_policy_review",
      "diff_scope_review",
      "test_quality_review",
      "patch_checkpoint",
      "patch_apply",
      "patch_status",
      "patch_rollback",
      "verification_run",
      "record_evidence",
      "gate_request",
      "mission_delta_replan",
      "resume_checkpoint",
      "resume_load",
    ],
    requiredEvidence: ["reproduction", "diagnostics", "source_paths", "verification_output", "gate_decision"],
    verificationGates: ["verification_run", "gate_request"],
    recoveryTools: ["patch_status", "patch_rollback", "mission_delta_replan", "resume_load"],
  },
  {
    profileId: "code-review",
    label: "Code Review",
    description:
      "Read-only review profile for diff scope, test quality, security, dependency, documentation, and completion-gate analysis.",
    bootstrapTools: ["tool_layer_map", "tool_profile_list", "tool_search", "tool_admission_review"],
    allowedTools: [
      "tool_layer_map",
      "tool_profile_list",
      "tool_profile_get",
      "tool_search",
      "tool_admission_review",
      "workflow_review_pr",
      "mission_route",
      "agent_context_prepare",
      "project_onboard",
      "context_pack_generate",
      "impact_analyze",
      "test_impact_analyze_v2",
      "diff_scope_review",
      "test_quality_review",
      "coverage_delta_analyze",
      "dependency_security_report",
      "dependency_risk_report",
      "docs_sync_check",
      "workspace_graph_analyze",
      "repo_reachability_analyze",
      "code_smell_scan",
      "source_conflicts_analyze",
      "gate_request",
      "git_lifecycle_status",
      "resume_load",
    ],
    requiredEvidence: ["changed_files", "diff_findings", "risk_assessment", "gate_decision"],
    verificationGates: ["gate_request"],
    recoveryTools: ["resume_load"],
  },
  {
    profileId: "repo-onboarding",
    label: "Repo Onboarding",
    description:
      "Repository orientation profile for discovering project shape, commands, entrypoints, architecture, and starter context.",
    bootstrapTools: ["tool_layer_map", "tool_profile_list", "tool_search"],
    allowedTools: [
      "tool_layer_map",
      "tool_profile_list",
      "tool_profile_get",
      "tool_search",
      "tool_catalog_query",
      "tool_exposure_profile",
      "workflow_onboard_repo",
      "mission_route",
      "project_onboard",
      "project_intelligence_snapshot",
      "project_command_map",
      "architecture_map",
      "entrypoint_flow_discover",
      "repo_native_pack_build",
      "repo_index_query",
      "repo_index_explain",
      "repo_graph_analyze",
      "workspace_graph_analyze",
      "repo_reachability_analyze",
      "context_pack_generate",
      "source_conflicts_analyze",
      "record_evidence",
      "gate_request",
      "resume_checkpoint",
      "resume_load",
    ],
    requiredEvidence: ["repo_map", "entrypoints", "project_commands", "source_paths", "gate_decision"],
    verificationGates: ["gate_request"],
    recoveryTools: ["resume_checkpoint", "resume_load"],
  },
  {
    profileId: "large-repo-intelligence",
    label: "Large Repo Intelligence",
    description:
      "Large-repository intelligence profile for durable indexing, semantic and domain queries, graph communities, flows, and context packs.",
    bootstrapTools: ["tool_layer_map", "tool_profile_list", "tool_search", "tool_admission_review"],
    allowedTools: [
      "tool_layer_map",
      "tool_profile_list",
      "tool_profile_get",
      "tool_search",
      "tool_admission_review",
      "project_onboard",
      "project_intelligence_snapshot",
      "repo_index_build",
      "repo_index_query",
      "repo_index_explain",
      "repo_index_path",
      "repo_index_report",
      "repo_graph_analyze",
      "graph_communities_refresh",
      "list_communities",
      "get_community",
      "get_surprising_connections",
      "graph_wiki_generate",
      "graph_node_semantic_index_refresh",
      "graph_node_semantic_search",
      "flows_refresh",
      "list_flows",
      "get_flow",
      "durable_repo_index_refresh",
      "durable_index_status",
      "durable_index_manifest_refresh",
      "durable_index_manifest_status",
      "durable_repo_index_query",
      "domain_index_refresh",
      "domain_index_status",
      "domain_manifest_generate",
      "domain_manifest_diff",
      "domain_manifest_status",
      "domain_slice_query",
      "domain_api_query",
      "domain_table_query",
      "domain_index_coverage",
      "domain_index_drift",
      "durable_semantic_index_refresh",
      "durable_semantic_search",
      "context_pack_generate",
      "workspace_graph_analyze",
      "repo_reachability_analyze",
      "source_conflicts_analyze",
      "record_evidence",
      "gate_request",
      "mission_delta_replan",
      "resume_checkpoint",
      "resume_load",
    ],
    requiredEvidence: ["index_status", "source_paths", "semantic_results", "domain_results", "gate_decision"],
    verificationGates: ["gate_request"],
    recoveryTools: ["durable_index_status", "domain_index_status", "mission_delta_replan", "resume_load"],
  },
]);

export function listToolProfiles(): ToolCapabilityProfile[] {
  return TOOL_CAPABILITY_PROFILES.map((profile) => cloneProfile(profile));
}

export function getToolProfile(profileId: ToolProfileId): ToolCapabilityProfile | undefined {
  const profile = TOOL_CAPABILITY_PROFILES.find((candidate) => candidate.profileId === profileId);
  return profile ? cloneProfile(profile) : undefined;
}

export function validateToolProfiles(
  profiles: readonly ToolCapabilityProfile[],
  registry: readonly ToolRegistryEntry[],
): ToolProfileValidation {
  const errors: string[] = [];
  const registryTools = new Set(registry.map((tool) => tool.name));
  const seenProfiles = new Set<string>();

  for (const profile of profiles) {
    if (seenProfiles.has(profile.profileId)) {
      errors.push(`Duplicate tool profile: ${profile.profileId}`);
    }
    seenProfiles.add(profile.profileId);

    validateToolList(profile, "bootstrapTools", registryTools, errors);
    validateToolList(profile, "allowedTools", registryTools, errors);
    validateToolList(profile, "verificationGates", registryTools, errors);
    validateToolList(profile, "recoveryTools", registryTools, errors);
    validateIncluded(profile, "bootstrapTools", "allowedTools", errors);
    validateIncluded(profile, "verificationGates", "allowedTools", errors);
    validateIncluded(profile, "recoveryTools", "allowedTools", errors);
  }

  return { valid: errors.length === 0, errors };
}

type ToolListField = "bootstrapTools" | "allowedTools" | "verificationGates" | "recoveryTools";

function cloneProfile(profile: ToolCapabilityProfile): ToolCapabilityProfile {
  return {
    ...profile,
    bootstrapTools: [...profile.bootstrapTools],
    allowedTools: [...profile.allowedTools],
    requiredEvidence: [...profile.requiredEvidence],
    verificationGates: [...profile.verificationGates],
    recoveryTools: [...profile.recoveryTools],
  };
}

function freezeProfiles(profiles: ToolCapabilityProfile[]): readonly ToolCapabilityProfile[] {
  for (const profile of profiles) {
    Object.freeze(profile.bootstrapTools);
    Object.freeze(profile.allowedTools);
    Object.freeze(profile.requiredEvidence);
    Object.freeze(profile.verificationGates);
    Object.freeze(profile.recoveryTools);
    Object.freeze(profile);
  }
  return Object.freeze(profiles);
}

function validateToolList(
  profile: ToolCapabilityProfile,
  field: ToolListField,
  registryTools: Set<string>,
  errors: string[],
): void {
  const seenTools = new Set<string>();
  for (const toolName of profile[field]) {
    if (seenTools.has(toolName)) {
      errors.push(`${profile.profileId}.${field} contains duplicate tool: ${toolName}`);
    }
    seenTools.add(toolName);

    if (!registryTools.has(toolName) && !PLANNED_TOOL_PROFILE_TOOLS.has(toolName)) {
      errors.push(`${profile.profileId}.${field} references unknown tool: ${toolName}`);
    }
  }
}

function validateIncluded(
  profile: ToolCapabilityProfile,
  subsetField: "bootstrapTools" | "verificationGates" | "recoveryTools",
  supersetField: "allowedTools",
  errors: string[],
): void {
  const allowedTools = new Set(profile[supersetField]);
  for (const toolName of profile[subsetField]) {
    if (!allowedTools.has(toolName)) {
      errors.push(`${profile.profileId}.${subsetField} must also be allowed: ${toolName}`);
    }
  }
}
