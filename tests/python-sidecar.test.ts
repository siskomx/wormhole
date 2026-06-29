import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPythonSidecar,
  probePythonRuntime,
  requirePythonRuntime,
  type PythonSidecarJobRequest,
} from "../src/python-sidecar.js";

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
        "const chunks = [];",
        "process.stdin.on('data', chunk => chunks.push(chunk));",
        "process.stdin.on('end', () => {",
        "  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
        "  process.stdout.write(JSON.stringify({",
        "    ok: true,",
        "    job: input.job,",
        "    result: { received: input.payload.value }",
        "  }));",
        "});",
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

  it("sends JSON sidecar requests over stdin instead of argv", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-python-sidecar-stdin-"));
    const scriptPath = path.join(tempRoot, "stdin-sidecar.mjs");
    writeFakeSidecar(
      scriptPath,
      [
        "if (process.argv[2]) {",
        "  process.stdout.write(JSON.stringify({ ok: false, job: 'graph_metrics', error: 'request JSON was passed through argv' }));",
        "  process.exit(0);",
        "}",
        "const chunks = [];",
        "process.stdin.on('data', chunk => chunks.push(chunk));",
        "process.stdin.on('end', () => {",
        "  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
        "  process.stdout.write(JSON.stringify({",
        "    ok: true,",
        "    job: input.job,",
        "    result: { receivedBytes: input.payload.value.length }",
        "  }));",
        "});",
      ].join("\n"),
    );

    try {
      const sidecar = createPythonSidecar({
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 2_000,
      });

      const result = await sidecar.run({
        job: "graph_metrics",
        payload: { value: "x".repeat(100_000) },
      });

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ receivedBytes: 100_000 });
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

  it("reports bounded stdout capture truncation", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-python-sidecar-large-output-"));
    const scriptPath = path.join(tempRoot, "large-output-sidecar.mjs");
    writeFakeSidecar(scriptPath, "process.stdout.write('x'.repeat(2_000_050));");

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
      expect(result.stdout.length).toBe(2_000_000);
      expect(result.stdoutTruncated).toBe(true);
      expect(result.stderrTruncated).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("requires a working Python runtime during startup probes", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-python-required-"));
    const scriptPath = path.join(tempRoot, "required-sidecar.mjs");
    writeFakeSidecar(
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
    );

    try {
      const status = await requirePythonRuntime({
        command: process.execPath,
        args: [scriptPath],
        timeoutMs: 2_000,
      });

      expect(status).toMatchObject({
        required: true,
        ok: true,
        command: process.execPath,
        args: [scriptPath],
        runtime: "python",
        packageName: "wormhole_sidecar",
        sidecarVersion: "0.1.0",
        pythonVersion: "3.12.0",
      });
      expect(status.evidenceHash).toMatch(/^sha256:/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns setup-focused required runtime failures", async () => {
    const status = await probePythonRuntime({
      command: "wormhole-python-missing-for-test",
      args: [],
      timeoutMs: 100,
    });

    expect(status).toMatchObject({
      required: true,
      ok: false,
      command: "wormhole-python-missing-for-test",
    });
    expect(status.error).toMatch(/python/i);
    expect(status.setupHint).toContain("WORMHOLE_PYTHON");
    await expect(
      requirePythonRuntime({
        command: "wormhole-python-missing-for-test",
        args: [],
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/Python runtime is required/);
  });
});
