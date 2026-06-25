#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createWormholeMcpServer } from "./mcp-server.js";
import { requirePythonRuntime, type PythonSidecarConfig } from "./python-sidecar.js";
import { createDefaultKernel, createDefaultToolHandlerOptions } from "./runtime.js";

export function resolveStartupPythonTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.WORMHOLE_PYTHON_STARTUP_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return 5_000;
}

export async function verifyRequiredPythonRuntime(config: PythonSidecarConfig = {}) {
  return await requirePythonRuntime({
    ...config,
    timeoutMs: config.timeoutMs ?? resolveStartupPythonTimeoutMs(),
  });
}

export async function main(): Promise<void> {
  await verifyRequiredPythonRuntime();
  const server = createWormholeMcpServer(createDefaultKernel(), createDefaultToolHandlerOptions());
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

function isDirectEntryPoint(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href);
}

if (isDirectEntryPoint()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
