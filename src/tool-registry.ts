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
export const TOOL_EXPOSURE_MODES = ["full", "guided", "layered"] as const;

export type ToolPlane = (typeof TOOL_PLANES)[number];
export type ToolPhase = (typeof TOOL_PHASES)[number];
export type ToolPack = (typeof TOOL_PACKS)[number];
export type ToolRisk = (typeof TOOL_RISKS)[number];
export type ToolExposureMode = (typeof TOOL_EXPOSURE_MODES)[number];

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

export type ToolExposureProfileInput = {
  mode?: ToolExposureMode;
};

export type ToolExposureProfile = {
  mode: ToolExposureMode;
  fullToolSurfaceVisible: boolean;
  dynamicToolHiding: boolean;
  visibleTools: string[];
  hiddenToolCount: number;
  hiddenTools: string[];
  recommendedFor: string[];
};

export type ToolAdmissionApproval = "not_required" | "recommended" | "required";

export type ToolAdmissionDecision = {
  toolName: string;
  known: boolean;
  risk?: ToolRisk;
  approval: ToolAdmissionApproval;
  requiredPreflightTools: string[];
  reasons: string[];
};

export type ToolAdmissionReviewInput = {
  toolNames: string[];
};

export type ToolAdmissionReview = {
  approval: ToolAdmissionApproval;
  decisions: ToolAdmissionDecision[];
};

export type ToolLayerMap = {
  toolCount: number;
  entryTools: string[];
  compatibility: {
    defaultMode: "guided";
    activeMode: "guided";
    availableModes: ToolExposureMode[];
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
  "resume_record",
  "resume_checkpoint",
  "resume_validate",
  "resume_load",
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
  "repo_graph_analyze",
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
  "repo_watch_start",
  "repo_watch_scan",
  "repo_watch_status",
  "repo_watch_stop",
  "repo_change_scan",
  "repo_activity_record",
  "repo_graph_refresh_incremental",
  "repo_graph_refresh_full",
  "project_contract_detect",
  "source_conflicts_analyze",
  "capability_relation_audit",
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
  "repo_native_pack_build",
  "feature_slice_query",
  "blueprint_compile_repo",
  "blueprint_write_artifacts",
  "blueprint_gate_check",
  "app_process_compile",
  "app_process_write_artifacts",
  "app_process_validate",
  "app_process_gate_check",
  "app_process_status",
  "app_process_accept_section",
  "app_process_continue",
  "app_process_record_verification",
  "architecture_map",
  "entrypoint_flow_discover",
  "blast_radius_analyze",
  "context_pack_generate",
  "project_intelligence_snapshot",
  "tool_layer_map",
  "tool_exposure_profile",
  "tool_catalog_query",
  "tool_admission_review",
  "workflow_start_feature",
  "workflow_fix_bug",
  "workflow_review_pr",
  "workflow_onboard_repo",
  "workflow_write_artifacts",
  "next_best_tool",
  "mission_route",
  "agent_context_prepare",
  "state_maintenance_run",
  "state_maintenance_status",
  "state_maintenance_retry",
  "mission_delta_replan",
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
  "domain_manifest_apply",
  "domain_slice_query",
  "domain_api_query",
  "domain_table_query",
  "domain_index_coverage",
  "domain_index_drift",
  "domain_verification_gate_plan",
  "durable_semantic_index_refresh",
  "durable_semantic_search",
  "test_impact_analyze_v2",
  "dependency_security_report",
  "git_lifecycle_status",
  "git_branch_prepare",
  "git_branch_create",
  "git_commit_prepare",
  "git_commit_create",
  "git_pr_prepare",
  "git_conflict_analyze",
  "dependency_risk_report",
  "dependency_audit_live",
  "docs_sync_check",
  "workspace_graph_analyze",
  "code_smell_scan",
  "diff_scope_review",
  "test_quality_review",
  "coverage_delta_analyze",
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
  "runtime_behavior_audit",
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
  "tool_exposure_profile",
  "tool_catalog_query",
  "tool_admission_review",
  "workflow_start_feature",
  "workflow_fix_bug",
  "workflow_review_pr",
  "workflow_onboard_repo",
  "workflow_write_artifacts",
  "resume_record",
  "resume_checkpoint",
  "resume_validate",
  "resume_load",
  "next_best_tool",
  "mission_route",
  "agent_context_prepare",
  "app_process_status",
  "state_maintenance_run",
];

const TOOL_OVERRIDES: Record<string, Partial<ToolRegistryEntry>> = {
  gate_request: {
    plane: "mission",
    phase: "gate",
    pack: "core",
    risk: "read",
    summary: "Evaluate mission evidence, questions, source conflicts, and freshness signals before final claims.",
    inputs: ["missionId", "sourceConflicts", "freshness"],
  },
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
  tool_exposure_profile: {
    plane: "mission",
    phase: "orient",
    pack: "core",
    risk: "read",
    summary: "Describe full, guided, or layered tool exposure without changing the registered MCP surface.",
    inputs: ["mode"],
  },
  tool_admission_review: {
    plane: "policy",
    phase: "maintain",
    pack: "policy-lab",
    risk: "policy",
    summary: "Review selected tool names for advisory approval and preflight requirements before write or execute work.",
    inputs: ["toolNames"],
  },
  workflow_start_feature: {
    plane: "mission",
    phase: "plan",
    pack: "core",
    risk: "read",
    summary: "Return the golden-path feature implementation sequence instead of making agents choose peer tools.",
    inputs: ["repoRoot", "objective", "missionId", "changedFiles", "diffText"],
  },
  workflow_fix_bug: {
    plane: "mission",
    phase: "plan",
    pack: "core",
    risk: "read",
    summary: "Return the repro-first bugfix sequence with diagnostics, context, patch, verification, and gate guidance.",
    inputs: ["repoRoot", "objective", "diagnosticSource", "changedFiles", "diffText"],
  },
  workflow_review_pr: {
    plane: "mission",
    phase: "plan",
    pack: "core",
    risk: "read",
    summary: "Return the read-only PR review sequence with impact, security, verification, evidence, and gate guidance.",
    inputs: ["repoRoot", "objective", "changedFiles", "diffText"],
  },
  workflow_onboard_repo: {
    plane: "mission",
    phase: "orient",
    pack: "core",
    risk: "read",
    summary: "Return the repo onboarding sequence through project intelligence, context, tool exposure, and gate guidance.",
    inputs: ["repoRoot", "objective", "query", "missionId"],
  },
  workflow_write_artifacts: {
    plane: "mission",
    phase: "maintain",
    pack: "core",
    risk: "write",
    summary: "Write durable .wormhole workflow run state, resume, and latest pointer for an existing workflow kind.",
    inputs: [
      "workflow",
      "repoRoot",
      "objective",
      "query",
      "missionId",
      "changedFiles",
      "diffText",
      "diagnosticSource",
    ],
  },
  resume_record: {
    plane: "coordination",
    phase: "maintain",
    pack: "core",
    risk: "write",
    summary: "Record a material resume event so future chats can recover decisions, blockers, and next actions.",
    inputs: ["repoRoot", "objective", "kind", "summary", "missionId", "trust", "evidenceIds", "contextPackIds"],
  },
  resume_checkpoint: {
    plane: "coordination",
    phase: "maintain",
    pack: "core",
    risk: "write",
    summary: "Create a compact resume checkpoint and write .wormhole/resume artifacts.",
    inputs: ["repoRoot", "objective", "missionId", "reason", "maxRecords", "includeTrust"],
  },
  resume_validate: {
    plane: "coordination",
    phase: "verify",
    pack: "core",
    risk: "read",
    summary: "Validate resume checkpoint coverage against runtime evidence, context packs, and repo ground truth.",
    inputs: ["repoRoot", "requireCanonical"],
  },
  resume_load: {
    plane: "coordination",
    phase: "orient",
    pack: "core",
    risk: "read",
    summary: "Load the latest compact resume checkpoint and records for fresh-chat bootstrap.",
    inputs: ["repoRoot"],
  },
  next_best_tool: { plane: "mission", phase: "orient", pack: "core", risk: "read" },
  mission_route: { plane: "mission", phase: "plan", pack: "core", risk: "read" },
  agent_context_prepare: { plane: "mission", phase: "context", pack: "core", risk: "read" },
  state_maintenance_run: {
    plane: "coordination",
    phase: "maintain",
    pack: "coordination",
    risk: "write",
    summary:
      "Run graph refresh, context-pack refresh, source-conflict analysis, freshness checks, evidence recording, route refresh, and shared workspace updates as one audited maintenance pass.",
    inputs: [
      "repoRoot",
      "missionId",
      "objective",
      "changedFiles",
      "watchId",
      "sourceConflicts",
      "freshness",
      "context",
      "workspace",
    ],
  },
  state_maintenance_status: {
    plane: "coordination",
    phase: "maintain",
    pack: "coordination",
    risk: "read",
    summary: "Read durable state-maintenance run records, including partial failure status and actions.",
    inputs: ["runId", "status"],
  },
  state_maintenance_retry: {
    plane: "coordination",
    phase: "maintain",
    pack: "coordination",
    risk: "write",
    summary: "Retry a prior state-maintenance run from durable input with optional overrides.",
    inputs: ["runId", "overrides"],
  },
  project_onboard: { plane: "project", phase: "orient", pack: "large-repo", risk: "read" },
  repo_native_pack_build: {
    plane: "project",
    phase: "orient",
    pack: "large-repo",
    risk: "read",
    summary: "Build the repo-native coverage pack from existing Wormhole project intelligence and repo-local conventions.",
    inputs: ["repoRoot", "objective", "query", "changedFiles", "diffText", "limit"],
  },
  feature_slice_query: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "Return focused feature slices with routes, hooks, schema, tests, docs, side effects, and conflicts.",
    inputs: ["repoRoot", "query", "changedFiles", "limit"],
  },
  blueprint_compile_repo: {
    plane: "project",
    phase: "orient",
    pack: "core",
    risk: "read",
    summary: "Compile repo evidence into Wormhole blueprint, constraints, and coding-agent context; use progressive for a fast partial bootstrap.",
    inputs: ["repoRoot", "objective", "progressive"],
  },
  blueprint_write_artifacts: {
    plane: "project",
    phase: "maintain",
    pack: "core",
    risk: "write",
    summary: "Write .wormhole blueprint, constraints, agent-context, and optional progressive lane artifacts for coding agents.",
    inputs: ["repoRoot", "objective", "progressive"],
  },
  blueprint_gate_check: {
    plane: "project",
    phase: "gate",
    pack: "core",
    risk: "read",
    summary: "Check planned commands, source conflicts, freshness, and completion claims against a Wormhole constraints manifest.",
    inputs: ["constraints", "sourceConflicts", "freshness", "action"],
  },
  app_process_compile: {
    plane: "project",
    phase: "plan",
    pack: "core",
    risk: "read",
    summary: "Compile objective, repo blueprint, product definition, roadmap, backlog, architecture, UX, security, and verification into a provisional app-process bootstrap.",
    inputs: ["repoRoot", "objective"],
  },
  app_process_write_artifacts: {
    plane: "project",
    phase: "maintain",
    pack: "core",
    risk: "write",
    summary: "Write .wormhole app-process, product, roadmap, backlog, lane, and phase artifacts for coding agents.",
    inputs: ["repoRoot", "objective"],
  },
  app_process_validate: {
    plane: "project",
    phase: "verify",
    pack: "core",
    risk: "read",
    summary: "Validate a Wormhole app-process artifact before roadmap or implementation claims.",
    inputs: ["appProcess"],
  },
  app_process_gate_check: {
    plane: "project",
    phase: "gate",
    pack: "core",
    risk: "read",
    summary: "Check implementation and completion claims against provisional app-process sections, source conflicts, artifact freshness, and required verification.",
    inputs: ["appProcess", "sourceConflicts", "freshness", "artifactFreshness", "action"],
  },
  app_process_status: {
    plane: "project",
    phase: "maintain",
    pack: "core",
    risk: "read",
    summary: "Read app-process run state, blocked gates, next action, verification records, and artifact freshness.",
    inputs: ["repoRoot", "objective"],
  },
  app_process_accept_section: {
    plane: "project",
    phase: "maintain",
    pack: "core",
    risk: "write",
    summary: "Persist acceptance of one AI-drafted app-process section for future gate checks.",
    inputs: ["repoRoot", "section", "acceptedBy", "note"],
  },
  app_process_continue: {
    plane: "project",
    phase: "maintain",
    pack: "core",
    risk: "write",
    summary: "Advance exactly one bounded app-process continuation step and record the prepared story.",
    inputs: ["repoRoot"],
  },
  app_process_record_verification: {
    plane: "project",
    phase: "verify",
    pack: "core",
    risk: "write",
    summary: "Persist verification command evidence for app-process completion gates.",
    inputs: ["repoRoot", "command", "args", "status", "evidencePath", "summary"],
  },
  repo_index_build: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Build an in-memory repo graph with explicit default or large-repo indexing caps.",
    inputs: ["repoRoot", "preset", "include", "exclude", "maxFiles", "maxFileBytes", "maxTotalBytes"],
  },
  repo_graph_analyze: {
    plane: "project",
    phase: "impact",
    pack: "large-repo",
    risk: "read",
    summary:
      "Analyze the native repo graph for hubs, connector nodes, cycles, orphan symbols, disconnected files, parser coverage, and changed-file impact flows.",
    inputs: ["repoRoot", "changedFiles", "limit"],
  },
  graph_communities_refresh: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Compute and persist repo graph communities from the current native repo graph.",
    inputs: ["repoRoot"],
  },
  list_communities: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "List persisted repo graph communities for the current repo index.",
    inputs: ["repoRoot"],
  },
  get_community: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "Return files, symbols, and edge evidence for one persisted repo graph community.",
    inputs: ["repoRoot", "id"],
  },
  get_surprising_connections: {
    plane: "project",
    phase: "impact",
    pack: "large-repo",
    risk: "read",
    summary: "Rank cross-community repo graph connections with path and edge evidence.",
    inputs: ["repoRoot", "limit"],
  },
  graph_wiki_generate: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Render or write wiki-style Markdown pages from graph communities and execution flows.",
    inputs: ["repoRoot", "scope", "communityId", "flowId", "write"],
  },
  graph_node_semantic_index_refresh: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Persist a semantic fallback index scoped to graph files, symbols, communities, and flows.",
    inputs: ["repoRoot"],
  },
  graph_node_semantic_search: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "Search the persisted semantic fallback index for graph nodes only.",
    inputs: ["repoRoot", "query", "limit", "kinds"],
  },
  flows_refresh: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Persist named execution flows from discovered API, CLI, worker, and script entrypoints.",
    inputs: ["repoRoot"],
  },
  list_flows: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "List persisted named execution flows with optional kind and text filtering.",
    inputs: ["repoRoot", "kind", "query"],
  },
  get_flow: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "Return one persisted named execution flow by id or name.",
    inputs: ["repoRoot", "idOrName"],
  },
  architecture_map: { plane: "project", phase: "orient", pack: "large-repo", risk: "read" },
  source_conflicts_analyze: {
    plane: "project",
    phase: "orient",
    pack: "large-repo",
    risk: "read",
    summary:
      "Compare supporting docs and generated artifacts against current repo, package, and schema facts to surface validation conflicts.",
    inputs: ["repoRoot"],
  },
  capability_relation_audit: {
    plane: "project",
    phase: "orient",
    pack: "large-repo",
    risk: "read",
    summary: "Audit capability relation wiring across implemented capabilities, runtime tools, workflows, and tests.",
    inputs: ["allowlist"],
  },
  runtime_behavior_audit: {
    plane: "behavior",
    phase: "verify",
    pack: "behavior",
    risk: "read",
    summary:
      "Compare recommended Wormhole route tools against observed runtime calls and report skipped, failed, missing, or out-of-order guidance.",
    inputs: [
      "recommendedTools",
      "observedToolCalls",
      "requiredTools",
      "knownToolNames",
      "ignoredToolNames",
      "scope",
    ],
  },
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
  repo_graph_refresh_full: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Run the explicit full durable repo graph rebuild and report impact context for changed files.",
    inputs: ["repoRoot", "changedFiles", "diffText"],
  },
  durable_repo_index_refresh: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Refresh the durable SQLite repo index and JSON compatibility export with explicit default or large-repo caps.",
    inputs: ["repoRoot", "preset", "include", "exclude", "maxFiles", "maxFileBytes", "maxTotalBytes"],
  },
  durable_index_manifest_refresh: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Refresh the durable SQLite repo index plus index-of-indexes manifest and root/lane shard files for scalable repo queries.",
    inputs: ["repoRoot", "preset", "include", "exclude", "maxFiles", "maxFileBytes", "maxTotalBytes"],
  },
  durable_index_manifest_status: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "read",
    summary: "Read durable index manifest metadata and shard freshness without rebuilding indexes.",
    inputs: ["repoRoot"],
  },
  durable_repo_index_query: {
    plane: "project",
    phase: "orient",
    pack: "large-repo",
    risk: "read",
    summary: "Query the durable SQLite repo index by lane, with manifest shard and full JSON fallback.",
    inputs: ["repoRoot", "query", "lanes", "limit", "requireFresh"],
  },
  domain_index_refresh: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Refresh the SQLite domain index for feature/API/schema/convention/memory/gate coverage.",
    inputs: ["repoRoot"],
  },
  domain_index_status: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "read",
    summary: "Read domain index freshness, summary, warnings, and health status.",
    inputs: ["repoRoot"],
  },
  domain_manifest_generate: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "Generate a reviewable domain manifest candidate from generic repo evidence and preserved manual seeders.",
    inputs: ["repoRoot"],
  },
  domain_manifest_diff: {
    plane: "project",
    phase: "verify",
    pack: "large-repo",
    risk: "read",
    summary: "Compare current and generated domain manifest seeders with semantic operations and freshness hashes.",
    inputs: ["repoRoot"],
  },
  domain_manifest_status: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "read",
    summary: "Report domain manifest validity, pending seeder operations, warnings, and blockers without writing files.",
    inputs: ["repoRoot"],
  },
  domain_manifest_apply: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "write",
    summary: "Apply an approved domain manifest candidate with stale-hash protection, backup, and optional refresh.",
    inputs: ["repoRoot", "baseHash", "refreshAfterApply"],
  },
  domain_slice_query: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "Query a domain feature slice with API, schema, coverage, and verification gate facts.",
    inputs: ["repoRoot", "feature", "requireFresh"],
  },
  domain_api_query: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "Query domain API endpoints by feature, method, path template, or text.",
    inputs: ["repoRoot", "feature", "method", "pathTemplate", "query", "requireFresh"],
  },
  domain_table_query: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "Query folded domain schema tables, columns, indexes, foreign keys, and migrations.",
    inputs: ["repoRoot", "table", "feature", "requireFresh"],
  },
  domain_index_coverage: {
    plane: "project",
    phase: "verify",
    pack: "large-repo",
    risk: "read",
    summary: "List domain index coverage gaps for unowned APIs, missing OpenAPI, tables, and conflicts.",
    inputs: ["repoRoot", "severity", "kind", "requireFresh"],
  },
  domain_index_drift: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "read",
    summary: "Compare the stored domain index to the current repo and report added, removed, and changed files.",
    inputs: ["repoRoot"],
  },
  domain_verification_gate_plan: {
    plane: "verification",
    phase: "plan",
    pack: "large-repo",
    risk: "read",
    summary: "Return domain-specific verification gate scripts and commands by feature or gate id.",
    inputs: ["repoRoot", "gateId", "feature", "requireFresh"],
  },
  code_smell_scan: {
    plane: "verification",
    phase: "verify",
    pack: "verification",
    risk: "read",
    summary: "Scan changed code for potential dead code, complex functions, duplicate blocks, and needless dependencies.",
    inputs: ["repoRoot", "changedFiles", "diffText", "maxComplexity", "duplicateMinLines"],
  },
  diff_scope_review: {
    plane: "verification",
    phase: "verify",
    pack: "verification",
    risk: "read",
    summary: "Check whether diff files and hunks trace to the objective, evidence paths, or approved paths.",
    inputs: ["repoRoot", "objective", "diffText", "changedFiles", "evidence", "approvedPaths", "strict"],
  },
  test_quality_review: {
    plane: "verification",
    phase: "verify",
    pack: "verification",
    risk: "read",
    summary: "Review changed tests for missing assertions, skipped tests, snapshot-only tests, and missing test coverage.",
    inputs: ["repoRoot", "changedFiles"],
  },
  coverage_delta_analyze: {
    plane: "verification",
    phase: "verify",
    pack: "verification",
    risk: "read",
    summary: "Compare before and after coverage summaries and report coverage regressions.",
    inputs: ["before", "after", "failBelowDelta"],
  },
  git_lifecycle_status: {
    plane: "project",
    phase: "maintain",
    pack: "large-repo",
    risk: "read",
    summary: "Read git branch, HEAD, ahead/behind, staged, unstaged, and untracked lifecycle state.",
    inputs: ["repoRoot", "baseRef", "timeoutMs"],
  },
  git_branch_prepare: {
    plane: "project",
    phase: "plan",
    pack: "large-repo",
    risk: "read",
    summary: "Prepare a safe branch name from an objective without mutating git state.",
    inputs: ["objective", "prefix"],
  },
  git_branch_create: {
    plane: "project",
    phase: "act",
    pack: "large-repo",
    risk: "write",
    summary: "Create a validated git branch through the privileged action gate.",
    inputs: ["repoRoot", "branchName", "checkout", "timeoutMs"],
  },
  git_commit_prepare: {
    plane: "project",
    phase: "plan",
    pack: "large-repo",
    risk: "read",
    summary: "Prepare an advisory conventional commit message from objective and changed files.",
    inputs: ["repoRoot", "objective", "evidence"],
  },
  git_commit_create: {
    plane: "project",
    phase: "act",
    pack: "large-repo",
    risk: "write",
    summary: "Create a git commit for explicit safe repo-relative files without executing hooks.",
    inputs: ["repoRoot", "files", "message", "timeoutMs"],
  },
  git_pr_prepare: {
    plane: "project",
    phase: "plan",
    pack: "large-repo",
    risk: "read",
    summary: "Prepare provider-neutral pull request title, body, checklist, and command hints without network calls.",
    inputs: ["repoRoot", "baseRef", "objective"],
  },
  git_conflict_analyze: {
    plane: "project",
    phase: "impact",
    pack: "large-repo",
    risk: "read",
    summary: "Analyze unmerged git files and bounded conflict-marker evidence.",
    inputs: ["repoRoot", "timeoutMs", "maxFileBytes", "maxTotalBytes"],
  },
  dependency_risk_report: {
    plane: "verification",
    phase: "verify",
    pack: "verification",
    risk: "read",
    summary: "Combine local dependency license metadata with audit and outdated provider JSON.",
    inputs: ["repoRoot", "auditJson", "outdatedJson"],
  },
  dependency_audit_live: {
    plane: "verification",
    phase: "verify",
    pack: "verification",
    risk: "execute",
    summary: "Run bounded npm audit and outdated commands and parse dependency risk output.",
    inputs: ["repoRoot", "includeOutdated", "timeoutMs"],
  },
  docs_sync_check: {
    plane: "verification",
    phase: "gate",
    pack: "verification",
    risk: "read",
    summary: "Gate documentation freshness against source conflicts and public-surface changes.",
    inputs: ["repoRoot", "changedFiles", "diffText", "requireDocsForPublicChanges"],
  },
  workspace_graph_analyze: {
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "read",
    summary: "Analyze npm, pnpm, Cargo, and multi-root workspace package graphs.",
    inputs: ["repoRoot", "additionalRepoRoots"],
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
    summary:
      "Apply a git-style unified diff with rollback metadata, optional diff-scope enforcement, and optional verification commands.",
    inputs: ["repoRoot", "checkpointId", "unifiedDiff", "scopeReview", "verificationCommands"],
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
      activeMode: "guided",
      availableModes: [...TOOL_EXPOSURE_MODES],
      fullToolSurfaceVisible: true,
      dynamicToolHiding: false,
    },
    planes: groupByPlane(registry),
  };
}

const LAYERED_VISIBLE_TOOLS = [
  "mission_start",
  "mission_status",
  "round_start",
  "record_evidence",
  "record_question",
  "update_question",
  "gate_request",
  "tool_layer_map",
  "tool_exposure_profile",
  "tool_catalog_query",
  "tool_admission_review",
  "workflow_start_feature",
  "workflow_fix_bug",
  "workflow_review_pr",
  "workflow_onboard_repo",
  "workflow_write_artifacts",
  "resume_record",
  "resume_checkpoint",
  "resume_validate",
  "resume_load",
  "next_best_tool",
  "mission_route",
  "agent_context_prepare",
  "project_intelligence_snapshot",
  "repo_native_pack_build",
  "feature_slice_query",
  "app_process_status",
  "state_maintenance_run",
  "state_maintenance_status",
  "state_maintenance_retry",
];

export function toolExposureProfile(
  input: ToolExposureProfileInput = {},
  registry: ToolRegistryEntry[] = TOOL_REGISTRY,
): ToolExposureProfile {
  const mode = input.mode ?? "guided";
  const allTools = registry.map((tool) => tool.name);
  const visibleSet =
    mode === "layered"
      ? new Set(LAYERED_VISIBLE_TOOLS.filter((toolName) => allTools.includes(toolName)))
      : new Set(allTools);
  const visibleTools = allTools.filter((toolName) => visibleSet.has(toolName));
  const hiddenTools = allTools.filter((toolName) => !visibleSet.has(toolName));
  const fullToolSurfaceVisible = mode !== "layered";
  return {
    mode,
    fullToolSurfaceVisible,
    dynamicToolHiding: false,
    visibleTools,
    hiddenToolCount: hiddenTools.length,
    hiddenTools,
    recommendedFor:
      mode === "layered"
        ? [
            "new agents entering a large repo",
            "clients that want a small startup surface",
            "guided onboarding before specialist tools are selected",
          ]
        : mode === "guided"
          ? [
              "capable coding agents that can see all tools but should start from routing and catalog guidance",
              "default MCP compatibility without dynamic hiding",
            ]
          : ["debugging, audits, and clients that intentionally want the full MCP tool list"],
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

const PREFLIGHT_EXEMPT_TOOLS = new Set([
  "action_policy_review",
  "tool_admission_review",
  "patch_checkpoint",
  "patch_status",
  "shell_hook_plan",
  "shell_hook_verify",
  "tool_factory_validate",
]);

const ADMISSION_APPROVAL_RANK: Record<ToolAdmissionApproval, number> = {
  not_required: 0,
  recommended: 1,
  required: 2,
};

export function reviewToolAdmission(
  input: ToolAdmissionReviewInput,
  registry: ToolRegistryEntry[] = TOOL_REGISTRY,
): ToolAdmissionReview {
  const registryByName = new Map(registry.map((tool) => [tool.name, tool]));
  const decisions = input.toolNames.map((toolName): ToolAdmissionDecision => {
    const tool = registryByName.get(toolName);
    if (!tool) {
      return {
        toolName,
        known: false,
        approval: "required",
        requiredPreflightTools: ["action_policy_review"],
        reasons: ["Tool is not in the Wormhole registry; require explicit policy review before use."],
      };
    }

    if (tool.risk === "read" || PREFLIGHT_EXEMPT_TOOLS.has(tool.name)) {
      return {
        toolName,
        known: true,
        risk: tool.risk,
        approval: "not_required",
        requiredPreflightTools: [],
        reasons: [`${tool.name} is ${tool.risk} risk and can be called directly.`],
      };
    }

    const requiredPreflightTools = new Set<string>(["action_policy_review"]);
    const reasons = [`${tool.name} is ${tool.risk} risk and should be preflighted before use.`];

    if (tool.name === "patch_apply") {
      requiredPreflightTools.add("patch_checkpoint");
      requiredPreflightTools.add("diff_scope_review");
      reasons.push("Patch application should have a repo-confined checkpoint for rollback.");
      reasons.push("Patch application should review diff scope against the objective and evidence before writing.");
    }
    if (tool.name === "patch_rollback") {
      requiredPreflightTools.add("patch_status");
      reasons.push("Rollback should confirm transaction status before restoring files.");
    }
    if (tool.name === "shell_hook_install" || tool.name === "shell_hook_uninstall") {
      requiredPreflightTools.add("shell_hook_plan");
      reasons.push("Shell hook edits should be planned before profile files are changed.");
    }
    if (tool.name === "tool_factory_write") {
      requiredPreflightTools.add("tool_factory_validate");
      reasons.push("Generated tools should validate before files are written.");
    }

    return {
      toolName,
      known: true,
      risk: tool.risk,
      approval: "required",
      requiredPreflightTools: [...requiredPreflightTools],
      reasons,
    };
  });
  const approval = decisions.reduce<ToolAdmissionApproval>(
    (current, decision) =>
      ADMISSION_APPROVAL_RANK[decision.approval] > ADMISSION_APPROVAL_RANK[current]
        ? decision.approval
        : current,
    "not_required",
  );
  return { approval, decisions };
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
