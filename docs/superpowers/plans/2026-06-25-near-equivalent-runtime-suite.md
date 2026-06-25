# Near-Equivalent Runtime Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Wormhole close to the practical runtime value of Graphify, Headroom/RTK, Printing Press, Fugu, Caveman, and Ponytail while keeping Wormhole's TypeScript MCP kernel authoritative.

**Architecture:** Build native Wormhole capability tracks instead of cloning external repos. TypeScript owns MCP tools, evidence, policy, schemas, plugin metadata, and side-effect boundaries; Python is an optional sidecar for graph/community metrics and route-trace analysis. Each track ships as a tested module and a small MCP surface so clients such as Claude Desktop, Claude Code, and Codex can use the same capabilities.

**Tech Stack:** TypeScript, Node.js `child_process.spawn`, Vitest, Python 3 stdlib sidecar, JSON artifacts, MCPB/Codex plugin metadata.

---

## Scope

This plan targets **near-equivalent practical capability**, not source-compatible clones:

- Graphify-near: persistent graph exports, graph report, HTML view, communities, and graph metrics for code/docs.
- Headroom/RTK-near: optimized command execution, reversible output records, retrieval handles, and savings stats.
- Printing Press-near: spec-to-tool factory that emits CLI/MCP scaffolds plus manifest/evidence files.
- Fugu-near: deterministic conductor scaffolds, model-profile routing traces, and replayable policy evaluation.
- Caveman/Ponytail-near: durable brevity and minimality modes with measurable stats.

Out of scope for this implementation batch:

- Full multimodal ingestion for audio/video/images/PDFs.
- Shell-hook installation across every terminal.
- Browser/HAR/API crawling for automatic tool generation.
- Reinforcement-learning-trained orchestration.
- Vendor-specific hidden model behavior.

---

## File Structure

- Execute first: `docs/superpowers/plans/2026-06-24-python-sidecar-runtime.md`
  - Adds the TypeScript-to-Python JSON bridge and the first Python jobs.
- Create: `python/wormhole_sidecar/community.py`
  - Computes deterministic connected components and label-propagation communities.
- Modify: `python/wormhole_sidecar/runner.py`
  - Registers the `graph_communities` sidecar job.
- Modify: `src/python-sidecar.ts`
  - Allows the `graph_communities` job.
- Create: `src/graph-artifacts.ts`
  - Converts `RepoIndex` into `graph.json`, `GRAPH_REPORT.md`, and `graph.html` strings.
- Create: `src/optimized-command-runner.ts`
  - Runs commands through a no-shell wrapper and records optimized/retrievable output.
- Create: `src/optimization-stats.ts`
  - Tracks reversible optimization and command-savings stats.
- Create: `src/tool-factory.ts`
  - Generates deterministic CLI/MCP scaffold files from a constrained tool spec.
- Create: `src/conductor.ts`
  - Builds deterministic planner/worker/verifier scaffolds and replayable route traces.
- Create: `src/behavior-policy.ts`
  - Stores durable brevity/minimality modes and applies dense-output/minimality policies.
- Modify: `src/tools.ts`
  - Wires new handlers for graph export, optimized command run, stats, tool factory, conductor, and behavior policy.
- Modify: `src/mcp-server.ts`
  - Registers the new MCP tools.
- Modify: `src/capabilities.ts`
  - Adds implemented near-equivalent capability IDs.
- Modify: `README.md`
  - Documents the near-equivalent suite.
- Modify: `docs/architecture/orchestration-adaptive-capabilities.md`
  - Documents boundaries, data flow, and safety model.
- Modify: `docs/contracts/capability-manifest.md`
  - Documents new capability IDs and tool contracts.
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
  - Exposes new MCP tool names to Claude Desktop.
- Modify: `plugins/wormhole/.codex-plugin/plugin.json`
  - Describes the near-equivalent native runtime suite.
- Test: `tests/python-sidecar-communities.test.ts`
- Test: `tests/graph-artifacts.test.ts`
- Test: `tests/optimized-command-runner.test.ts`
- Test: `tests/optimization-stats.test.ts`
- Test: `tests/tool-factory.test.ts`
- Test: `tests/conductor.test.ts`
- Test: `tests/behavior-policy.test.ts`
- Modify tests: `tests/tools.test.ts`, `tests/mcp-server.test.ts`, `tests/capabilities.test.ts`, `tests/plugin.test.ts`

---

### Task 0: Implement Python Sidecar Foundation

**Files:**
- Follow: `docs/superpowers/plans/2026-06-24-python-sidecar-runtime.md`

- [ ] **Step 1: Execute the sidecar foundation plan**

Run the tasks in:

```bash
docs/superpowers/plans/2026-06-24-python-sidecar-runtime.md
```

Expected files after completion:

```text
src/python-sidecar.ts
python/wormhole_sidecar/__init__.py
python/wormhole_sidecar/runner.py
python/wormhole_sidecar/graph_metrics.py
python/wormhole_sidecar/trace_analysis.py
tests/python-sidecar.test.ts
tests/python-sidecar-runner.test.ts
```

- [ ] **Step 2: Run sidecar foundation verification**

Run:

```bash
npm test -- tests/python-sidecar.test.ts tests/python-sidecar-runner.test.ts
npm run typecheck
```

Expected: PASS. If Python is not installed, `tests/python-sidecar-runner.test.ts` must pass through its no-Python branch.

- [ ] **Step 3: Commit the foundation**

```bash
git add src/python-sidecar.ts python/wormhole_sidecar tests/python-sidecar.test.ts tests/python-sidecar-runner.test.ts src/tools.ts src/mcp-server.ts src/capabilities.ts README.md docs plugins tests
git commit -m "feat: add optional python sidecar runtime"
```

---

### Task 1: Graphify-Near Community Analysis

**Files:**
- Create: `python/wormhole_sidecar/community.py`
- Modify: `python/wormhole_sidecar/runner.py`
- Modify: `src/python-sidecar.ts`
- Test: `tests/python-sidecar-communities.test.ts`

- [ ] **Step 1: Write failing community tests**

Create `tests/python-sidecar-communities.test.ts`:

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

describe("Python graph communities", () => {
  it("detects deterministic graph communities", async () => {
    const python = findPython();
    if (!python) {
      expect(python).toBeUndefined();
      return;
    }

    const sidecar = createPythonSidecar({ command: python, timeoutMs: 2_000 });
    const result = await sidecar.run({
      job: "graph_communities",
      payload: {
        nodes: [
          { id: "src/api.ts" },
          { id: "src/db.ts" },
          { id: "docs/usage.md" },
          { id: "docs/design.md" },
        ],
        edges: [
          { from: "src/api.ts", to: "src/db.ts" },
          { from: "docs/usage.md", to: "docs/design.md" },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      communityCount: 2,
      communities: [
        { id: "community-1", members: ["docs/design.md", "docs/usage.md"] },
        { id: "community-2", members: ["src/api.ts", "src/db.ts"] },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the failing community test**

Run:

```bash
npm test -- tests/python-sidecar-communities.test.ts
```

Expected with Python installed: FAIL because `graph_communities` is unsupported. Expected without Python installed: PASS through the no-Python branch.

- [ ] **Step 3: Add the community job implementation**

Create `python/wormhole_sidecar/community.py`:

```py
from collections import defaultdict, deque


def detect_communities(payload):
    node_ids = sorted({str(node.get("id", "")) for node in payload.get("nodes", []) if node.get("id")})
    adjacency = defaultdict(set)
    for node_id in node_ids:
        adjacency[node_id]

    for edge in payload.get("edges", []):
        source = str(edge.get("from", ""))
        target = str(edge.get("to", ""))
        if not source or not target:
            continue
        adjacency[source].add(target)
        adjacency[target].add(source)

    visited = set()
    communities = []
    for node_id in sorted(adjacency):
        if node_id in visited:
            continue
        queue = deque([node_id])
        visited.add(node_id)
        members = []
        while queue:
            current = queue.popleft()
            members.append(current)
            for neighbor in sorted(adjacency[current]):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        communities.append(sorted(members))

    communities.sort(key=lambda members: (members[0], len(members)))
    return {
        "communityCount": len(communities),
        "communities": [
            {"id": f"community-{index + 1}", "members": members}
            for index, members in enumerate(communities)
        ],
    }
```

- [ ] **Step 4: Register the Python job**

In `python/wormhole_sidecar/runner.py`, add the import:

```py
from wormhole_sidecar.community import detect_communities
```

In `run_job`, add:

```py
    if job == "graph_communities":
        return detect_communities(payload)
```

In `src/python-sidecar.ts`, extend the job type and allowed set:

```ts
export type PythonSidecarJobName =
  | "probe"
  | "graph_metrics"
  | "graph_communities"
  | "trace_summary";

const allowedJobs = new Set<PythonSidecarJobName>([
  "probe",
  "graph_metrics",
  "graph_communities",
  "trace_summary",
]);
```

- [ ] **Step 5: Run community tests**

Run:

```bash
npm test -- tests/python-sidecar-communities.test.ts tests/python-sidecar-runner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add python/wormhole_sidecar/community.py python/wormhole_sidecar/runner.py src/python-sidecar.ts tests/python-sidecar-communities.test.ts
git commit -m "feat: add python graph community analysis"
```

---

### Task 2: Graphify-Near Graph Artifacts

**Files:**
- Create: `src/graph-artifacts.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/graph-artifacts.test.ts`
- Modify Test: `tests/tools.test.ts`

- [ ] **Step 1: Write graph artifact tests**

Create `tests/graph-artifacts.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGraphArtifacts } from "../src/graph-artifacts.js";
import { buildRepoIndex } from "../src/repo-index.js";

describe("graph artifacts", () => {
  it("exports graph.json, GRAPH_REPORT.md, and graph.html content", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-graph-artifacts-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "api.ts"), "import { db } from './db';\nexport function api() { return db; }\n");
    writeFileSync(path.join(repoRoot, "src", "db.ts"), "export const db = 'sqlite';\n");

    try {
      const index = buildRepoIndex({ repoRoot });
      const artifacts = createGraphArtifacts(index, {
        communities: [
          { id: "community-1", members: ["src/api.ts", "src/db.ts"] },
        ],
      });
      const graph = JSON.parse(artifacts.graphJson) as { nodes: unknown[]; edges: unknown[] };

      expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
      expect(graph.edges.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.reportMarkdown).toContain("# Wormhole Graph Report");
      expect(artifacts.reportMarkdown).toContain("community-1");
      expect(artifacts.graphHtml).toContain("<!doctype html>");
      expect(artifacts.graphHtml).toContain("src/api.ts");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the failing graph artifact test**

Run:

```bash
npm test -- tests/graph-artifacts.test.ts
```

Expected: FAIL with missing `src/graph-artifacts.js`.

- [ ] **Step 3: Implement graph artifact generation**

Create `src/graph-artifacts.ts`:

```ts
import type { RepoIndex } from "./repo-index.js";
import { getRepoGraphReport } from "./repo-index.js";

export type GraphCommunity = {
  id: string;
  members: string[];
};

export type GraphArtifacts = {
  graphJson: string;
  reportMarkdown: string;
  graphHtml: string;
};

export function createGraphArtifacts(
  index: RepoIndex,
  input: { communities?: GraphCommunity[] } = {},
): GraphArtifacts {
  const communities = input.communities ?? [];
  const graph = {
    repoRoot: index.repoRoot,
    builtAt: index.builtAt,
    nodes: [
      ...index.files.map((file) => ({
        id: file.path,
        kind: "file",
        language: file.language,
        lineCount: file.lineCount,
      })),
      ...index.symbols.map((symbol) => ({
        id: symbol.id,
        kind: "symbol",
        symbolKind: symbol.kind,
        name: symbol.name,
        path: symbol.path,
        line: symbol.line,
      })),
    ],
    edges: index.edges,
    communities,
  };
  const graphJson = JSON.stringify(graph, null, 2);
  const nativeReport = getRepoGraphReport(index);
  const reportMarkdown = [
    "# Wormhole Graph Report",
    "",
    nativeReport.summary,
    "",
    "## Communities",
    "",
    ...(communities.length > 0
      ? communities.map((community) => `- ${community.id}: ${community.members.join(", ")}`)
      : ["- none detected"]),
    "",
    nativeReport.markdown,
  ].join("\n");
  const graphHtml = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    "<title>Wormhole Graph</title>",
    "<style>body{font-family:Arial,sans-serif;margin:24px;}pre{white-space:pre-wrap;}li{margin:4px 0;}</style>",
    "</head>",
    "<body>",
    "<h1>Wormhole Graph</h1>",
    `<p>${escapeHtml(nativeReport.summary)}</p>`,
    "<h2>Top Files</h2>",
    "<ul>",
    ...nativeReport.topFiles.map((file) => `<li>${escapeHtml(file.path)}: ${file.edgeCount} edges</li>`),
    "</ul>",
    "<h2>Graph JSON</h2>",
    `<pre>${escapeHtml(graphJson)}</pre>`,
    "</body>",
    "</html>",
  ].join("\n");

  return { graphJson, reportMarkdown, graphHtml };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 4: Wire tool handler and MCP tool**

In `src/tools.ts`, import:

```ts
import { createGraphArtifacts, type GraphCommunity } from "./graph-artifacts.js";
```

Add handler:

```ts
    repoGraphExport(input: { repoRoot: string; communities?: GraphCommunity[] }) {
      return createGraphArtifacts(getRepoIndex(input.repoRoot), {
        communities: input.communities,
      });
    },
```

In `src/mcp-server.ts`, register:

```ts
  server.registerTool(
    "repo_graph_export",
    {
      description: "Export the native repo graph as graph.json, GRAPH_REPORT.md, and graph.html content.",
      inputSchema: {
        repoRoot: z.string(),
        communities: z
          .array(
            z.object({
              id: z.string(),
              members: z.array(z.string()),
            }),
          )
          .optional(),
      },
    },
    async (input) => jsonResult(tools.repoGraphExport(input)),
  );
```

- [ ] **Step 5: Add tool integration assertion**

In `tests/tools.test.ts`, add an assertion in the repo-index integration test:

```ts
      const artifacts = tools.repoGraphExport({
        repoRoot,
        communities: [{ id: "community-1", members: ["src/server.ts", "src/db.ts"] }],
      });

      expect(artifacts.graphJson).toContain("src/server.ts");
      expect(artifacts.reportMarkdown).toContain("community-1");
      expect(artifacts.graphHtml).toContain("Wormhole Graph");
```

- [ ] **Step 6: Run graph artifact tests**

Run:

```bash
npm test -- tests/graph-artifacts.test.ts tests/tools.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/graph-artifacts.ts src/tools.ts src/mcp-server.ts tests/graph-artifacts.test.ts tests/tools.test.ts
git commit -m "feat: export native repo graph artifacts"
```

---

### Task 3: Headroom/RTK-Near Optimized Command Runner

**Files:**
- Create: `src/optimization-stats.ts`
- Create: `src/optimized-command-runner.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/optimization-stats.test.ts`
- Test: `tests/optimized-command-runner.test.ts`

- [ ] **Step 1: Write stats tests**

Create `tests/optimization-stats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createOptimizationStats } from "../src/optimization-stats.js";

describe("optimization stats", () => {
  it("records token and character savings", () => {
    const stats = createOptimizationStats();
    stats.record({
      kind: "command_output_compaction",
      originalCharCount: 1000,
      optimizedCharCount: 250,
      estimatedTokensBefore: 250,
      estimatedTokensAfter: 63,
    });

    expect(stats.snapshot()).toEqual({
      runCount: 1,
      originalCharCount: 1000,
      optimizedCharCount: 250,
      estimatedTokensBefore: 250,
      estimatedTokensAfter: 63,
      estimatedTokensSaved: 187,
      byKind: {
        command_output_compaction: {
          runCount: 1,
          estimatedTokensSaved: 187,
        },
      },
    });
  });
});
```

- [ ] **Step 2: Write command runner tests**

Create `tests/optimized-command-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createOptimizedCommandRunner } from "../src/optimized-command-runner.js";
import { createOptimizationStats } from "../src/optimization-stats.js";

describe("optimized command runner", () => {
  it("runs a command, compacts output, and stores retrieval metadata", async () => {
    const stats = createOptimizationStats();
    const runner = createOptimizedCommandRunner({ stats });
    const result = await runner.run({
      command: process.execPath,
      args: ["-e", "for (let i = 0; i < 120; i++) console.log(i === 60 ? 'ERROR middle' : `line ${i}`)"],
      timeoutMs: 2_000,
    });

    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.optimization.retrievalId).toMatch(/^opt:sha256:/);
    expect(result.optimizedStdout).toContain("ERROR middle");
    expect(result.stdoutHash).toMatch(/^sha256:/);
    expect(stats.snapshot().runCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run failing command tests**

Run:

```bash
npm test -- tests/optimization-stats.test.ts tests/optimized-command-runner.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement stats module**

Create `src/optimization-stats.ts`:

```ts
import type { OptimizationKind } from "./optimization.js";

export type OptimizationStatsInput = {
  kind: OptimizationKind;
  originalCharCount: number;
  optimizedCharCount: number;
  estimatedTokensBefore?: number;
  estimatedTokensAfter?: number;
};

export type OptimizationStatsSnapshot = {
  runCount: number;
  originalCharCount: number;
  optimizedCharCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  estimatedTokensSaved: number;
  byKind: Record<string, { runCount: number; estimatedTokensSaved: number }>;
};

export type OptimizationStats = {
  record(input: OptimizationStatsInput): void;
  snapshot(): OptimizationStatsSnapshot;
};

export function createOptimizationStats(): OptimizationStats {
  const snapshot: OptimizationStatsSnapshot = {
    runCount: 0,
    originalCharCount: 0,
    optimizedCharCount: 0,
    estimatedTokensBefore: 0,
    estimatedTokensAfter: 0,
    estimatedTokensSaved: 0,
    byKind: {},
  };

  return {
    record(input) {
      const before = input.estimatedTokensBefore ?? Math.ceil(input.originalCharCount / 4);
      const after = input.estimatedTokensAfter ?? Math.ceil(input.optimizedCharCount / 4);
      const saved = Math.max(0, before - after);
      snapshot.runCount += 1;
      snapshot.originalCharCount += input.originalCharCount;
      snapshot.optimizedCharCount += input.optimizedCharCount;
      snapshot.estimatedTokensBefore += before;
      snapshot.estimatedTokensAfter += after;
      snapshot.estimatedTokensSaved += saved;
      const current = snapshot.byKind[input.kind] ?? { runCount: 0, estimatedTokensSaved: 0 };
      current.runCount += 1;
      current.estimatedTokensSaved += saved;
      snapshot.byKind[input.kind] = current;
    },
    snapshot() {
      return {
        ...snapshot,
        byKind: Object.fromEntries(
          Object.entries(snapshot.byKind).map(([kind, value]) => [kind, { ...value }]),
        ),
      };
    },
  };
}
```

- [ ] **Step 5: Implement command runner**

Create `src/optimized-command-runner.ts`:

```ts
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createOptimizationStore } from "./optimization.js";
import type { OptimizationStats } from "./optimization-stats.js";

export type OptimizedCommandInput = {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  stdin?: string;
};

export type OptimizedCommandResult = {
  status: "completed" | "failed" | "timed_out";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  optimizedStdout: string;
  stdoutHash: string;
  stderrHash: string;
  durationMs: number;
  optimization: ReturnType<ReturnType<typeof createOptimizationStore>["apply"]>;
};

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createOptimizedCommandRunner(input: { stats?: OptimizationStats } = {}) {
  const store = createOptimizationStore();

  return {
    run(commandInput: OptimizedCommandInput): Promise<OptimizedCommandResult> {
      const startedAt = Date.now();
      const timeoutMs = commandInput.timeoutMs ?? 30_000;

      return new Promise((resolve) => {
        const child = spawn(commandInput.command, commandInput.args ?? [], {
          cwd: commandInput.cwd ?? process.cwd(),
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (status: OptimizedCommandResult["status"], exitCode: number | null) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          const optimization = store.apply({
            kind: "command_output_compaction",
            content: stdout,
            sourceId: `command:${commandInput.command}`,
          });
          input.stats?.record(optimization);
          resolve({
            status,
            exitCode,
            stdout,
            stderr,
            optimizedStdout: optimization.content,
            stdoutHash: sha256(stdout),
            stderrHash: sha256(stderr),
            durationMs: Date.now() - startedAt,
            optimization,
          });
        };

        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          stderr += `Command timed out after ${timeoutMs}ms`;
          finish("timed_out", null);
        }, timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        child.on("error", (error) => {
          stderr += error.message;
        });
        child.on("close", (code) => {
          finish(code === 0 ? "completed" : "failed", code);
        });
        if (commandInput.stdin) {
          child.stdin.write(commandInput.stdin);
        }
        child.stdin.end();
      });
    },
  };
}
```

- [ ] **Step 6: Wire handlers and MCP tools**

In `src/tools.ts`, import and instantiate:

```ts
import { createOptimizedCommandRunner } from "./optimized-command-runner.js";
import { createOptimizationStats } from "./optimization-stats.js";
```

Inside `createToolHandlers`:

```ts
  const optimizationStats = createOptimizationStats();
  const optimizedCommandRunner = createOptimizedCommandRunner({ stats: optimizationStats });
```

Add handlers:

```ts
    optimizedCommandRun(input: { command: string; args?: string[]; cwd?: string; timeoutMs?: number; stdin?: string }) {
      return optimizedCommandRunner.run(input);
    },

    optimizationStats() {
      return optimizationStats.snapshot();
    },
```

In `src/mcp-server.ts`, register `optimized_command_run` and `optimization_stats` using the same input fields.

- [ ] **Step 7: Run command runner tests**

Run:

```bash
npm test -- tests/optimization-stats.test.ts tests/optimized-command-runner.test.ts tests/tools.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/optimization-stats.ts src/optimized-command-runner.ts src/tools.ts src/mcp-server.ts tests/optimization-stats.test.ts tests/optimized-command-runner.test.ts tests/tools.test.ts
git commit -m "feat: add optimized command runner"
```

---

### Task 4: Printing-Press-Near Tool Factory

**Files:**
- Create: `src/tool-factory.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/tool-factory.test.ts`

- [ ] **Step 1: Write tool factory tests**

Create `tests/tool-factory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateToolScaffold } from "../src/tool-factory.js";

describe("tool factory", () => {
  it("generates deterministic CLI, MCP, manifest, and test files", () => {
    const generated = generateToolScaffold({
      toolId: "issues-search",
      displayName: "Issues Search",
      description: "Search issue records by status.",
      commandName: "issues-search",
      inputs: [{ name: "status", type: "string", required: true }],
      capabilities: ["project-management", "search"],
    });

    expect(Object.keys(generated.files).sort()).toEqual([
      "README.md",
      "manifest.json",
      "package.json",
      "src/cli.ts",
      "src/mcp-server.ts",
      "tests/cli.test.ts",
    ]);
    expect(generated.files["manifest.json"]).toContain('"toolId": "issues-search"');
    expect(generated.files["src/cli.ts"]).toContain("status");
    expect(JSON.stringify(generated)).not.toContain("REPLACE_ME");
  });
});
```

- [ ] **Step 2: Run failing factory test**

Run:

```bash
npm test -- tests/tool-factory.test.ts
```

Expected: FAIL with missing `src/tool-factory.js`.

- [ ] **Step 3: Implement deterministic tool factory**

Create `src/tool-factory.ts`:

```ts
export type ToolFactoryInput = {
  toolId: string;
  displayName: string;
  description: string;
  commandName: string;
  inputs: Array<{ name: string; type: "string" | "number" | "boolean"; required: boolean }>;
  capabilities: string[];
};

export type ToolFactoryOutput = {
  toolId: string;
  files: Record<string, string>;
};

export function generateToolScaffold(input: ToolFactoryInput): ToolFactoryOutput {
  const manifest = {
    toolId: input.toolId,
    displayName: input.displayName,
    description: input.description,
    commandName: input.commandName,
    capabilities: [...input.capabilities].sort(),
    inputs: input.inputs,
  };
  const cliArgs = input.inputs.map((field) => `  ${field.name}: args["${field.name}"],`).join("\n");
  const zodShape = input.inputs
    .map((field) => {
      const base = field.type === "number" ? "z.number()" : field.type === "boolean" ? "z.boolean()" : "z.string()";
      return `        ${field.name}: ${field.required ? base : `${base}.optional()`},`;
    })
    .join("\n");

  return {
    toolId: input.toolId,
    files: {
      "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
      "package.json": `${JSON.stringify(
        {
          name: input.commandName,
          version: "0.1.0",
          type: "module",
          bin: { [input.commandName]: "./dist/src/cli.js" },
          scripts: { build: "tsc -p tsconfig.json", test: "vitest run tests" },
        },
        null,
        2,
      )}\n`,
      "README.md": `# ${input.displayName}\n\n${input.description}\n`,
      "src/cli.ts": [
        "#!/usr/bin/env node",
        "const args = Object.fromEntries(process.argv.slice(2).map((value) => {",
        "  const [key, raw] = value.replace(/^--/, '').split('=');",
        "  return [key, raw ?? 'true'];",
        "}));",
        "const input = {",
        cliArgs,
        "};",
        "console.log(JSON.stringify({ ok: true, input }, null, 2));",
      ].join("\n"),
      "src/mcp-server.ts": [
        'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
        'import { z } from "zod";',
        "export function createServer() {",
        `  const server = new McpServer({ name: ${JSON.stringify(input.toolId)}, version: "0.1.0" });`,
        "  server.registerTool(",
        `    ${JSON.stringify(input.toolId)},`,
        `    { description: ${JSON.stringify(input.description)}, inputSchema: {`,
        zodShape,
        "    } },",
        "    async (toolInput) => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, input: toolInput }, null, 2) }] }),",
        "  );",
        "  return server;",
        "}",
      ].join("\n"),
      "tests/cli.test.ts": [
        'import { describe, expect, it } from "vitest";',
        `describe(${JSON.stringify(input.displayName)}, () => {`,
        '  it("has generated test coverage", () => {',
        "    expect(true).toBe(true);",
        "  });",
        "});",
      ].join("\n"),
    },
  };
}
```

- [ ] **Step 4: Wire handler and MCP tool**

In `src/tools.ts`, import:

```ts
import { generateToolScaffold, type ToolFactoryInput } from "./tool-factory.js";
```

Add handler:

```ts
    toolFactoryGenerate(input: ToolFactoryInput) {
      return generateToolScaffold(input);
    },
```

In `src/mcp-server.ts`, register `tool_factory_generate` with fields from `ToolFactoryInput`.

- [ ] **Step 5: Run factory tests**

Run:

```bash
npm test -- tests/tool-factory.test.ts tests/tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tool-factory.ts src/tools.ts src/mcp-server.ts tests/tool-factory.test.ts tests/tools.test.ts
git commit -m "feat: add native tool factory"
```

---

### Task 5: Fugu-Near Deterministic Conductor

**Files:**
- Create: `src/conductor.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/conductor.test.ts`

- [ ] **Step 1: Write conductor tests**

Create `tests/conductor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createConductorPlan, replayConductorPlan } from "../src/conductor.js";

describe("deterministic conductor", () => {
  it("creates a planner-worker-verifier scaffold for risky work", () => {
    const plan = createConductorPlan({
      objective: "Refactor repo index and verify behavior",
      risk: "high",
      complexity: "medium",
      requiredStrengths: ["coding", "review"],
      modelProfileIds: ["small-local", "deep-reviewer"],
    });

    expect(plan.scaffoldId).toBe("plan-execute-verify");
    expect(plan.steps.map((step) => step.role)).toEqual(["planner", "worker", "verifier"]);
    expect(plan.trace.reasonCodes).toContain("risk:high");
  });

  it("replays a conductor plan deterministically", () => {
    const plan = createConductorPlan({
      objective: "Inspect docs",
      risk: "low",
      complexity: "low",
      requiredStrengths: ["research"],
      modelProfileIds: ["small-local"],
    });

    expect(replayConductorPlan(plan.trace).scaffoldId).toBe(plan.scaffoldId);
  });
});
```

- [ ] **Step 2: Run failing conductor tests**

Run:

```bash
npm test -- tests/conductor.test.ts
```

Expected: FAIL with missing `src/conductor.js`.

- [ ] **Step 3: Implement conductor**

Create `src/conductor.ts`:

```ts
import { createHash } from "node:crypto";

export type ConductorLevel = "low" | "medium" | "high";
export type ConductorRole = "planner" | "worker" | "verifier";
export type ConductorScaffoldId = "single-pass" | "plan-execute-verify" | "iterative-repair";

export type ConductorInput = {
  objective: string;
  risk: ConductorLevel;
  complexity: ConductorLevel;
  requiredStrengths: string[];
  modelProfileIds: string[];
};

export type ConductorStep = {
  stepId: string;
  role: ConductorRole;
  objective: string;
  preferredProfileId?: string;
};

export type ConductorTrace = {
  traceId: string;
  input: ConductorInput;
  scaffoldId: ConductorScaffoldId;
  reasonCodes: string[];
};

export type ConductorPlan = {
  scaffoldId: ConductorScaffoldId;
  steps: ConductorStep[];
  trace: ConductorTrace;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createConductorPlan(input: ConductorInput): ConductorPlan {
  const reasonCodes = [`risk:${input.risk}`, `complexity:${input.complexity}`];
  const scaffoldId: ConductorScaffoldId =
    input.risk === "high"
      ? "plan-execute-verify"
      : input.complexity === "high"
        ? "iterative-repair"
        : "single-pass";
  const profiles = input.modelProfileIds;
  const steps: ConductorStep[] =
    scaffoldId === "single-pass"
      ? [{ stepId: "step-1", role: "worker", objective: input.objective, preferredProfileId: profiles[0] }]
      : [
          { stepId: "step-1", role: "planner", objective: `Plan: ${input.objective}`, preferredProfileId: profiles[0] },
          { stepId: "step-2", role: "worker", objective: `Execute: ${input.objective}`, preferredProfileId: profiles[0] },
          { stepId: "step-3", role: "verifier", objective: `Verify: ${input.objective}`, preferredProfileId: profiles[1] ?? profiles[0] },
        ];
  const traceSeed = JSON.stringify({ input, scaffoldId, steps });
  return {
    scaffoldId,
    steps,
    trace: {
      traceId: `conductor:sha256:${sha256(traceSeed)}`,
      input: {
        ...input,
        requiredStrengths: [...input.requiredStrengths],
        modelProfileIds: [...input.modelProfileIds],
      },
      scaffoldId,
      reasonCodes,
    },
  };
}

export function replayConductorPlan(trace: ConductorTrace): ConductorPlan {
  return createConductorPlan(trace.input);
}
```

- [ ] **Step 4: Wire handler and MCP tools**

In `src/tools.ts`, import:

```ts
import { createConductorPlan, replayConductorPlan, type ConductorInput, type ConductorTrace } from "./conductor.js";
```

Add handlers:

```ts
    conductorPlan(input: ConductorInput) {
      return createConductorPlan(input);
    },

    conductorReplay(input: ConductorTrace) {
      return replayConductorPlan(input);
    },
```

In `src/mcp-server.ts`, register `conductor_plan` and `conductor_replay`.

- [ ] **Step 5: Run conductor tests**

Run:

```bash
npm test -- tests/conductor.test.ts tests/tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/conductor.ts src/tools.ts src/mcp-server.ts tests/conductor.test.ts tests/tools.test.ts
git commit -m "feat: add deterministic conductor scaffolds"
```

---

### Task 6: Caveman/Ponytail-Near Behavior Policy

**Files:**
- Create: `src/behavior-policy.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/behavior-policy.test.ts`

- [ ] **Step 1: Write behavior policy tests**

Create `tests/behavior-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createBehaviorPolicyStore } from "../src/behavior-policy.js";

describe("behavior policy store", () => {
  it("persists brevity and minimality modes", () => {
    const store = createBehaviorPolicyStore();
    const updated = store.setMode({
      brevity: "dense",
      minimality: "strict",
    });

    expect(updated.brevity).toBe("dense");
    expect(store.getMode().minimality).toBe("strict");
  });

  it("applies dense output without dropping literals", () => {
    const store = createBehaviorPolicyStore();
    store.setMode({ brevity: "dense", minimality: "review" });

    const result = store.apply({
      text: "Run `npm test` before commit. This sentence is extra explanation. Keep path `src/tools.ts`.",
    });

    expect(result.text).toContain("`npm test`");
    expect(result.text).toContain("`src/tools.ts`");
    expect(result.estimatedTokensSaved).toBeGreaterThanOrEqual(0);
  });

  it("reviews overbuilt plans", () => {
    const store = createBehaviorPolicyStore();
    const result = store.reviewMinimality({
      objective: "Add a small report",
      planSteps: ["Create a distributed event bus", "Deploy kubernetes"],
    });

    expect(result.findings.map((finding) => finding.phrase)).toEqual([
      "kubernetes",
      "distributed event bus",
      "event bus",
    ]);
  });
});
```

- [ ] **Step 2: Run failing behavior policy tests**

Run:

```bash
npm test -- tests/behavior-policy.test.ts
```

Expected: FAIL with missing `src/behavior-policy.js`.

- [ ] **Step 3: Implement behavior policy store**

Create `src/behavior-policy.ts`:

```ts
import { createDenseSummary, reviewMinimality, type OptimizationFinding } from "./optimization.js";

export type BrevityMode = "normal" | "dense" | "ultra";
export type MinimalityMode = "off" | "review" | "strict";

export type BehaviorMode = {
  brevity: BrevityMode;
  minimality: MinimalityMode;
};

export type BehaviorPolicyStore = {
  setMode(input: Partial<BehaviorMode>): BehaviorMode;
  getMode(): BehaviorMode;
  apply(input: { text: string }): { text: string; estimatedTokensSaved: number };
  reviewMinimality(input: { objective: string; planSteps: string[] }): { text: string; findings: OptimizationFinding[] };
};

export function createBehaviorPolicyStore(): BehaviorPolicyStore {
  let mode: BehaviorMode = { brevity: "normal", minimality: "review" };

  return {
    setMode(input) {
      mode = {
        brevity: input.brevity ?? mode.brevity,
        minimality: input.minimality ?? mode.minimality,
      };
      return { ...mode };
    },
    getMode() {
      return { ...mode };
    },
    apply(input) {
      if (mode.brevity === "normal") {
        return { text: input.text, estimatedTokensSaved: 0 };
      }
      const summary = createDenseSummary({
        text: input.text,
        maxBullets: mode.brevity === "ultra" ? 3 : 5,
        maxBulletLength: mode.brevity === "ultra" ? 80 : 120,
      });
      const literals = input.text.match(/`[^`]+`/g) ?? [];
      const literalBlock = literals.length > 0 ? `\n${literals.join(" ")}` : "";
      return {
        text: `${summary.content}${literalBlock}`.trim(),
        estimatedTokensSaved: summary.estimatedTokensSaved ?? 0,
      };
    },
    reviewMinimality(input) {
      if (mode.minimality === "off") {
        return { text: "- low: Minimality review is off.", findings: [] };
      }
      const result = reviewMinimality(input);
      return {
        text: result.content,
        findings: result.findings ?? [],
      };
    },
  };
}
```

- [ ] **Step 4: Wire behavior handlers and MCP tools**

In `src/tools.ts`, import and instantiate:

```ts
import { createBehaviorPolicyStore, type BehaviorMode } from "./behavior-policy.js";
```

Inside `createToolHandlers`:

```ts
  const behaviorPolicy = createBehaviorPolicyStore();
```

Add handlers:

```ts
    behaviorModeSet(input: Partial<BehaviorMode>) {
      return behaviorPolicy.setMode(input);
    },

    behaviorModeGet() {
      return behaviorPolicy.getMode();
    },

    behaviorApply(input: { text: string }) {
      return behaviorPolicy.apply(input);
    },

    behaviorMinimalityReview(input: { objective: string; planSteps: string[] }) {
      return behaviorPolicy.reviewMinimality(input);
    },
```

In `src/mcp-server.ts`, register:

```text
behavior_mode_set
behavior_mode_get
behavior_apply
behavior_minimality_review
```

- [ ] **Step 5: Run behavior tests**

Run:

```bash
npm test -- tests/behavior-policy.test.ts tests/tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/behavior-policy.ts src/tools.ts src/mcp-server.ts tests/behavior-policy.test.ts tests/tools.test.ts
git commit -m "feat: add durable behavior policy modes"
```

---

### Task 7: Public Surface, Capabilities, And Docs

**Files:**
- Modify: `src/capabilities.ts`
- Modify: `README.md`
- Modify: `docs/architecture/orchestration-adaptive-capabilities.md`
- Modify: `docs/contracts/capability-manifest.md`
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
- Modify: `plugins/wormhole/.codex-plugin/plugin.json`
- Modify: `tests/capabilities.test.ts`
- Modify: `tests/plugin.test.ts`
- Modify: `tests/mcp-server.test.ts`

- [ ] **Step 1: Update capability tests**

In `tests/capabilities.test.ts`, extend the implemented capability assertion with:

```ts
        "orchestration.graph-artifact-suite",
        "orchestration.optimized-command-runner",
        "orchestration.native-tool-factory",
        "adaptive.deterministic-conductor",
        "adaptive.durable-behavior-policy",
        "adaptive.optional-python-sidecar",
```

- [ ] **Step 2: Update plugin tests**

In `tests/plugin.test.ts`, assert the Claude Desktop tool list includes:

```ts
    expect(manifest.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "repo_graph_export",
        "optimized_command_run",
        "optimization_stats",
        "tool_factory_generate",
        "conductor_plan",
        "conductor_replay",
        "behavior_mode_set",
        "behavior_apply",
      ]),
    );
```

- [ ] **Step 3: Update MCP smoke test**

In `tests/mcp-server.test.ts`, rename the test:

```ts
  it("creates an MCP server for the native near-equivalent tool surface", () => {
```

Keep the existing `server.isConnected()` assertion. This repository does not currently expose MCP SDK internals for direct tool enumeration in this test.

- [ ] **Step 4: Update capability manifest**

In `src/capabilities.ts`, add implemented capability entries:

```ts
      {
        id: "orchestration.graph-artifact-suite",
        area: "orchestration",
        status: "implemented",
        description: "Graphify-near graph.json, GRAPH_REPORT.md, graph.html, graph metrics, and deterministic community analysis for native repo graphs.",
      },
      {
        id: "orchestration.optimized-command-runner",
        area: "orchestration",
        status: "implemented",
        description: "Headroom/RTK-near no-shell command execution with reversible output optimization, retrieval handles, hashes, and savings stats.",
      },
      {
        id: "orchestration.native-tool-factory",
        area: "orchestration",
        status: "implemented",
        description: "Printing-Press-near deterministic generation of CLI/MCP scaffold files from constrained tool specs.",
      },
      {
        id: "adaptive.deterministic-conductor",
        area: "adaptive",
        status: "implemented",
        description: "Fugu-near deterministic planner/worker/verifier scaffolds with replayable conductor traces.",
      },
      {
        id: "adaptive.durable-behavior-policy",
        area: "adaptive",
        status: "implemented",
        description: "Caveman/Ponytail-near durable brevity and minimality modes with dense output and minimality review primitives.",
      },
```

- [ ] **Step 5: Update docs**

In `README.md`, add a `## Near-Equivalent Runtime Suite` section:

```md
## Near-Equivalent Runtime Suite

Wormhole implements native runtime equivalents for the practical parts of several systems that influenced its design:

- Graphify-near: `repo_index_*`, `repo_graph_export`, Python graph metrics, and graph communities.
- Headroom/RTK-near: `optimization_apply`, `optimization_retrieve`, `optimized_command_run`, and `optimization_stats`.
- Printing Press-near: `printing_press_*` runtime tools and `tool_factory_generate`.
- Fugu-near: `model_profile_*`, `conductor_plan`, and `conductor_replay`.
- Caveman/Ponytail-near: `behavior_mode_set`, `behavior_mode_get`, `behavior_apply`, and `behavior_minimality_review`.

These features are native Wormhole capabilities. They do not vendor the external projects and do not claim full product parity for multimodal extraction, shell hooks, website crawling, or learned RL orchestration.
```

In `docs/architecture/orchestration-adaptive-capabilities.md`, add a matching architecture section with the same tool names and a note that TypeScript owns policy while Python owns optional graph/trace analysis jobs.

In `docs/contracts/capability-manifest.md`, add the new capability IDs under the implemented orchestration/adaptive lists.

- [ ] **Step 6: Update plugin metadata**

In `plugins/wormhole-claude-desktop/manifest.json`, add tool entries for:

```json
{"name": "repo_graph_export"},
{"name": "optimized_command_run"},
{"name": "optimization_stats"},
{"name": "tool_factory_generate"},
{"name": "conductor_plan"},
{"name": "conductor_replay"},
{"name": "behavior_mode_set"},
{"name": "behavior_mode_get"},
{"name": "behavior_apply"},
{"name": "behavior_minimality_review"}
```

In `plugins/wormhole/.codex-plugin/plugin.json`, add this sentence to the long description:

```json
"Wormhole also exposes near-equivalent native runtime tools for graph artifacts, optimized command execution, deterministic tool generation, conductor scaffolds, and durable brevity/minimality policy."
```

- [ ] **Step 7: Run surface tests**

Run:

```bash
npm test -- tests/capabilities.test.ts tests/plugin.test.ts tests/mcp-server.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/capabilities.ts README.md docs/architecture/orchestration-adaptive-capabilities.md docs/contracts/capability-manifest.md plugins/wormhole-claude-desktop/manifest.json plugins/wormhole/.codex-plugin/plugin.json tests/capabilities.test.ts tests/plugin.test.ts tests/mcp-server.test.ts
git commit -m "docs: expose near-equivalent runtime suite"
```

---

### Task 8: Final Verification

**Files:**
- All files changed by Tasks 0-7.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/python-sidecar.test.ts tests/python-sidecar-runner.test.ts tests/python-sidecar-communities.test.ts tests/graph-artifacts.test.ts tests/optimization-stats.test.ts tests/optimized-command-runner.test.ts tests/tool-factory.test.ts tests/conductor.test.ts tests/behavior-policy.test.ts tests/tools.test.ts tests/mcp-server.test.ts tests/capabilities.test.ts tests/plugin.test.ts
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

- [ ] **Step 7: Check naming**

Run:

```bash
rg -n "\b[Vv][123]\b|v[123]\." README.md docs plugins src tests
```

Expected: no matches.

- [ ] **Step 8: Inspect final diff**

Run:

```bash
git status --short --branch
git diff --stat
git diff --check
```

Expected: only intended near-equivalent runtime suite files changed; `git diff --check` has no whitespace errors.

- [ ] **Step 9: Push**

Run:

```bash
git push origin main
```

Expected: `main -> main`.

---

## Self-Review

**Spec coverage:** Graphify-near is covered by Tasks 1-2. Headroom/RTK-near is covered by Task 3. Printing Press-near is covered by Task 4. Fugu-near is covered by Task 5. Caveman/Ponytail-near is covered by Task 6. Python usage is covered by Tasks 0-1 and remains optional.

**Placeholder scan:** The plan contains concrete files, tests, code snippets, commands, and expected outcomes. It does not rely on unnamed modules or unspecified behavior.

**Type consistency:** Public MCP tool names are `repo_graph_export`, `optimized_command_run`, `optimization_stats`, `tool_factory_generate`, `conductor_plan`, `conductor_replay`, `behavior_mode_set`, `behavior_mode_get`, `behavior_apply`, and `behavior_minimality_review`. Internal handler names are their camelCase equivalents.
