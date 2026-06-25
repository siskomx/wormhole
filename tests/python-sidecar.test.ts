import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPythonSidecar, type PythonSidecarJobRequest } from "../src/python-sidecar.js";

function writeFakeSidecar(scriptPath: string, body: string) {
  writeFileSync(scriptPath, body, { encoding: "utf8" });
}

describe("Python sidecar bridge", () => {
  it("runs a JSON sidecar job and returns a hashed result", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-python-sidecar-"));
    const scriptPath = path.join(tempRoot, "fake-sidecar.mjs");
    writeFakeSidecar(
      scriptPath,
      [
        "const input = JSON.parse(process.argv[2]);",
        "process.stdout.write(JSON.stringify({",
        "  ok: true,",
        "  job: input.job,",
        "  result: { received: input.payload.value }",
        "}));",
      ].join("\n"),
    );

    try {
      const sidecar = createPythonSidecar({
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 2_000,
      });
      const request: PythonSidecarJobRequest = {
        job: "graph_metrics",
        payload: { value: "hello" },
      };

      const result = await sidecar.run(request);

      expect(result.ok).toBe(true);
      expect(result.job).toBe("graph_metrics");
      expect(result.result).toEqual({ received: "hello" });
      expect(result.evidenceHash).toMatch(/^sha256:/);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns a failed result for invalid sidecar JSON", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-python-sidecar-bad-"));
    const scriptPath = path.join(tempRoot, "bad-sidecar.mjs");
    writeFakeSidecar(scriptPath, "process.stdout.write('not json');");

    try {
      const sidecar = createPythonSidecar({
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 2_000,
      });

      const result = await sidecar.run({
        job: "trace_summary",
        payload: {},
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Invalid sidecar JSON");
      expect(result.evidenceHash).toMatch(/^sha256:/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("captures stderr and exit codes from failed sidecar processes", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-python-sidecar-stderr-"));
    const scriptPath = path.join(tempRoot, "stderr-sidecar.mjs");
    writeFakeSidecar(
      scriptPath,
      [
        "process.stderr.write('sidecar failed\\n');",
        "process.exit(3);",
      ].join("\n"),
    );

    try {
      const sidecar = createPythonSidecar({
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 2_000,
      });

      const result = await sidecar.run({
        job: "probe",
        payload: {},
      });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(3);
      expect(result.stderr).toContain("sidecar failed");
      expect(result.evidenceHash).toMatch(/^sha256:/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("times out long-running jobs", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-python-sidecar-timeout-"));
    const scriptPath = path.join(tempRoot, "slow-sidecar.mjs");
    writeFakeSidecar(scriptPath, "setTimeout(() => process.stdout.write('{}'), 10_000);");

    try {
      const sidecar = createPythonSidecar({
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 25,
      });

      const result = await sidecar.run({
        job: "graph_metrics",
        payload: {},
      });

      expect(result.ok).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.error).toContain("timed out");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
