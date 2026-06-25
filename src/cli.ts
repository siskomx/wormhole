#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createWormholeMcpServer } from "./mcp-server.js";
import { createDefaultKernel, createDefaultToolHandlerOptions } from "./runtime.js";

const server = createWormholeMcpServer(createDefaultKernel(), createDefaultToolHandlerOptions());
const transport = new StdioServerTransport();

await server.connect(transport);
