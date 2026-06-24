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
      interface: { displayName: string; defaultPrompt: string[] };
    }>(path.resolve("plugins/wormhole/.codex-plugin/plugin.json"));
    const mcp = readJson<{ mcpServers: { wormhole: { command: string; args: string[] } } }>(
      path.resolve("plugins/wormhole/.mcp.json"),
    );
    const serialized = JSON.stringify(plugin);

    expect(plugin.name).toBe("wormhole");
    expect(plugin.mcpServers).toBe("./.mcp.json");
    expect(plugin.interface.displayName).toBe("Wormhole");
    expect(plugin.interface.defaultPrompt).toHaveLength(3);
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
    expect(manifest.prompts.map((prompt) => prompt.name)).toContain("wormhole_orchestrate");
    expect(serialized).not.toContain("TODO");
  });
});
