# Python Sidecar Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Python sidecar runtime for heavy graph and trace-analysis jobs while keeping the TypeScript MCP server, event log, schemas, and policy layer authoritative.

**Architecture:** TypeScript remains the core runtime and exposes bounded MCP tools. Python runs as a stdlib-only sidecar process over a strict JSON-in/JSON-out contract, with timeouts, no shell execution, allowed job names, and content hashes for evidence. The first Python jobs are deterministic graph metrics and model-profile trace summaries; they augment native data but never replace Wormhole's evidence gate.

**Tech Stack:** TypeScript, Node `child_process.spawn`, Vitest, Python 3 stdlib, JSON line/result protocol.

---

## File Structure

- Create: `src/python-sidecar.ts`
  - Owns sidecar config, Python command probing, job request/response types, spawn/timeout logic, JSON parsing, and evidence hashes.
- Create: `python/wormhole_sidecar/__init__.py`
  - Marks the sidecar package and exposes the package version.
- Create: `python/wormhole_sidecar/runner.py`
  - CLI entry point run by TypeScript with `python -m wormhole_sidecar.runner`.
- Create: `python/wormhole_sidecar/graph_metrics.py`
  - Computes deterministic graph metrics from Wormhole repo-index nodes and edges.
- Create: `python/wormhole_sidecar/trace_analysis.py`
  - Summarizes model-profile route traces and outcomes for small-model learning review.
- Create: `tests/python-sidecar.test.ts`
  - Tests the TypeScript bridge using a fake sidecar command and real JSON fixtures.
- Create: `tests/python-sidecar-runner.test.ts`
  - Tests the checked-in Python sidecar when a Python interpreter is available; otherwise verifies graceful skip metadata through the probe.
- Modify: `src/tools.ts`
  - Add tool handlers for sidecar probe, graph metrics, and trace summaries.
- Modify: `src/mcp-server.ts`
  - Register `python_sidecar_probe`, `python_graph_metrics`, and `python_trace_summary`.
- Modify: `src/capabilities.ts`
  - Add implemented capability `adaptive.optional-python-sidecar` and connector target `python-sidecar`.
- Modify: `docs/architecture/orchestration-adaptive-capabilities.md`
  - Document when Python is used, what it cannot do, and the safety boundary.
- Modify: `docs/contracts/capability-manifest.md`
  - Add the Python sidecar capability contract.
- Modify: `README.md`
  - Add optional Python sidecar notes and commands.
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
  - Add the new MCP tool names to the Claude Desktop extension metadata.
- Modify: `plugins/wormhole/.codex-plugin/plugin.json`
  - Mention optional Python sidecar tools in the Codex plugin description.
- Modify: `tests/tools.test.ts`
  - Verify handler-level integration using deterministic fixture data.
- Modify: `tests/mcp-server.test.ts`
  - Verify the new MCP tool names are registered.
- Modify: `tests/capabilities.test.ts`
  - Verify manifest exposure.
- Modify: `tests/plugin.test.ts`
  - Verify plugin metadata includes the sidecar tools.

---

### Task 1: TypeScript Sidecar Bridge

**Files:**
- Create: `src/python-sidecar.ts`
- Test: `tests/python-sidecar.test.ts`

- [ ] **Step 1: Write the failing bridge tests**

Add `tests/python-sidecar.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPythonSidecar,
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
```

- [ ] **Step 2: Run the failing bridge tests**

Run:

```bash
npm test -- tests/python-sidecar.test.ts
```

Expected: FAIL with `Cannot find module '../src/python-sidecar.js'`.

- [ ] **Step 3: Implement the TypeScript bridge**

Create `src/python-sidecar.ts`:

```ts
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

export type PythonSidecarJobName = "probe" | "graph_metrics" | "trace_summary";

export type PythonSidecarJobRequest = {
  job: PythonSidecarJobName;
  payload: unknown;
};

export type PythonSidecarJobResult = {
  ok: boolean;
  job: PythonSidecarJobName;
  result?: unknown;
  error?: string;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  evidenceHash: string;
};

export type PythonSidecarConfig = {
  command?: string;
  args?: string[];
  timeoutMs?: number;
  cwd?: string;
  pythonPathRoot?: string;
};

export type PythonSidecar = {
  run(input: PythonSidecarJobRequest): Promise<PythonSidecarJobResult>;
};

const allowedJobs = new Set<PythonSidecarJobName>(["probe", "graph_metrics", "trace_summary"]);

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function defaultCommand(): string {
  return process.env.WORMHOLE_PYTHON || (process.platform === "win32" ? "python" : "python3");
}

function defaultArgs(): string[] {
  return ["-m", "wormhole_sidecar.runner"];
}

function buildPythonPath(config: PythonSidecarConfig): string | undefined {
  const root = config.pythonPathRoot ?? process.env.WORMHOLE_PYTHONPATH ?? path.resolve(process.cwd(), "python");
  const existing = process.env.PYTHONPATH;
  return existing ? `${root}${path.delimiter}${existing}` : root;
}

export function createPythonSidecar(config: PythonSidecarConfig = {}): PythonSidecar {
  const command = config.command ?? defaultCommand();
  const baseArgs = config.args ?? defaultArgs();
  const timeoutMs = config.timeoutMs ?? 10_000;
  const cwd = config.cwd ?? process.cwd();

  return {
    async run(input: PythonSidecarJobRequest): Promise<PythonSidecarJobResult> {
      if (!allowedJobs.has(input.job)) {
        throw new Error(`Unsupported Python sidecar job: ${input.job}`);
      }

      const startedAt = Date.now();
      const requestJson = JSON.stringify(input);

      return await new Promise((resolve) => {
        const child = spawn(command, [...baseArgs, requestJson], {
          cwd,
          shell: false,
          env: {
            ...process.env,
            PYTHONPATH: buildPythonPath(config),
          },
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        let timedOut = false;

        const finish = (exitCode: number | null) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          const durationMs = Date.now() - startedAt;
          const evidenceHash = sha256(JSON.stringify({ input, stdout, stderr, exitCode, timedOut }));

          if (timedOut) {
            resolve({
              ok: false,
              job: input.job,
              error: `Python sidecar job ${input.job} timed out after ${timeoutMs}ms`,
              timedOut,
              exitCode,
              stdout,
              stderr,
              durationMs,
              evidenceHash,
            });
            return;
          }

          if (exitCode !== 0) {
            resolve({
              ok: false,
              job: input.job,
              error: stderr.trim() || `Python sidecar exited with code ${exitCode}`,
              timedOut,
              exitCode,
              stdout,
              stderr,
              durationMs,
              evidenceHash,
            });
            return;
          }

          try {
            const parsed = JSON.parse(stdout) as { ok: boolean; job?: PythonSidecarJobName; result?: unknown; error?: string };
            resolve({
              ok: Boolean(parsed.ok),
              job: parsed.job ?? input.job,
              result: parsed.result,
              error: parsed.error,
              timedOut,
              exitCode,
              stdout,
              stderr,
              durationMs,
              evidenceHash,
            });
          } catch {
            resolve({
              ok: false,
              job: input.job,
              error: "Invalid sidecar JSON",
              timedOut,
              exitCode,
              stdout,
              stderr,
              durationMs,
              evidenceHash,
            });
          }
        };

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeoutMs);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", (error) => {
          stderr += error.message;
          finish(null);
        });
        child.on("close", (code) => finish(code));
      });
    },
  };
}
```

- [ ] **Step 4: Run the bridge tests**

Run:

```bash
npm test -- tests/python-sidecar.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/python-sidecar.ts tests/python-sidecar.test.ts
git commit -m "feat: add optional python sidecar bridge"
```

---

### Task 2: Python Sidecar Jobs

**Files:**
- Create: `python/wormhole_sidecar/__init__.py`
- Create: `python/wormhole_sidecar/runner.py`
- Create: `python/wormhole_sidecar/graph_metrics.py`
- Create: `python/wormhole_sidecar/trace_analysis.py`
- Test: `tests/python-sidecar-runner.test.ts`

- [ ] **Step 1: Write the runner integration tests**

Add `tests/python-sidecar-runner.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createPythonSidecar } from "../src/python-sidecar.js";

function findPython(): string | undefined {
  for (const command of process.platform === "win32" ? ["python", "py"] : ["python3", "python"]) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8", shell: false });
    if (result.status === 0) {
      return command;
    }
  }
  return undefined;
}

describe("checked-in Python sidecar runner", () => {
  it("probes availability when Python is installed", async () => {
    const python = findPython();
    if (!python) {
      expect(python).toBeUndefined();
      return;
    }

    const sidecar = createPythonSidecar({ command: python, timeoutMs: 2_000 });
    const result = await sidecar.run({ job: "probe", payload: {} });

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ runtime: "python", package: "wormhole_sidecar" });
  });

  it("computes graph metrics deterministically", async () => {
    const python = findPython();
    if (!python) {
      expect(python).toBeUndefined();
      return;
    }

    const sidecar = createPythonSidecar({ command: python, timeoutMs: 2_000 });
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
      topDegree: [{ id: "src/a.ts", degree: 2 }],
    });
  });

  it("summarizes model-profile traces", async () => {
    const python = findPython();
    if (!python) {
      expect(python).toBeUndefined();
      return;
    }

    const sidecar = createPythonSidecar({ command: python, timeoutMs: 2_000 });
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
        { profileId: "small", runs: 2, successes: 1, averageQuality: 3.5 },
        { profileId: "deep", runs: 1, successes: 1, averageQuality: 4 },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the failing runner tests**

Run:

```bash
npm test -- tests/python-sidecar-runner.test.ts
```

Expected with Python installed: FAIL with `No module named wormhole_sidecar`. Expected without Python installed: PASS because the test verifies the absence and returns early.

- [ ] **Step 3: Add the Python package marker**

Create `python/wormhole_sidecar/__init__.py`:

```py
__version__ = "0.1.0"
```

- [ ] **Step 4: Add graph metrics job**

Create `python/wormhole_sidecar/graph_metrics.py`:

```py
from collections import defaultdict, deque


def _node_id(node):
    return str(node.get("id", ""))


def compute_graph_metrics(payload):
    nodes = [_node_id(node) for node in payload.get("nodes", []) if _node_id(node)]
    node_set = set(nodes)
    adjacency = defaultdict(set)
    degree = defaultdict(int)
    edges = payload.get("edges", [])

    for edge in edges:
        source = str(edge.get("from", ""))
        target = str(edge.get("to", ""))
        if not source or not target:
            continue
        node_set.add(source)
        node_set.add(target)
        adjacency[source].add(target)
        adjacency[target].add(source)
        degree[source] += 1
        degree[target] += 1

    visited = set()
    component_count = 0
    for node in sorted(node_set):
        if node in visited:
            continue
        component_count += 1
        queue = deque([node])
        visited.add(node)
        while queue:
            current = queue.popleft()
            for neighbor in sorted(adjacency[current]):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

    top_degree = [
        {"id": node, "degree": value}
        for node, value in sorted(degree.items(), key=lambda item: (-item[1], item[0]))[:10]
    ]

    return {
        "nodeCount": len(node_set),
        "edgeCount": len(edges),
        "componentCount": component_count,
        "topDegree": top_degree,
    }
```

- [ ] **Step 5: Add trace summary job**

Create `python/wormhole_sidecar/trace_analysis.py`:

```py
from collections import defaultdict


def summarize_traces(payload):
    traces = payload.get("traces", [])
    grouped = defaultdict(list)
    for trace in traces:
        profile_id = str(trace.get("profileId") or trace.get("profile", {}).get("profileId") or "unknown")
        grouped[profile_id].append(trace)

    profiles = []
    for profile_id in sorted(grouped):
        rows = grouped[profile_id]
        runs = len(rows)
        successes = sum(1 for row in rows if row.get("status") == "succeeded")
        latencies = [float(row.get("latencyMs", 0)) for row in rows]
        qualities = [float(row.get("outputQuality", 0)) for row in rows]
        profiles.append(
            {
                "profileId": profile_id,
                "runs": runs,
                "successes": successes,
                "failures": sum(1 for row in rows if row.get("status") == "failed"),
                "averageLatencyMs": round(sum(latencies) / runs, 2) if runs else 0,
                "averageQuality": round(sum(qualities) / runs, 2) if runs else 0,
                "successRate": round(successes / runs, 4) if runs else 0,
            }
        )

    return {
        "traceCount": len(traces),
        "profiles": profiles,
    }
```

- [ ] **Step 6: Add sidecar runner**

Create `python/wormhole_sidecar/runner.py`:

```py
import json
import platform
import sys

from wormhole_sidecar import __version__
from wormhole_sidecar.graph_metrics import compute_graph_metrics
from wormhole_sidecar.trace_analysis import summarize_traces


def run_job(request):
    job = request.get("job")
    payload = request.get("payload", {})

    if job == "probe":
        return {
            "runtime": "python",
            "package": "wormhole_sidecar",
            "version": __version__,
            "pythonVersion": platform.python_version(),
        }
    if job == "graph_metrics":
        return compute_graph_metrics(payload)
    if job == "trace_summary":
        return summarize_traces(payload)
    raise ValueError(f"Unsupported sidecar job: {job}")


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "job": "probe", "error": "Expected one JSON request argument"}))
        return 2

    try:
        request = json.loads(sys.argv[1])
        result = run_job(request)
        print(json.dumps({"ok": True, "job": request.get("job"), "result": result}, sort_keys=True))
        return 0
    except Exception as error:
        job = "probe"
        try:
            job = json.loads(sys.argv[1]).get("job", "probe")
        except Exception:
            pass
        print(json.dumps({"ok": False, "job": job, "error": str(error)}, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 7: Run the Python sidecar tests**

Run:

```bash
npm test -- tests/python-sidecar-runner.test.ts
```

Expected: PASS. On machines without Python, the tests pass by exercising the no-Python branch.

- [ ] **Step 8: Commit**

```bash
git add python/wormhole_sidecar tests/python-sidecar-runner.test.ts
git commit -m "feat: add deterministic python sidecar jobs"
```

---

### Task 3: Tool Handler Integration

**Files:**
- Modify: `src/tools.ts`
- Test: `tests/tools.test.ts`

- [ ] **Step 1: Write handler-level tests**

Append this test to `tests/tools.test.ts`:

```ts
  it("runs optional Python sidecar handlers through the tool layer", async () => {
    const tools = createToolHandlers(createInMemoryKernel());

    const probe = await tools.pythonSidecarProbe();
    const metrics = await tools.pythonGraphMetrics({
      nodes: [
        { id: "src/a.ts", kind: "file" },
        { id: "src/b.ts", kind: "file" },
      ],
      edges: [{ from: "src/a.ts", to: "src/b.ts", kind: "imports" }],
    });
    const summary = await tools.pythonTraceSummary({
      traces: [{ profileId: "small-local", status: "succeeded", latencyMs: 25, outputQuality: 5 }],
    });

    expect(probe.job).toBe("probe");
    expect(metrics.job).toBe("graph_metrics");
    expect(summary.job).toBe("trace_summary");
    expect(metrics.evidenceHash).toMatch(/^sha256:/);
  });
```

- [ ] **Step 2: Run the failing handler test**

Run:

```bash
npm test -- tests/tools.test.ts
```

Expected: FAIL with missing `pythonSidecarProbe`.

- [ ] **Step 3: Add sidecar handlers**

In `src/tools.ts`, add the import:

```ts
import { createPythonSidecar } from "./python-sidecar.js";
```

Inside `createToolHandlers`, create the sidecar next to the other registries:

```ts
  const pythonSidecar = createPythonSidecar();
```

Add these handlers in the returned object:

```ts
    pythonSidecarProbe() {
      return pythonSidecar.run({ job: "probe", payload: {} });
    },

    pythonGraphMetrics(input: {
      nodes: Array<{ id: string; kind?: string }>;
      edges: Array<{ from: string; to: string; kind?: string }>;
    }) {
      return pythonSidecar.run({ job: "graph_metrics", payload: input });
    },

    pythonTraceSummary(input: {
      traces: Array<{
        profileId?: string;
        profile?: { profileId?: string };
        status?: string;
        latencyMs?: number;
        outputQuality?: number;
      }>;
    }) {
      return pythonSidecar.run({ job: "trace_summary", payload: input });
    },
```

- [ ] **Step 4: Run handler tests**

Run:

```bash
npm test -- tests/tools.test.ts tests/python-sidecar.test.ts tests/python-sidecar-runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools.ts tests/tools.test.ts
git commit -m "feat: expose python sidecar handlers"
```

---

### Task 4: MCP Tool Surface

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `tests/mcp-server.test.ts`

- [ ] **Step 1: Write MCP registration tests**

In `tests/mcp-server.test.ts`, extend the existing registered-tool assertion to include:

```ts
expect(toolNames).toContain("python_sidecar_probe");
expect(toolNames).toContain("python_graph_metrics");
expect(toolNames).toContain("python_trace_summary");
```

If the test uses snapshots instead of `toolNames`, update the snapshot to include these exact names:

```ts
"python_sidecar_probe"
"python_graph_metrics"
"python_trace_summary"
```

- [ ] **Step 2: Run the failing MCP test**

Run:

```bash
npm test -- tests/mcp-server.test.ts
```

Expected: FAIL because the three tool names are not registered.

- [ ] **Step 3: Register MCP tools**

In `src/mcp-server.ts`, register the tools before `return server;`:

```ts
  server.registerTool(
    "python_sidecar_probe",
    {
      description: "Probe the optional Python sidecar runtime and report availability.",
      inputSchema: {},
    },
    async () => jsonResult(await tools.pythonSidecarProbe()),
  );

  server.registerTool(
    "python_graph_metrics",
    {
      description: "Run optional Python graph metrics over caller-supplied Wormhole graph nodes and edges.",
      inputSchema: {
        nodes: z.array(
          z.object({
            id: z.string(),
            kind: z.string().optional(),
          }),
        ),
        edges: z.array(
          z.object({
            from: z.string(),
            to: z.string(),
            kind: z.string().optional(),
          }),
        ),
      },
    },
    async (input) => jsonResult(await tools.pythonGraphMetrics(input)),
  );

  server.registerTool(
    "python_trace_summary",
    {
      description: "Run optional Python analysis over model-profile route traces and outcomes.",
      inputSchema: {
        traces: z.array(
          z.object({
            profileId: z.string().optional(),
            profile: z
              .object({
                profileId: z.string().optional(),
              })
              .optional(),
            status: z.string().optional(),
            latencyMs: z.number().optional(),
            outputQuality: z.number().optional(),
          }),
        ),
      },
    },
    async (input) => jsonResult(await tools.pythonTraceSummary(input)),
  );
```

- [ ] **Step 4: Run MCP tests**

Run:

```bash
npm test -- tests/mcp-server.test.ts tests/tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.ts tests/mcp-server.test.ts
git commit -m "feat: register python sidecar mcp tools"
```

---

### Task 5: Capability Manifest And Plugin Metadata

**Files:**
- Modify: `src/capabilities.ts`
- Modify: `tests/capabilities.test.ts`
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
- Modify: `plugins/wormhole/.codex-plugin/plugin.json`
- Modify: `tests/plugin.test.ts`

- [ ] **Step 1: Write capability and plugin tests**

In `tests/capabilities.test.ts`, add assertions:

```ts
expect(manifest.connectors).toContainEqual(
  expect.objectContaining({
    target: "python-sidecar",
    status: "implemented",
    transport: "connector-contract",
  }),
);
expect(manifest.capabilities).toContainEqual(
  expect.objectContaining({
    id: "adaptive.optional-python-sidecar",
    status: "implemented",
  }),
);
```

In `tests/plugin.test.ts`, add checks that the plugin metadata contains all three tool names:

```ts
expect(JSON.stringify(claudeManifest)).toContain("python_sidecar_probe");
expect(JSON.stringify(claudeManifest)).toContain("python_graph_metrics");
expect(JSON.stringify(claudeManifest)).toContain("python_trace_summary");
expect(JSON.stringify(codexPlugin)).toContain("python sidecar");
```

- [ ] **Step 2: Run failing metadata tests**

Run:

```bash
npm test -- tests/capabilities.test.ts tests/plugin.test.ts
```

Expected: FAIL because the new connector, capability, and plugin strings do not exist yet.

- [ ] **Step 3: Update capability manifest**

In `src/capabilities.ts`, add `"python-sidecar"` to `ConnectorTarget`:

```ts
  | "python-sidecar";
```

Add a connector entry:

```ts
      {
        target: "python-sidecar",
        status: "implemented",
        transport: "connector-contract",
        description: "Optional local Python sidecar for deterministic graph metrics and model-profile trace analysis.",
      },
```

Add a capability entry:

```ts
      {
        id: "adaptive.optional-python-sidecar",
        area: "adaptive",
        status: "implemented",
        description: "Optional Python stdlib sidecar for deterministic graph metrics and model-profile trace summaries while TypeScript remains the authoritative MCP runtime.",
      },
```

- [ ] **Step 4: Update plugin metadata**

In `plugins/wormhole-claude-desktop/manifest.json`, add the tool names wherever the manifest lists exposed tools:

```json
"python_sidecar_probe",
"python_graph_metrics",
"python_trace_summary"
```

In `plugins/wormhole/.codex-plugin/plugin.json`, update the long description with this sentence:

```json
"Optional Python sidecar tools can probe the local Python runtime, compute deterministic graph metrics, and summarize model-profile traces without making Python required for the core MCP server."
```

- [ ] **Step 5: Run metadata tests**

Run:

```bash
npm test -- tests/capabilities.test.ts tests/plugin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/capabilities.ts tests/capabilities.test.ts plugins/wormhole-claude-desktop/manifest.json plugins/wormhole/.codex-plugin/plugin.json tests/plugin.test.ts
git commit -m "feat: advertise optional python sidecar capability"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/orchestration-adaptive-capabilities.md`
- Modify: `docs/contracts/capability-manifest.md`

- [ ] **Step 1: Update README**

Add this section after `## Current Surface`:

```md
## Optional Python Sidecar

Wormhole's core MCP server is TypeScript and does not require Python. When Python 3 is available, Wormhole can run optional sidecar jobs for deterministic graph metrics and model-profile trace summaries through:

- `python_sidecar_probe`
- `python_graph_metrics`
- `python_trace_summary`

Set `WORMHOLE_PYTHON` when the host should use a specific interpreter. Set `WORMHOLE_PYTHONPATH` only when the sidecar package is outside the repo-local `python` directory.
```

- [ ] **Step 2: Update architecture docs**

Add this section to `docs/architecture/orchestration-adaptive-capabilities.md` after `## Adaptive Routing`:

```md
## Optional Python Sidecar

Python is an optional worker runtime for jobs where the Python ecosystem is useful, such as graph metrics, trace analysis, embeddings, and future ML experiments. TypeScript remains authoritative for MCP schemas, state projection, gates, evidence, routing policy, and plugin packaging.

The sidecar contract is intentionally narrow:

- TypeScript sends one JSON request with an allowed job name.
- Python returns one JSON response.
- TypeScript enforces timeout, process isolation, evidence hashes, and MCP result shape.
- Python does not mutate the event log or decide whether a gate opens.

The first implemented jobs are deterministic graph metrics and model-profile trace summaries. They augment `repo_index_report` and `model_profile_export_traces`; they do not replace source evidence or learned orchestration policy.
```

- [ ] **Step 3: Update capability contract docs**

Add this bullet to `docs/contracts/capability-manifest.md` under implemented adaptive capabilities:

```md
- `adaptive.optional-python-sidecar`: optional Python stdlib worker for deterministic graph metrics and model-profile trace summaries, bounded by TypeScript-owned MCP schemas, timeouts, and evidence hashes.
```

Add this connector target:

```md
- `python-sidecar`: optional local Python runtime through a narrow JSON job contract.
```

- [ ] **Step 4: Run docs grep**

Run:

```bash
rg -n "python_sidecar_probe|python_graph_metrics|python_trace_summary|adaptive.optional-python-sidecar|python-sidecar" README.md docs plugins src tests
```

Expected: output includes README, architecture docs, capability contract, plugin metadata, capability manifest, MCP server, and tests.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/architecture/orchestration-adaptive-capabilities.md docs/contracts/capability-manifest.md
git commit -m "docs: document optional python sidecar"
```

---

### Task 7: Final Verification

**Files:**
- All files changed by Tasks 1-6.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/python-sidecar.test.ts tests/python-sidecar-runner.test.ts tests/tools.test.ts tests/mcp-server.test.ts tests/capabilities.test.ts tests/plugin.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run benchmark validation**

Run:

```bash
npm run benchmarks:validate
```

Expected: PASS with all fixture hashes matching.

- [ ] **Step 6: Validate Claude Desktop extension**

Run:

```bash
npx --yes @anthropic-ai/mcpb validate plugins/wormhole-claude-desktop
```

Expected: PASS with manifest schema validation.

- [ ] **Step 7: Inspect diff**

Run:

```bash
git status --short --branch
git diff --stat
git diff --check
```

Expected: only intended Python sidecar, tool, test, docs, and plugin metadata files changed; `git diff --check` has no whitespace errors.

- [ ] **Step 8: Commit final verification notes if needed**

If verification requires small fixes, commit them with:

```bash
git add .
git commit -m "test: verify optional python sidecar runtime"
```

Expected: clean working tree except untracked local environment files.

---

## Self-Review

**Spec coverage:** The plan keeps TypeScript as the core, makes Python optional, adds deterministic graph/trace jobs, exposes MCP tools, documents the boundary, and updates plugin/capability metadata.

**Placeholder scan:** No placeholder implementation steps are left. Each code-changing task includes concrete files, test snippets, implementation snippets, commands, and expected results.

**Type consistency:** Tool names are consistently `python_sidecar_probe`, `python_graph_metrics`, and `python_trace_summary`. Internal handler names are consistently `pythonSidecarProbe`, `pythonGraphMetrics`, and `pythonTraceSummary`. Job names are consistently `probe`, `graph_metrics`, and `trace_summary`.
