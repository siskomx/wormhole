export const TOOL_PLANES = [
  "mission",
  "project",
  "context",
  "verification",
  "coordination",
  "runtime",
  "discovery",
  "policy",
  "generation",
  "behavior",
  "adapter",
] as const;

export const TOOL_PHASES = [
  "orient",
  "plan",
  "gather",
  "impact",
  "context",
  "act",
  "verify",
  "gate",
  "maintain",
  "research",
] as const;

export const TOOL_PACKS = [
  "core",
  "large-repo",
  "context",
  "verification",
  "coordination",
  "external-agents",
  "runtime-ops",
  "discovery",
  "tooling",
  "policy-lab",
  "behavior",
  "adapters",
] as const;

export const TOOL_RISKS = ["read", "write", "execute", "policy"] as const;

export type ToolPlane = (typeof TOOL_PLANES)[number];
export type ToolPhase = (typeof TOOL_PHASES)[number];
export type ToolPack = (typeof TOOL_PACKS)[number];
export type ToolRisk = (typeof TOOL_RISKS)[number];

export type ToolRegistryEntry = {
  name: string;
  plane: ToolPlane;
  phase: ToolPhase;
  pack: ToolPack;
  risk: ToolRisk;
  summary: string;
  inputs: string[];
};

export type ToolCatalogQueryInput = {
  plane?: ToolPlane;
  phase?: ToolPhase;
  pack?: ToolPack;
  risk?: ToolRisk;
  toolNames?: string[];
  limit?: number;
};

export type ToolCatalogQueryResult = {
  filters: ToolCatalogQueryInput;
  count: number;
  tools: ToolRegistryEntry[];
};

export type ToolLayerMap = {
  toolCount: number;
  entryTools: string[];
  compatibility: {
    defaultMode: "guided";
    fullToolSurfaceVisible: boolean;
    dynamicToolHiding: boolean;
  };
  planes: Array<{
    plane: ToolPlane;
    count: number;
    phases: Array<{
      phase: ToolPhase;
      count: number;
      packs: Array<{
        pack: ToolPack;
        count: number;
        tools: string[];
      }>;
    }>;
  }>;
};

const TOOL_NAMES = [
  "mission_start",
  "round_start",
  "record_evidence",
  "record_question",
  "update_question",
  "task_register",
  "task_status_report",
  "control_message",
  "control_ack",
  "task_inbox",
  "task_status",
  "gate_request",
  "emit_plan",
  "mission_status",
  "optimize_text",
  "optimization_apply",
  "optimization_retrieve",
  "ctx_record",
  "ctx_pack_query",
  "ctx_pack_create",
  "ctx_pack_budget_review",
  "ctx_pack_refresh",
  "ctx_pack_render",
  "cache_evidence",
  "schedule_tasks",
  "orchestration_plan_local",
  "orchestration_run_local",
  "reconcile_artifacts",
  "route_mission",
  "codex_adapter_config",
  "select_connector",
  "create_artifact",
  "render_workbench",
  "repo_index_build",
  "repo_index_query",
  "repo_index_explain",
  "repo_index_path",
  "repo_index_report",
  "agent_register",
  "agent_list",
  "agent_dispatch",
  "agent_dispatch_execute",
  "agent_status",
  "agent_complete",
  "agent_interrupt",
  "printing_press_register",
  "printing_press_list",
  "printing_press_select",
  "printing_press_register_agent",
  "printing_press_verify",
  "printing_press_run",
  "model_profile_register",
  "model_profile_select",
  "model_profile_record_outcome",
  "model_profile_export_traces",
  "python_sidecar_probe",
  "python_graph_metrics",
  "python_graph_communities",
  "python_trace_summary",
  "media_dependency_report",
  "media_ingest_pdf",
  "media_ingest_image",
  "shell_hook_discover",
  "shell_hook_plan",
  "shell_hook_install",
  "shell_hook_uninstall",
  "shell_hook_verify",
  "discovery_har_import",
  "discovery_openapi_import",
  "discovery_http_crawl",
  "discovery_browser_capture",
  "discovery_tool_spec_generate",
  "repo_graph_export",
  "repo_watch_start",
  "repo_watch_scan",
  "repo_watch_status",
  "repo_watch_stop",
  "repo_change_scan",
  "repo_activity_record",
  "repo_graph_refresh_incremental",
  "project_contract_detect",
  "dependency_inventory",
  "project_command_map",
  "diagnostics_from_command",
  "diagnostics_from_lsp",
  "diagnostics_record",
  "diagnostics_query",
  "lsp_feedback_replan",
  "impact_analyze",
  "test_plan_select",
  "verification_run",
  "secret_scan",
  "operation_risk_review",
  "semantic_index_build",
  "semantic_search",
  "lsp_probe",
  "lsp_server_configs",
  "lsp_normalize_location",
  "project_onboard",
  "architecture_map",
  "entrypoint_flow_discover",
  "blast_radius_analyze",
  "context_pack_generate",
  "project_intelligence_snapshot",
  "tool_layer_map",
  "tool_catalog_query",
  "next_best_tool",
  "mission_route",
  "agent_context_prepare",
  "mission_delta_replan",
  "durable_repo_index_refresh",
  "durable_index_status",
  "durable_semantic_index_refresh",
  "durable_semantic_search",
  "test_impact_analyze_v2",
  "dependency_security_report",
  "action_policy_review",
  "patch_checkpoint",
  "patch_apply",
  "patch_status",
  "patch_rollback",
  "agent_remit_create",
  "agent_capability_inventory",
  "agent_behavior_verify",
  "remit_coverage_report",
  "agent_drift_analyze",
  "behavior_findings_render",
  "agent_workspace_create",
  "agent_workspace_write",
  "agent_workspace_read",
  "agent_workspace_merge",
  "lsp_session_start",
  "lsp_session_list",
  "lsp_session_status",
  "lsp_session_request",
  "lsp_session_stop",
  "optimization_adapter_register",
  "optimization_adapter_list",
  "optimization_adapter_select",
  "optimization_adapter_run",
  "optimized_command_run",
  "optimization_stats",
  "tool_factory_generate",
  "tool_factory_validate",
  "tool_factory_write",
  "conductor_plan",
  "conductor_replay",
  "behavior_mode_set",
  "behavior_mode_get",
  "behavior_apply",
  "behavior_minimality_review",
  "orchestration_trace_record",
  "orchestration_dataset_export",
  "orchestration_policy_train",
  "orchestration_policy_evaluate",
  "orchestration_policy_compare_baselines",
  "orchestration_policy_activate",
  "orchestration_policy_get",
  "orchestration_policy_live_feedback",
  "reasoning_trace_record",
  "reasoning_dataset_export",
  "reasoning_strategy_evaluate",
] as const;

const ENTRY_TOOLS = [
  "tool_layer_map",
  "tool_catalog_query",
  "next_best_tool",
  "mission_route",
  "agent_context_prepare",
];

const TOOL_OVERRIDES: Record<string, Partial<ToolRegistryEntry>> = {
  tool_layer_map: {
    plane: "mission",
    phase: "orient",
    pack: "core",
    risk: "read",
    summary: "Show the layered Wormhole tool map before browsing the full tool surface.",
    inputs: ["none"],
  },
  tool_catalog_query: {
    plane: "mission",
    phase: "orient",
    pack: "core",
    risk: "read",
    summary: "Query Wormhole tool metadata by structured filters such as plane, phase, pack, risk, or name.",
    inputs: ["plane", "phase", "pack", "risk", "toolNames", "limit"],
  },
  next_best_tool: { plane: "mission", phase: "orient", pack: "core", risk: "read" },
  mission_route: { plane: "mission", phase: "plan", pack: "core", risk: "read" },
  agent_context_prepare: { plane: "mission", phase: "context", pack: "core", risk: "read" },
  project_onboard: { plane: "project", phase: "orient", pack: "large-repo", risk: "read" },
  architecture_map: { plane: "project", phase: "orient", pack: "large-repo", risk: "read" },
  entrypoint_flow_discover: { plane: "project", phase: "orient", pack: "large-repo", risk: "read" },
  project_intelligence_snapshot: {
    plane: "project",
    phase: "orient",
    pack: "large-repo",
    risk: "read",
  },
  blast_radius_analyze: { plane: "project", phase: "impact", pack: "large-repo", risk: "read" },
  context_pack_generate: { plane: "context", phase: "context", pack: "context", risk: "read" },
  repo_watch_scan: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Scan an existing repo watch session and optionally record evidence or refresh graph state.",
    inputs: ["watchId"],
  },
  lsp_feedback_replan: {
    plane: "project",
    phase: "impact",
    pack: "large-repo",
    risk: "write",
    summary: "Record LSP diagnostics and produce a mission replan from changed diagnostic scope.",
    inputs: ["diagnostics", "repoRoot or missionId", "objective", "changedFiles"],
  },
  patch_checkpoint: {
    plane: "verification",
    phase: "act",
    pack: "verification",
    risk: "write",
    summary: "Create a repo-confined checkpoint before applying a reversible patch transaction.",
    inputs: ["repoRoot", "files", "label"],
  },
  patch_apply: {
    plane: "verification",
    phase: "act",
    pack: "verification",
    risk: "write",
    summary: "Apply a git-style unified diff with rollback metadata and optional verification commands.",
    inputs: ["repoRoot", "checkpointId", "unifiedDiff", "verificationCommands"],
  },
  patch_status: {
    plane: "verification",
    phase: "maintain",
    pack: "verification",
    risk: "read",
    summary: "List patch checkpoints and transactions without returning captured file contents.",
    inputs: ["repoRoot", "checkpointId", "transactionId"],
  },
  patch_rollback: {
    plane: "verification",
    phase: "act",
    pack: "verification",
    risk: "write",
    summary: "Restore files from a captured patch transaction snapshot.",
    inputs: ["repoRoot", "transactionId"],
  },
};

export const TOOL_REGISTRY: ToolRegistryEntry[] = TOOL_NAMES.map((name) => createRegistryEntry(name));

export function validateToolRegistry(registry: ToolRegistryEntry[] = TOOL_REGISTRY): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const tool of registry) {
    if (seen.has(tool.name)) {
      errors.push(`Duplicate tool registry entry: ${tool.name}`);
    }
    seen.add(tool.name);
    if (!tool.name) {
      errors.push("Tool registry entry is missing a name");
    }
    if (!TOOL_PLANES.includes(tool.plane)) {
      errors.push(`${tool.name} has invalid plane: ${tool.plane}`);
    }
    if (!TOOL_PHASES.includes(tool.phase)) {
      errors.push(`${tool.name} has invalid phase: ${tool.phase}`);
    }
    if (!TOOL_PACKS.includes(tool.pack)) {
      errors.push(`${tool.name} has invalid pack: ${tool.pack}`);
    }
    if (!TOOL_RISKS.includes(tool.risk)) {
      errors.push(`${tool.name} has invalid risk: ${tool.risk}`);
    }
    if (!tool.summary.trim()) {
      errors.push(`${tool.name} is missing a summary`);
    }
    if (tool.inputs.length === 0) {
      errors.push(`${tool.name} is missing input metadata`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function toolLayerMap(registry: ToolRegistryEntry[] = TOOL_REGISTRY): ToolLayerMap {
  return {
    toolCount: registry.length,
    entryTools: [...ENTRY_TOOLS],
    compatibility: {
      defaultMode: "guided",
      fullToolSurfaceVisible: true,
      dynamicToolHiding: false,
    },
    planes: groupByPlane(registry),
  };
}

export function queryToolCatalog(
  input: ToolCatalogQueryInput = {},
  registry: ToolRegistryEntry[] = TOOL_REGISTRY,
): ToolCatalogQueryResult {
  const requestedNames = input.toolNames ? new Set(input.toolNames) : undefined;
  const limit = input.limit && input.limit > 0 ? input.limit : registry.length;
  const tools = registry
    .filter((tool) => !input.plane || tool.plane === input.plane)
    .filter((tool) => !input.phase || tool.phase === input.phase)
    .filter((tool) => !input.pack || tool.pack === input.pack)
    .filter((tool) => !input.risk || tool.risk === input.risk)
    .filter((tool) => !requestedNames || requestedNames.has(tool.name))
    .slice(0, limit);
  return {
    filters: input,
    count: tools.length,
    tools,
  };
}

function createRegistryEntry(name: string): ToolRegistryEntry {
  const inferred = inferMetadata(name);
  const override = TOOL_OVERRIDES[name] ?? {};
  const entry = {
    name,
    ...inferred,
    ...override,
  };
  return {
    ...entry,
    summary: entry.summary ?? createSummary(name, entry.plane, entry.phase),
    inputs: entry.inputs ?? inferInputs(name),
  };
}

function inferMetadata(name: string): Omit<ToolRegistryEntry, "name" | "summary" | "inputs"> {
  if (name.startsWith("ctx_") || name === "cache_evidence") {
    return { plane: "context", phase: "context", pack: "context", risk: riskFor(name) };
  }
  if (
    name.startsWith("repo_") ||
    name.startsWith("project_") ||
    name.startsWith("durable_") ||
    name.startsWith("semantic_") ||
    name.startsWith("lsp_") ||
    name.startsWith("diagnostics_")
  ) {
    return { plane: "project", phase: phaseForProjectTool(name), pack: "large-repo", risk: riskFor(name) };
  }
  if (
    name.startsWith("test_") ||
    name.startsWith("verification_") ||
    name.startsWith("secret_") ||
    name.startsWith("operation_") ||
    name.startsWith("dependency_") ||
    name.startsWith("impact_") ||
    name.startsWith("action_policy_")
  ) {
    return { plane: "verification", phase: "verify", pack: "verification", risk: riskFor(name) };
  }
  if (
    name.startsWith("agent_workspace_") ||
    name.startsWith("task_") ||
    name.startsWith("control_") ||
    name.startsWith("schedule_") ||
    name.startsWith("reconcile_")
  ) {
    return { plane: "coordination", phase: "maintain", pack: "coordination", risk: riskFor(name) };
  }
  if (
    name.startsWith("agent_") ||
    name.startsWith("printing_press_") ||
    name.startsWith("model_profile_") ||
    name.startsWith("codex_") ||
    name.startsWith("select_connector")
  ) {
    return { plane: "adapter", phase: phaseForAdapterTool(name), pack: "external-agents", risk: riskFor(name) };
  }
  if (
    name.startsWith("python_") ||
    name.startsWith("media_") ||
    name.startsWith("shell_") ||
    name.startsWith("optimization_") ||
    name.startsWith("optimized_") ||
    name === "optimize_text"
  ) {
    return { plane: "runtime", phase: phaseForRuntimeTool(name), pack: "runtime-ops", risk: riskFor(name) };
  }
  if (name.startsWith("discovery_")) {
    return { plane: "discovery", phase: "gather", pack: "discovery", risk: riskFor(name) };
  }
  if (name.startsWith("tool_factory_") || name.startsWith("create_") || name.startsWith("render_")) {
    return { plane: "generation", phase: "act", pack: "tooling", risk: riskFor(name) };
  }
  if (name.startsWith("orchestration_policy_") || name.startsWith("orchestration_trace_")) {
    return { plane: "policy", phase: "research", pack: "policy-lab", risk: riskFor(name) };
  }
  if (name.startsWith("reasoning_") || name.startsWith("conductor_")) {
    return { plane: "policy", phase: "research", pack: "policy-lab", risk: riskFor(name) };
  }
  if (name.startsWith("behavior_")) {
    return { plane: "behavior", phase: "maintain", pack: "behavior", risk: riskFor(name) };
  }
  if (
    name.startsWith("mission_") ||
    name.startsWith("round_") ||
    name.startsWith("record_") ||
    name.startsWith("update_") ||
    name.startsWith("gate_") ||
    name.startsWith("emit_") ||
    name.startsWith("route_") ||
    name.startsWith("orchestration_")
  ) {
    return { plane: "mission", phase: phaseForMissionTool(name), pack: "core", risk: riskFor(name) };
  }
  return { plane: "mission", phase: "orient", pack: "core", risk: riskFor(name) };
}

function phaseForProjectTool(name: string): ToolPhase {
  if (name.includes("watch") || name.includes("refresh") || name.includes("activity") || name.includes("status")) {
    return "maintain";
  }
  if (name.includes("change") || name.includes("feedback") || name.includes("diagnostics")) {
    return "impact";
  }
  if (name.includes("query") || name.includes("search") || name.includes("explain") || name.includes("path")) {
    return "gather";
  }
  return "orient";
}

function phaseForAdapterTool(name: string): ToolPhase {
  if (name.includes("dispatch") || name.includes("run") || name.includes("complete") || name.includes("interrupt")) {
    return "act";
  }
  if (name.includes("status") || name.includes("list") || name.includes("select")) {
    return "gather";
  }
  return "plan";
}

function phaseForRuntimeTool(name: string): ToolPhase {
  if (name.includes("run") || name.includes("install") || name.includes("uninstall") || name.includes("ingest")) {
    return "act";
  }
  if (name.includes("verify") || name.includes("probe") || name.includes("dependency")) {
    return "verify";
  }
  return "gather";
}

function phaseForMissionTool(name: string): ToolPhase {
  if (name.startsWith("record_") || name.startsWith("round_")) {
    return "gather";
  }
  if (name.startsWith("gate_") || name.startsWith("emit_")) {
    return "gate";
  }
  if (name.includes("status")) {
    return "maintain";
  }
  return "plan";
}

function riskFor(name: string): ToolRisk {
  if (
    name.includes("run") ||
    name.includes("execute") ||
    name.includes("dispatch") ||
    name.includes("install") ||
    name.includes("uninstall")
  ) {
    return "execute";
  }
  if (name.includes("policy") || name.includes("risk") || name.includes("remit") || name.includes("behavior")) {
    return "policy";
  }
  if (
    name.includes("record") ||
    name.includes("register") ||
    name.includes("create") ||
    name.includes("write") ||
    name.includes("refresh") ||
    name.includes("activate") ||
    name.includes("apply") ||
    name.includes("complete") ||
    name.includes("interrupt") ||
    name.includes("start") ||
    name.includes("stop")
  ) {
    return "write";
  }
  return "read";
}

function inferInputs(name: string): string[] {
  if (name === "tool_layer_map" || name.endsWith("_list") || name.endsWith("_get") || name.endsWith("_stats")) {
    return ["none"];
  }
  if (
    name.includes("repo") ||
    name.includes("project") ||
    name.includes("architecture") ||
    name.includes("entrypoint") ||
    name.includes("blast") ||
    name.includes("impact") ||
    name.includes("dependency") ||
    name.startsWith("lsp_")
  ) {
    return ["repoRoot"];
  }
  if (
    name.includes("mission") ||
    name.startsWith("record_") ||
    name.startsWith("round_") ||
    name.startsWith("gate_") ||
    name.startsWith("emit_") ||
    name.startsWith("task_") ||
    name.startsWith("control_")
  ) {
    return ["missionId"];
  }
  return ["structured input"];
}

function createSummary(name: string, plane: ToolPlane, phase: ToolPhase): string {
  const label = name.replace(/_/g, " ");
  return `Use ${label} in the ${plane} plane for ${phase} phase work.`;
}

function groupByPlane(registry: ToolRegistryEntry[]): ToolLayerMap["planes"] {
  return TOOL_PLANES.map((plane) => {
    const planeTools = registry.filter((tool) => tool.plane === plane);
    return {
      plane,
      count: planeTools.length,
      phases: TOOL_PHASES.map((phase) => {
        const phaseTools = planeTools.filter((tool) => tool.phase === phase);
        return {
          phase,
          count: phaseTools.length,
          packs: TOOL_PACKS.map((pack) => {
            const packTools = phaseTools.filter((tool) => tool.pack === pack);
            return {
              pack,
              count: packTools.length,
              tools: packTools.map((tool) => tool.name),
            };
          }).filter((pack) => pack.count > 0),
        };
      }).filter((phase) => phase.count > 0),
    };
  }).filter((plane) => plane.count > 0);
}
