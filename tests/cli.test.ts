import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSupportedNodeRuntime,
  nodeVersionSatisfies,
  verifyRequiredPythonRuntime,
} from "../src/cli.js";

describe("Wormhole CLI startup runtime", () => {
  it("requires the Node runtime that supports durable SQLite indexes", () => {
    expect(nodeVersionSatisfies("22.5.0")).toBe(true);
    expect(nodeVersionSatisfies("22.6.0")).toBe(true);
    expect(nodeVersionSatisfies("23.0.0")).toBe(true);
    expect(nodeVersionSatisfies("22.4.9")).toBe(false);
    expect(nodeVersionSatisfies("20.19.0")).toBe(false);
    expect(() => assertSupportedNodeRuntime("20.19.0")).toThrow(/Node\.js >=22\.5\.0/);
  });

  it("verifies the required Python runtime before MCP startup", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-cli-python-"));
    const scriptPath = path.join(tempRoot, "probe.mjs");
    writeFileSync(
      scriptPath,
      [
        "const chunks = [];",
        "process.stdin.on('data', chunk => chunks.push(chunk));",
        "process.stdin.on('end', () => {",
        "  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
        "  process.stdout.write(JSON.stringify({",
        "    ok: true,",
        "    job: input.job,",
        "    result: { runtime: 'python', package: 'wormhole_sidecar', version: '0.1.0', pythonVersion: '3.12.0' }",
        "  }));",
        "});",
      ].join("\n"),
      "utf8",
    );

    try {
      const status = await verifyRequiredPythonRuntime({
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 2_000,
      });

      expect(status.ok).toBe(true);
      expect(status.required).toBe(true);
      expect(status.packageName).toBe("wormhole_sidecar");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails startup verification when Python cannot be probed", async () => {
    await expect(
      verifyRequiredPythonRuntime({
        command: "wormhole-python-missing-for-cli-test",
        args: [],
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/Python runtime is required/);
  });
});
