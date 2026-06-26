import { describe, expect, it } from "vitest";
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
        "architecture_map",
        "entrypoint_flow_discover",
        "blast_radius_analyze",
        "context_pack_generate",
        "project_intelligence_snapshot",
        "next_best_tool",
        "mission_route",
        "agent_context_prepare",
        "ctx_pack_budget_review",
        "ctx_pack_refresh",
        "lsp_feedback_replan",
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
        "repo_graph_refresh_incremental",
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
  });
});
