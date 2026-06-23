import { describe, expect, it } from "vitest";
import { createConnectorRegistry } from "../src/connector-registry.js";

describe("connector registry", () => {
  it("selects connectors by target and required capabilities", () => {
    const registry = createConnectorRegistry([
      {
        connectorId: "claude-code",
        target: "claude-code",
        transport: "mcp-stdio",
        capabilities: ["mcp", "planning", "execution"],
        installation: "available",
        authentication: "on_use",
      },
      {
        connectorId: "codex",
        target: "codex",
        transport: "plugin-manifest",
        capabilities: ["mcp", "planning"],
        installation: "installed",
        authentication: "on_install",
      },
    ]);

    const selected = registry.select({
      target: "codex",
      requiredCapabilities: ["mcp", "planning"],
    });

    expect(selected.connectorId).toBe("codex");
    expect(registry.list().map((connector) => connector.connectorId)).toEqual([
      "claude-code",
      "codex",
    ]);
  });
});
