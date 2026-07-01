import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { createInMemoryKernel } from "../src/kernel.js";
import { createWormholeMcpServer } from "../src/mcp-server.js";

describe("Wormhole MCP server", () => {
  it("creates an MCP server for the native tool surface", () => {
    const server = createWormholeMcpServer(createInMemoryKernel());
    const registeredTools = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    );
    const registeredToolMetadata = (server as unknown as {
      _registeredTools: Record<string, { description?: string }>;
    })._registeredTools;

    expect(server.isConnected()).toBe(false);
    expect(registeredTools).toEqual(
      expect.arrayContaining([
        "media_dependency_report",
        "media_ingest_pdf",
        "media_ingest_image",
        "shell_hook_plan",
        "shell_hook_install",
        "discovery_har_import",
        "discovery_openapi_import",
        "discovery_http_crawl",
        "discovery_browser_capture",
        "discovery_tool_spec_generate",
        "orchestration_trace_record",
        "orchestration_policy_train",
        "orchestration_policy_evaluate",
        "orchestration_policy_compare_baselines",
        "orchestration_policy_activate",
        "reasoning_trace_record",
        "reasoning_dataset_export",
        "reasoning_strategy_evaluate",
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
        "repo_native_pack_build",
        "feature_slice_query",
        "tool_layer_map",
        "tool_surface_audit",
        "tool_catalog_query",
        "next_best_tool",
        "mission_route",
        "agent_context_prepare",
        "ctx_pack_budget_review",
        "ctx_pack_refresh",
        "resume_record",
        "resume_checkpoint",
        "resume_validate",
        "resume_load",
        "lsp_feedback_replan",
        "symbol_context",
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
        "orchestration_policy_live_feedback",
        "mission_delta_replan",
        "repo_watch_start",
        "repo_watch_scan",
        "repo_watch_status",
        "repo_watch_stop",
        "repo_change_scan",
        "repo_activity_record",
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
        "repo_reachability_analyze",
        "code_smell_scan",
        "diff_scope_review",
        "test_quality_review",
        "coverage_delta_analyze",
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
        "change_impact_analyze",
        "repo_graph_refresh_incremental",
        "repo_graph_refresh_full",
        "repo_relation_query",
        "repo_intelligence_search",
        "state_maintenance_run",
        "state_maintenance_status",
        "state_maintenance_retry",
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
        "tool_exposure_profile",
        "tool_admission_review",
        "tool_profile_list",
        "tool_profile_get",
        "tool_search",
        "tool_promote",
        "tool_promotion_status",
        "workflow_start_feature",
        "workflow_fix_bug",
        "workflow_review_pr",
        "workflow_onboard_repo",
        "workflow_plan",
        "workflow_write_artifacts",
        "patch_checkpoint",
        "patch_apply",
        "patch_status",
        "patch_rollback",
      ]),
    );
    expect(registeredToolMetadata.python_sidecar_probe?.description).toContain(
      "required Python runtime",
    );
    expect(registeredToolMetadata.orchestration_policy_train?.description).toContain(
      "required Python runtime",
    );
    expect(registeredToolMetadata.repo_reachability_analyze?.description).toContain(
      "requires human approval",
    );
    expect(registeredToolMetadata.code_smell_scan?.description).toContain("changed-files-only");
    expect(registeredToolMetadata.symbol_context?.description).toContain("TypeScript LSP");
  });

  it("bounds symbol_context MCP schema enums and numeric controls", () => {
    const server = createWormholeMcpServer(createInMemoryKernel());
    const symbolContextTool = (server as unknown as {
      _registeredTools: Record<string, { inputSchema: z.ZodType }>;
    })._registeredTools.symbol_context;
    const schema = symbolContextTool.inputSchema;

    expect(schema.safeParse({ repoRoot: "/repo", referencesLimit: 0 }).success).toBe(true);
    expect(schema.safeParse({ repoRoot: "/repo", aspects: ["definition", "bogus"] }).success).toBe(false);
    expect(schema.safeParse({ repoRoot: "/repo", sessionMode: "sticky" }).success).toBe(false);
    expect(schema.safeParse({ repoRoot: "/repo", line: 0 }).success).toBe(false);
    expect(schema.safeParse({ repoRoot: "/repo", character: 0 }).success).toBe(false);
    expect(schema.safeParse({ repoRoot: "/repo", referencesLimit: -1 }).success).toBe(false);
    expect(schema.safeParse({ repoRoot: "/repo", startupTimeoutMs: 0 }).success).toBe(false);
    expect(schema.safeParse({ repoRoot: "/repo", requestTimeoutMs: 0 }).success).toBe(false);
  });

  it("exposes repo index traversal caps in MCP schemas", () => {
    const server = createWormholeMcpServer(createInMemoryKernel());
    const registeredTools = (server as unknown as {
      _registeredTools: Record<string, { inputSchema: z.ZodType }>;
    })._registeredTools;

    for (const toolName of ["repo_index_build", "durable_repo_index_refresh", "durable_index_manifest_refresh"]) {
      const schema = registeredTools[toolName]?.inputSchema;
      const shape = (schema as unknown as { shape: Record<string, unknown> }).shape;

      expect(Object.keys(shape)).toEqual(expect.arrayContaining(["maxDepth", "maxDirs", "maxElapsedMs"]));
      expect(
        schema.safeParse({
          repoRoot: "/repo",
          maxDepth: 0,
          maxDirs: 1,
          maxElapsedMs: 1,
        }).success,
      ).toBe(true);
      expect(schema.safeParse({ repoRoot: "/repo", maxDepth: -1 }).success).toBe(false);
      expect(schema.safeParse({ repoRoot: "/repo", maxDirs: 0 }).success).toBe(false);
      expect(schema.safeParse({ repoRoot: "/repo", maxElapsedMs: 0 }).success).toBe(false);
    }
  });

  it("exposes secret scan file caps in the MCP schema", () => {
    const server = createWormholeMcpServer(createInMemoryKernel());
    const secretScanTool = (server as unknown as {
      _registeredTools: Record<string, { inputSchema: z.ZodType }>;
    })._registeredTools.secret_scan;
    const shape = (secretScanTool.inputSchema as unknown as { shape: Record<string, unknown> }).shape;

    expect(Object.keys(shape)).toEqual(expect.arrayContaining(["maxFiles", "maxFileBytes"]));
    expect(
      secretScanTool.inputSchema.safeParse({
        repoRoot: "/repo",
        maxFiles: 1,
        maxFileBytes: 128,
      }).success,
      ).toBe(true);
    expect(secretScanTool.inputSchema.safeParse({ repoRoot: "/repo", maxFiles: 0 }).success).toBe(false);
    expect(secretScanTool.inputSchema.safeParse({ repoRoot: "/repo", maxFileBytes: 0 }).success).toBe(false);
  });
});
