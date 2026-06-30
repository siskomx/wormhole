import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

describe("repo-local Codex plugin metadata", () => {
  it("declares the Wormhole MCP server without TODO placeholders", () => {
    const plugin = readJson<{
      name: string;
      mcpServers: string;
      interface: { displayName: string; longDescription: string; defaultPrompt: string[] };
    }>(path.resolve("plugins/wormhole/.codex-plugin/plugin.json"));
    const mcp = readJson<{ mcpServers: { wormhole: { command: string; args: string[] } } }>(
      path.resolve("plugins/wormhole/.mcp.json"),
    );
    const serialized = JSON.stringify(plugin);

    expect(plugin.name).toBe("wormhole");
    expect(plugin.mcpServers).toBe("./.mcp.json");
    expect(plugin.interface.displayName).toBe("Wormhole");
    expect(plugin.interface.defaultPrompt).toHaveLength(3);
    expect(plugin.interface.longDescription).toContain("optimized command execution");
    expect(plugin.interface.longDescription).toContain("native tool generation");
    expect(plugin.interface.longDescription).toContain("validated writable tool scaffolds");
    expect(plugin.interface.longDescription).toContain("executable external agent dispatch");
    expect(plugin.interface.longDescription).toContain("durable brevity/minimality policy");
    expect(plugin.interface.longDescription).toContain("context-pack budget review");
    expect(plugin.interface.longDescription).toContain("LSP feedback replanning");
    expect(plugin.interface.longDescription).toContain("shared agent workspace memory");
    expect(plugin.interface.longDescription).toContain("safe live policy feedback");
    expect(plugin.interface.longDescription).toContain("native media ingestion");
    expect(plugin.interface.longDescription).toContain("shell hook management");
    expect(plugin.interface.longDescription).toContain("discovery-driven tool generation");
    expect(plugin.interface.longDescription).toContain("learned orchestration policy");
    expect(plugin.interface.longDescription).toContain("reasoning strategy research");
    expect(plugin.interface.longDescription).toContain("project contract detection");
    expect(plugin.interface.longDescription).toContain("impact-aware verification planning");
    expect(plugin.interface.longDescription).toContain("safe LSP probes");
    expect(plugin.interface.longDescription).toContain("one-shot project onboarding");
    expect(plugin.interface.longDescription).toContain("native architecture maps");
    expect(plugin.interface.longDescription).toContain("blast-radius analysis");
    expect(plugin.interface.longDescription).toContain("agent-facing routing");
    expect(plugin.interface.longDescription).toContain("next-tool recommendations");
    expect(plugin.interface.longDescription).toContain("optimization adapters");
    expect(plugin.interface.longDescription).toContain("required Python runtime");
    expect(plugin.interface.longDescription).toContain("repo watch sessions");
    expect(plugin.interface.longDescription).toContain("git diff detection");
    expect(plugin.interface.longDescription).toContain("patch transactions");
    expect(plugin.interface.longDescription).toContain("durable resume continuation");
    expect(plugin.interface.defaultPrompt.join("\n")).toContain(
      "only call emit_plan when the user explicitly asks for a plan",
    );
    expect(plugin.interface.defaultPrompt.join("\n")).not.toContain("Produce a cited Wormhole implementation plan");
    expect(plugin.interface.defaultPrompt.join("\n")).not.toContain("then emit_plan");
    expect(plugin.interface.longDescription).not.toContain("optional Python graph");
    expect(serialized).not.toContain("TODO");
    expect(mcp.mcpServers.wormhole.command).toBe("node");
    expect(mcp.mcpServers.wormhole.args).toEqual(["../../dist/src/cli.js"]);
  });
});

describe("Claude Desktop extension metadata", () => {
  it("declares an unpacked MCPB-compatible Node extension", () => {
    const manifest = readJson<{
      manifest_version: string;
      name: string;
      display_name: string;
      server: {
        type: string;
        entry_point: string;
        mcp_config: { command: string; args: string[] };
      };
      tools: Array<{ name: string; description: string }>;
      prompts: Array<{ name: string; text: string }>;
      tool_manifest_policy?: {
        mode: string;
        source_of_truth: string;
        full_runtime_tool_surface: boolean;
        manifest_tools_are_curated: boolean;
        discovery_tools: string[];
      };
      compatibility: { runtimes: Record<string, string> };
    }>(path.resolve("plugins/wormhole-claude-desktop/manifest.json"));
    const serialized = JSON.stringify(manifest);

    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.name).toBe("wormhole");
    expect(manifest.display_name).toBe("Wormhole");
    expect(manifest.server.type).toBe("node");
    expect(manifest.server.entry_point).toBe("server/index.js");
    expect(manifest.server.mcp_config.command).toBe("node");
    expect(manifest.server.mcp_config.args).toEqual(["${__dirname}/server/index.js"]);
    expect(manifest.tools.map((tool) => tool.name)).toContain("agent_dispatch");
    expect(manifest.tools.map((tool) => tool.name)).toContain("agent_dispatch_execute");
    expect(manifest.tools.map((tool) => tool.name)).toContain("agent_workspace_create");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_watch_start");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_watch_scan");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_graph_refresh_incremental");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_graph_refresh_full");
    expect(manifest.tools.map((tool) => tool.name)).toContain("state_maintenance_run");
    expect(manifest.tools.map((tool) => tool.name)).toContain("state_maintenance_status");
    expect(manifest.tools.map((tool) => tool.name)).toContain("state_maintenance_retry");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_exposure_profile");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_admission_review");
    expect(manifest.tools.map((tool) => tool.name)).toContain("workflow_start_feature");
    expect(manifest.prompts[0]?.text).toContain("only call emit_plan when the user explicitly asks for a plan");
    expect(manifest.prompts[0]?.text).not.toContain("then emit_plan");
    expect(manifest.tools.map((tool) => tool.name)).toContain("workflow_fix_bug");
    expect(manifest.tools.map((tool) => tool.name)).toContain("workflow_review_pr");
    expect(manifest.tools.map((tool) => tool.name)).toContain("workflow_onboard_repo");
    expect(manifest.tools.map((tool) => tool.name)).toContain("workflow_write_artifacts");
    expect(manifest.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["resume_record", "resume_checkpoint", "resume_validate", "resume_load"]),
    );
    expect(manifest.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(manifest.tools.map((tool) => tool.name)).toContain("agent_workspace_merge");
    expect(manifest.tools.map((tool) => tool.name)).toContain("orchestration_plan_local");
    expect(manifest.tools.map((tool) => tool.name)).toContain("orchestration_run_local");
    expect(manifest.tools.map((tool) => tool.name)).toContain("ctx_pack_create");
    expect(manifest.tools.map((tool) => tool.name)).toContain("ctx_pack_budget_review");
    expect(manifest.tools.map((tool) => tool.name)).toContain("ctx_pack_refresh");
    expect(manifest.tools.map((tool) => tool.name)).toContain("optimization_apply");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_index_query");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_index_explain");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_index_report");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_graph_analyze");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_graph_export");
    expect(manifest.tools.map((tool) => tool.name)).toContain("project_contract_detect");
    expect(manifest.tools.map((tool) => tool.name)).toContain("dependency_inventory");
    expect(manifest.tools.map((tool) => tool.name)).toContain("project_command_map");
    expect(manifest.tools.map((tool) => tool.name)).toContain("diagnostics_from_command");
    expect(manifest.tools.map((tool) => tool.name)).toContain("diagnostics_query");
    expect(manifest.tools.map((tool) => tool.name)).toContain("impact_analyze");
    expect(manifest.tools.map((tool) => tool.name)).toContain("test_plan_select");
    expect(manifest.tools.map((tool) => tool.name)).toContain("verification_run");
    expect(manifest.tools.map((tool) => tool.name)).toContain("secret_scan");
    expect(manifest.tools.map((tool) => tool.name)).toContain("operation_risk_review");
    expect(manifest.tools.map((tool) => tool.name)).toContain("semantic_index_build");
    expect(manifest.tools.map((tool) => tool.name)).toContain("semantic_search");
    expect(manifest.tools.map((tool) => tool.name)).toContain("lsp_probe");
    expect(manifest.tools.map((tool) => tool.name)).toContain("project_onboard");
    expect(manifest.tools.map((tool) => tool.name)).toContain("architecture_map");
    expect(manifest.tools.map((tool) => tool.name)).toContain("entrypoint_flow_discover");
    expect(manifest.tools.map((tool) => tool.name)).toContain("blast_radius_analyze");
    expect(manifest.tools.map((tool) => tool.name)).toContain("context_pack_generate");
    expect(manifest.tools.map((tool) => tool.name)).toContain("project_intelligence_snapshot");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_layer_map");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_catalog_query");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_profile_list");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_profile_get");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_search");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_promote");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_promotion_status");
    expect(manifest.tools.map((tool) => tool.name)).toContain("next_best_tool");
    expect(manifest.tools.map((tool) => tool.name)).toContain("mission_route");
    expect(manifest.tools.map((tool) => tool.name)).toContain("agent_context_prepare");
    expect(manifest.tool_manifest_policy).toEqual({
      mode: "compact-guided",
      source_of_truth: "runtime-tool-registry",
      full_runtime_tool_surface: true,
      manifest_tools_are_curated: true,
      discovery_tools: ["tool_layer_map", "tool_catalog_query", "tool_search"],
    });
    expect(manifest.tools.map((tool) => tool.name)).toContain("durable_repo_index_refresh");
    expect(manifest.tools.map((tool) => tool.name)).toContain("durable_index_manifest_refresh");
    expect(manifest.tools.map((tool) => tool.name)).toContain("durable_index_manifest_status");
    expect(manifest.tools.map((tool) => tool.name)).toContain("durable_repo_index_query");
    expect(manifest.tools.map((tool) => tool.name)).toContain("durable_semantic_search");
    expect(manifest.tools.map((tool) => tool.name)).toContain("test_impact_analyze_v2");
    expect(manifest.tools.map((tool) => tool.name)).toContain("dependency_security_report");
    expect(manifest.tools.map((tool) => tool.name)).toContain("action_policy_review");
    expect(manifest.tools.map((tool) => tool.name)).toContain("patch_checkpoint");
    expect(manifest.tools.map((tool) => tool.name)).toContain("patch_apply");
    expect(manifest.tools.map((tool) => tool.name)).toContain("patch_status");
    expect(manifest.tools.map((tool) => tool.name)).toContain("patch_rollback");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_reachability_analyze");
    expect(manifest.tools.map((tool) => tool.name)).toContain("code_smell_scan");
    expect(manifest.tools.map((tool) => tool.name)).toContain("diff_scope_review");
    expect(manifest.tools.map((tool) => tool.name)).toContain("test_quality_review");
    expect(manifest.tools.map((tool) => tool.name)).toContain("coverage_delta_analyze");
    expect(manifest.tools.map((tool) => tool.name)).toContain("lsp_session_start");
    expect(manifest.tools.map((tool) => tool.name)).toContain("lsp_feedback_replan");
    expect(manifest.tools.map((tool) => tool.name)).toContain("lsp_session_request");
    expect(manifest.tools.map((tool) => tool.name)).toContain("optimization_adapter_register");
    expect(manifest.tools.map((tool) => tool.name)).toContain("optimization_adapter_run");
    expect(manifest.tools.map((tool) => tool.name)).toContain("python_sidecar_probe");
    expect(manifest.tools.map((tool) => tool.name)).toContain("python_graph_metrics");
    expect(manifest.tools.map((tool) => tool.name)).toContain("python_graph_communities");
    expect(manifest.tools.map((tool) => tool.name)).toContain("python_trace_summary");
    expect(manifest.tools.map((tool) => tool.name)).toContain("optimized_command_run");
    expect(manifest.tools.map((tool) => tool.name)).toContain("optimization_stats");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_factory_generate");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_factory_validate");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_factory_write");
    expect(manifest.tools.map((tool) => tool.name)).toContain("conductor_plan");
    expect(manifest.tools.map((tool) => tool.name)).toContain("conductor_replay");
    expect(manifest.tools.map((tool) => tool.name)).toContain("behavior_mode_set");
    expect(manifest.tools.map((tool) => tool.name)).toContain("behavior_mode_get");
    expect(manifest.tools.map((tool) => tool.name)).toContain("behavior_apply");
    expect(manifest.tools.map((tool) => tool.name)).toContain("behavior_minimality_review");
    expect(manifest.tools.map((tool) => tool.name)).toContain("media_ingest_image");
    expect(manifest.tools.map((tool) => tool.name)).toContain("shell_hook_plan");
    expect(manifest.tools.map((tool) => tool.name)).toContain("discovery_tool_spec_generate");
    expect(manifest.tools.map((tool) => tool.name)).toContain("orchestration_policy_activate");
    expect(manifest.tools.map((tool) => tool.name)).toContain("orchestration_policy_compare_baselines");
    expect(manifest.tools.map((tool) => tool.name)).toContain("orchestration_policy_live_feedback");
    expect(manifest.tools.map((tool) => tool.name)).toContain("reasoning_trace_record");
    expect(manifest.tools.map((tool) => tool.name)).toContain("reasoning_strategy_evaluate");
    expect(manifest.tools.map((tool) => tool.name)).toContain("printing_press_register");
    expect(manifest.tools.map((tool) => tool.name)).toContain("printing_press_register_agent");
    expect(manifest.tools.map((tool) => tool.name)).toContain("printing_press_run");
    expect(manifest.tools.map((tool) => tool.name)).toContain("model_profile_select");
    expect(
      manifest.tools.find((tool) => tool.name === "python_sidecar_probe")?.description,
    ).toContain("required Python runtime");
    expect(
      manifest.tools.find((tool) => tool.name === "media_dependency_report")?.description,
    ).toContain("Python media package");
    expect(manifest.compatibility.runtimes.python).toBe(">=3.0.0");
    expect(manifest.compatibility.runtimes.node).toBe(">=22.5.0");
    expect(serialized).not.toContain("optional Python sidecar");
    expect(serialized).not.toContain("optional media extraction");
    expect(manifest.prompts.map((prompt) => prompt.name)).toContain("wormhole_orchestrate");
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "repo_index_query",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "architecture_map",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "next_best_tool",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "tool_layer_map",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "tool_catalog_query",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "tool_search",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "tool_promote",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "state_maintenance_run",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "resume_checkpoint",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "optimized_command_run",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "agent_workspace_create",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "lsp_feedback_replan",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "reasoning_strategy_evaluate",
    );
    expect(serialized).not.toContain("TODO");
  });
});

describe("release automation", () => {
  it("runs the documented verification commands on the supported Node runtime", () => {
    const workflow = readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8");

    expect(workflow).toContain('node-version: "22.5.0"');
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run benchmarks:validate");
  });
});
