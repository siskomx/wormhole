#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createWormholeMcpServer } from "./mcp-server.js";
import { requirePythonRuntime, type PythonSidecarConfig } from "./python-sidecar.js";
import { createDefaultKernel, createDefaultToolHandlerOptions } from "./runtime.js";

export const MINIMUM_NODE_VERSION = "22.5.0";

function parseNodeVersion(version: string): [number, number, number] | undefined {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function nodeVersionSatisfies(
  version: string,
  minimumVersion: string = MINIMUM_NODE_VERSION,
): boolean {
  const current = parseNodeVersion(version);
  const minimum = parseNodeVersion(minimumVersion);
  if (!current || !minimum) {
    return false;
  }

  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) {
      return true;
    }
    if (current[index] < minimum[index]) {
      return false;
    }
  }
  return true;
}

export function assertSupportedNodeRuntime(version: string = process.versions.node): void {
  if (!nodeVersionSatisfies(version)) {
    throw new Error(
      `Wormhole requires Node.js >=${MINIMUM_NODE_VERSION}; current Node.js is ${version}. ` +
        "The durable SQLite index backend depends on this runtime.",
    );
  }
}

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
  assertSupportedNodeRuntime();
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
