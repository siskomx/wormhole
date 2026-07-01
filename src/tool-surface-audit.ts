import type { ToolExposureMode, ToolRegistryEntry } from "./tool-registry.js";

export type AdvisoryToolExposure = ToolExposureMode;

export type ToolSurfaceExposure = {
  tool: ToolRegistryEntry;
  availability: "guided" | "expert" | "catalog";
  mode: ToolExposureMode;
  hidden: boolean;
};

export type DuplicateCapabilityGroup = {
  groupId: string;
  capability: string;
  tools: string[];
  duplicateTools: string[];
  recommendedTool: string;
  recommendation: string;
};

export type ToolSurfaceAuditResult = {
  mode: ToolExposureMode;
  totalTools: number;
  exposures: ToolSurfaceExposure[];
  tiers: {
    guided: { toolNames: string[] };
    expert: { toolNames: string[] };
    catalog: { toolNames: string[] };
  };
  guidedToolCount: number;
  guidedTools: string[];
  expertTools: string[];
  catalogOnlyTools: string[];
  duplicateCapabilityGroups: DuplicateCapabilityGroup[];
  warnings: string[];
};

const GUIDED_TOOLS = new Set([
  "mission_start",
  "mission_status",
  "round_start",
  "project_onboard",
  "workflow_start_feature",
  "workflow_fix_bug",
  "workflow_review_pr",
  "workflow_onboard_repo",
  "workflow_write_artifacts",
  "mission_route",
  "agent_context_prepare",
  "repo_intelligence_search",
  "repo_relation_query",
  "change_impact_analyze",
  "context_pack_generate",
  "test_plan_select",
  "verification_run",
  "record_evidence",
  "gate_request",
  "secret_scan",
  "operation_risk_review",
  "diff_scope_review",
  "test_quality_review",
  "tool_layer_map",
  "tool_surface_audit",
  "tool_catalog_query",
  "tool_profile_list",
  "tool_profile_get",
  "tool_search",
  "tool_promote",
  "tool_promotion_status",
  "workflow_plan",
  "next_best_tool",
  "resume_record",
  "resume_checkpoint",
  "resume_validate",
  "resume_load",
  "state_maintenance_run",
  "state_maintenance_status",
  "state_maintenance_retry",
]);

const CATALOG_ONLY_TOOLS = new Set([
  "repo_index_query",
  "repo_index_explain",
  "repo_index_path",
  "repo_graph_analyze",
  "graph_node_semantic_search",
  "semantic_search",
  "durable_repo_index_query",
  "durable_semantic_search",
  "ctx_pack_create",
  "ctx_pack_refresh",
  "cache_evidence",
  "impact_analyze",
  "test_impact_analyze_v2",
  "blast_radius_analyze",
]);

const DUPLICATE_GROUPS = [
  duplicateGroup(
    "large-repo-search",
    "Search and retrieve large-repo context.",
    "repo_intelligence_search",
    ["repo_index_query", "durable_repo_index_query", "graph_node_semantic_search", "semantic_search"],
  ),
  duplicateGroup(
    "change-impact",
    "Analyze impacted files and focused tests.",
    "change_impact_analyze",
    ["impact_analyze", "test_impact_analyze_v2", "blast_radius_analyze"],
  ),
  duplicateGroup(
    "context-evidence-gate",
    "Create context and preserve evidence before gate checks.",
    "context_pack_generate",
    ["ctx_pack_create", "ctx_pack_refresh", "cache_evidence"],
  ),
];

export function auditToolSurface(input: { registry: readonly ToolRegistryEntry[] }): ToolSurfaceAuditResult {
  const exposures = input.registry.map((tool) => exposeTool(tool));
  const guidedTools = tierNames(exposures, "guided");
  const expertTools = tierNames(exposures, "expert");
  const catalogOnlyTools = tierNames(exposures, "catalog");
  const warnings = guidedTools.length > 80 ? ["Guided tier exceeds the advisory cap of 80 tools."] : [];

  return {
    mode: "guided",
    totalTools: input.registry.length,
    exposures,
    tiers: {
      guided: { toolNames: guidedTools },
      expert: { toolNames: expertTools },
      catalog: { toolNames: catalogOnlyTools },
    },
    guidedToolCount: guidedTools.length,
    guidedTools,
    expertTools,
    catalogOnlyTools,
    duplicateCapabilityGroups: DUPLICATE_GROUPS.map((group) => ({
      ...group,
      tools: [group.recommendedTool, ...group.duplicateTools],
    })),
    warnings,
  };
}

function exposeTool(tool: ToolRegistryEntry): ToolSurfaceExposure {
  const availability = classify(tool);
  return {
    tool,
    availability,
    mode: "guided",
    hidden: false,
  };
}

function classify(tool: ToolRegistryEntry): ToolSurfaceExposure["availability"] {
  if (GUIDED_TOOLS.has(tool.name)) {
    return "guided";
  }
  if (CATALOG_ONLY_TOOLS.has(tool.name)) {
    return "catalog";
  }
  if (tool.risk === "write" || tool.risk === "execute" || tool.phase === "maintain" || tool.pack === "large-repo") {
    return "expert";
  }
  return "catalog";
}

function tierNames(exposures: ToolSurfaceExposure[], availability: ToolSurfaceExposure["availability"]): string[] {
  return exposures
    .filter((exposure) => exposure.availability === availability)
    .map((exposure) => exposure.tool.name);
}

function duplicateGroup(
  groupId: string,
  capability: string,
  recommendedTool: string,
  duplicateTools: string[],
): Omit<DuplicateCapabilityGroup, "tools"> {
  return {
    groupId,
    capability,
    recommendedTool,
    duplicateTools,
    recommendation: `Prefer ${recommendedTool} for guided flows; keep lower-level tools available through catalog search.`,
  };
}
