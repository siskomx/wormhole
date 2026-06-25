import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createPythonSidecar } from "../src/python-sidecar.js";

type PythonCommand = {
  command: string;
  args?: string[];
};

function findPython(): PythonCommand | undefined {
  const candidates: PythonCommand[] =
    process.platform === "win32"
      ? [
          { command: "python", args: ["-m", "wormhole_sidecar.runner"] },
          { command: "py", args: ["-3", "-m", "wormhole_sidecar.runner"] },
        ]
      : [
          { command: "python3", args: ["-m", "wormhole_sidecar.runner"] },
          { command: "python", args: ["-m", "wormhole_sidecar.runner"] },
        ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, ["--version"], {
      encoding: "utf8",
      shell: false,
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  return undefined;
}

function requirePython(): PythonCommand {
  const python = findPython();
  expect(python, "Python is required for the Wormhole runtime").toBeDefined();
  return python as PythonCommand;
}

describe("checked-in Python sidecar runner", () => {
  it("probes availability when Python is installed", async () => {
    const python = requirePython();

    const sidecar = createPythonSidecar({ command: python.command, args: python.args, timeoutMs: 2_000 });
    const result = await sidecar.run({ job: "probe", payload: {} });

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ runtime: "python", package: "wormhole_sidecar" });
  });

  it("computes graph metrics deterministically", async () => {
    const python = requirePython();

    const sidecar = createPythonSidecar({ command: python.command, args: python.args, timeoutMs: 2_000 });
    const result = await sidecar.run({
      job: "graph_metrics",
      payload: {
        nodes: [
          { id: "src/a.ts", kind: "file" },
          { id: "src/b.ts", kind: "file" },
          { id: "src/c.ts", kind: "file" },
        ],
        edges: [
          { from: "src/a.ts", to: "src/b.ts", kind: "imports" },
          { from: "src/a.ts", to: "src/c.ts", kind: "imports" },
          { from: "src/b.ts", to: "src/c.ts", kind: "references" },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      nodeCount: 3,
      edgeCount: 3,
      componentCount: 1,
    });
    expect((result.result as { topDegree: Array<{ id: string; degree: number }> }).topDegree[0]).toEqual({
      id: "src/a.ts",
      degree: 2,
    });
  });

  it("summarizes model-profile traces", async () => {
    const python = requirePython();

    const sidecar = createPythonSidecar({ command: python.command, args: python.args, timeoutMs: 2_000 });
    const result = await sidecar.run({
      job: "trace_summary",
      payload: {
        traces: [
          { profileId: "small", status: "succeeded", latencyMs: 40, outputQuality: 5 },
          { profileId: "small", status: "failed", latencyMs: 70, outputQuality: 2 },
          { profileId: "deep", status: "succeeded", latencyMs: 200, outputQuality: 4 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      traceCount: 3,
      profiles: [
        { profileId: "deep", runs: 1, successes: 1, failures: 0, averageLatencyMs: 200, averageQuality: 4, successRate: 1 },
        { profileId: "small", runs: 2, successes: 1, failures: 1, averageLatencyMs: 55, averageQuality: 3.5, successRate: 0.5 },
      ],
    });
  });
});
