import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createWormholeMcpServer } from "../src/mcp-server.js";

describe("Wormhole MCP server", () => {
  it("creates an MCP server for the v1 tool surface", () => {
    const server = createWormholeMcpServer(createInMemoryKernel());

    expect(server.isConnected()).toBe(false);
  });
});
