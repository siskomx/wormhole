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
    expect(plugin.interface.longDescription).toContain("durable brevity/minimality policy");
    expect(plugin.interface.longDescription).toContain("native media ingestion");
    expect(plugin.interface.longDescription).toContain("shell hook management");
    expect(plugin.interface.longDescription).toContain("discovery-driven tool generation");
    expect(plugin.interface.longDescription).toContain("learned orchestration policy");
    expect(plugin.interface.longDescription).toContain("reasoning strategy research");
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
      tools: Array<{ name: string }>;
      prompts: Array<{ name: string; text: string }>;
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
    expect(manifest.tools.map((tool) => tool.name)).toContain("orchestration_plan_local");
    expect(manifest.tools.map((tool) => tool.name)).toContain("orchestration_run_local");
    expect(manifest.tools.map((tool) => tool.name)).toContain("ctx_pack_create");
    expect(manifest.tools.map((tool) => tool.name)).toContain("optimization_apply");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_index_query");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_index_explain");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_index_report");
    expect(manifest.tools.map((tool) => tool.name)).toContain("repo_graph_export");
    expect(manifest.tools.map((tool) => tool.name)).toContain("python_sidecar_probe");
    expect(manifest.tools.map((tool) => tool.name)).toContain("python_graph_metrics");
    expect(manifest.tools.map((tool) => tool.name)).toContain("python_graph_communities");
    expect(manifest.tools.map((tool) => tool.name)).toContain("python_trace_summary");
    expect(manifest.tools.map((tool) => tool.name)).toContain("optimized_command_run");
    expect(manifest.tools.map((tool) => tool.name)).toContain("optimization_stats");
    expect(manifest.tools.map((tool) => tool.name)).toContain("tool_factory_generate");
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
    expect(manifest.tools.map((tool) => tool.name)).toContain("reasoning_trace_record");
    expect(manifest.tools.map((tool) => tool.name)).toContain("reasoning_strategy_evaluate");
    expect(manifest.tools.map((tool) => tool.name)).toContain("printing_press_register");
    expect(manifest.tools.map((tool) => tool.name)).toContain("printing_press_register_agent");
    expect(manifest.tools.map((tool) => tool.name)).toContain("printing_press_run");
    expect(manifest.tools.map((tool) => tool.name)).toContain("model_profile_select");
    expect(manifest.prompts.map((prompt) => prompt.name)).toContain("wormhole_orchestrate");
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "repo_index_query",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "optimized_command_run",
    );
    expect(manifest.prompts.map((prompt) => prompt.text).join("\n")).toContain(
      "reasoning_strategy_evaluate",
    );
    expect(serialized).not.toContain("TODO");
  });
});
