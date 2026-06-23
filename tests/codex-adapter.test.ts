import { describe, expect, it } from "vitest";
import { createCodexAdapterConfig, validateCodexAdapterConfig } from "../src/codex-adapter.js";

describe("Codex runtime adapter", () => {
  it("creates a concrete plugin and MCP config from a repo root", () => {
    const config = createCodexAdapterConfig("C:/Users/Ivan/Documents/GitHub/wormhole");

    expect(config.pluginName).toBe("wormhole");
    expect(config.pluginPath.replaceAll("\\", "/")).toContain("plugins/wormhole");
    expect(config.mcpServer.command).toBe("node");
    expect(config.mcpServer.args[0].replaceAll("\\", "/")).toContain("dist/src/cli.js");
    expect(config.defaultPrompts).toHaveLength(3);
    expect(validateCodexAdapterConfig(config).valid).toBe(true);
  });
});
