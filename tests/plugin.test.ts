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
