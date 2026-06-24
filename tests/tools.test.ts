import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

describe("Wormhole MCP tool handlers", () => {
  it("starts a mission and reports status through generic tool handlers", () => {
    const kernel = createInMemoryKernel();
    const tools = createToolHandlers(kernel);

    const started = tools.missionStart({
      objective: "Plan how to add audit logging",
      repoRoot: process.cwd(),
    });
    const status = tools.missionStatus({
      missionId: started.missionId,
    });

    expect(started.objective).toBe("Plan how to add audit logging");
    expect(status.roundsStarted).toBe(0);
    expect(status.evidenceCount).toBe(0);
  });

  it("emits plans through the generic tool handlers", () => {
    const kernel = createInMemoryKernel();
    const tools = createToolHandlers(kernel);

    const mission = tools.missionStart({
      objective: "Plan how to add audit logging",
      repoRoot: process.cwd(),
    });
    tools.roundStart({ missionId: mission.missionId });
    tools.recordEvidence({
      missionId: mission.missionId,
      sourceType: "file",
      sourcePath: "docs/planning/wormhole-canonical-plan.md",
      retrievalMethod: "read_file",
      summary: "Canonical plan exists.",
    });
    tools.gateRequest({ missionId: mission.missionId });

    const artifact = tools.emitPlan({
      missionId: mission.missionId,
      recommendedApproach: "Use the existing planning kernel.",
      implementationSteps: ["Add coverage.", "Emit the artifact."],
      risks: ["Plan quality depends on evidence quality."],
      verificationPlan: ["Run tests."],
    });

    expect(artifact.content).toContain("Use the existing planning kernel.");
  });

  it("exposes scheduling, reconciliation, routing, cache, and Codex adapter helpers", () => {
    const tools = createToolHandlers(createInMemoryKernel());
    const schedule = tools.scheduleTasks({
      tasks: [
        {
          taskId: "inspect",
          objective: "Inspect server",
          layer: 2,
          dependencies: [],
          readSet: ["src/server.ts"],
          writeSet: [],
        },
        {
          taskId: "edit",
          objective: "Edit server",
          layer: 3,
          dependencies: ["inspect"],
          readSet: ["src/server.ts"],
          writeSet: ["src/server.ts"],
        },
      ],
    });
    const reconciliation = tools.reconcileArtifacts({
      proposals: [
        {
          artifactId: "A1",
          taskId: "inspect",
          summary: "Use existing pattern.",
          evidenceIds: ["E1"],
          readSet: ["src/server.ts"],
          writeSet: [],
          risks: [],
        },
      ],
    });
    const route = tools.routeMission({
      taskCategory: "feature",
      ambiguity: "medium",
      risk: "medium",
      repoSize: "medium",
      requiresPrivacy: true,
      models: [
        {
          providerId: "local",
          modelId: "local-coder",
          strengths: ["coding", "planning"],
          maxDepth: 3,
          costTier: "medium",
          privacy: "local",
        },
      ],
    });
    const cacheRepoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-cache-repo-"));
    const cacheRoot = path.join(cacheRepoRoot, ".wormhole", "evidence-cache");
    const cache = tools.cacheEvidence({
      cacheRoot,
      repoRoot: cacheRepoRoot,
      content: "tool evidence",
      mediaType: "text/plain",
      source: "unit-test",
    });
    const codex = tools.codexAdapterConfig({ repoRoot: process.cwd() });
    const connector = tools.selectConnector({
      connectors: [
        {
          connectorId: "codex",
          target: "codex",
          transport: "plugin-manifest",
          capabilities: ["mcp", "planning"],
          installation: "installed",
          authentication: "on_install",
        },
      ],
      target: "codex",
      requiredCapabilities: ["mcp"],
    });
    const artifact = tools.createArtifact({
      missionId: "M1",
      type: "html_workbench",
      title: "Workbench",
      content: "<html></html>",
      evidenceIds: ["E1"],
      taskIds: ["T1"],
    });
    const workbench = tools.renderWorkbench({
      mission: {
        missionId: "M1",
        objective: "Plan with workbench",
        repoRoot: process.cwd(),
      },
      tasks: [
        {
          taskId: "T1",
          name: "Dax",
          status: "running",
          currentFlow: "Inspecting",
        },
      ],
      gate: { open: true, reasons: [] },
      artifacts: [{ artifactId: artifact.artifactId, type: artifact.type, title: artifact.title }],
    });

    expect(schedule.waves).toHaveLength(2);
    expect(reconciliation.status).toBe("merged");
    expect(route.selectedModel.modelId).toBe("local-coder");
    expect(cache.cacheKey).toMatch(/^sha256:/);
    expect(codex.pluginName).toBe("wormhole");
    expect(connector.connectorId).toBe("codex");
    expect(artifact.type).toBe("html_workbench");
    expect(workbench.html).toContain("Plan with workbench");
    rmSync(cacheRepoRoot, { recursive: true, force: true });
  });

  it("rejects cache roots outside the current repository", () => {
    const tools = createToolHandlers(createInMemoryKernel());
    const cacheRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-outside-cache-"));

    try {
      expect(() =>
        tools.cacheEvidence({
          cacheRoot,
          content: "tool evidence",
          mediaType: "text/plain",
          source: "unit-test",
        }),
      ).toThrow("Cache root must stay within repoRoot");
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("registers, dispatches, completes, and interrupts external agent runs", () => {
    const tools = createToolHandlers(createInMemoryKernel());
    const agent = tools.agentRegister({
      agentId: "hermes-local",
      displayName: "Hermes Local",
      target: "hermes-agent",
      transport: "mcp-stdio",
      capabilities: ["planning", "coding", "review"],
      installation: "installed",
      authentication: "none",
      maxConcurrentTasks: 2,
      supportsInterrupt: true,
    });

    const run = tools.agentDispatch({
      missionId: "M1",
      taskId: "T1",
      objective: "Inspect orchestration gaps.",
      requiredCapabilities: ["coding"],
    });
    const completed = tools.agentComplete({
      runId: run.runId,
      status: "completed",
      summary: "Found missing worker adapter boundary.",
      evidenceIds: ["E1"],
      artifactIds: ["A1"],
    });
    const secondRun = tools.agentDispatch({
      missionId: "M1",
      taskId: "T2",
      objective: "Review plugin surface.",
      requiredCapabilities: ["review"],
    });
    const interrupted = tools.agentInterrupt({
      runId: secondRun.runId,
      reason: "User changed direction.",
    });

    expect(agent.agentId).toBe("hermes-local");
    expect(run.assignedAgentId).toBe("hermes-local");
    expect(completed.result?.artifactIds).toEqual(["A1"]);
    expect(tools.agentStatus({ runId: run.runId }).status).toBe("completed");
    expect(interrupted.status).toBe("interrupted");
    expect(tools.agentList().map((registered) => registered.agentId)).toEqual(["hermes-local"]);
  });

  it("registers Printing Press CLIs as dispatchable external agents", () => {
    const tools = createToolHandlers(createInMemoryKernel());
    const cli = tools.printingPressRegister({
      cliId: "pp-linear",
      displayName: "Printing Press Linear",
      command: "/pp-linear",
      args: ["sql"],
      capabilities: ["project-management", "evidence", "sqlite-query"],
      installation: "installed",
      authentication: "on_use",
      evidenceMode: "sqlite",
      providesMcpServer: true,
      supportsInterrupt: false,
      maxConcurrentTasks: 2,
    });
    const selected = tools.printingPressSelect({
      requiredCapabilities: ["project-management", "sqlite-query"],
    });
    const agent = tools.printingPressRegisterAgent({ cliId: "pp-linear" });
    const run = tools.agentDispatch({
      missionId: "M1",
      taskId: "T1",
      objective: "Find blocked project-management issues.",
      requiredCapabilities: ["project-management"],
      preferredTargets: ["printing-press"],
    });

    expect(cli.cliId).toBe("pp-linear");
    expect(selected.cliId).toBe("pp-linear");
    expect(agent.agentId).toBe("printing-press:pp-linear");
    expect(run.assignedAgentId).toBe("printing-press:pp-linear");
    expect(tools.printingPressList().map((registered) => registered.cliId)).toEqual([
      "pp-linear",
    ]);
  });

  it("runs native context, optimization, printed-tool, graph report, and model-profile handlers", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-native-runtime-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "db.ts"),
      "export function connectDatabase() { return 'database pool'; }\n",
    );

    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
      });
      const context = tools.ctxRecord({
        source: "src/db.ts",
        sourceType: "file",
        text: "connectDatabase returns the database pool.",
        tags: ["database"],
      });
      const pack = tools.ctxPackCreate({
        objective: "Plan database work",
        query: "database pool",
        maxChars: 200,
      });
      const optimized = tools.optimizationApply({
        kind: "auto",
        content: JSON.stringify([{ level: "error", message: "database failed" }]),
      });
      const retrieved = tools.optimizationRetrieve({
        retrievalId: optimized.retrievalId,
      });
      tools.repoIndexBuild({ repoRoot });
      const report = tools.repoIndexReport({ repoRoot });
      tools.printingPressRegister({
        cliId: "pp-node",
        displayName: "Node Printed Tool",
        command: process.execPath,
        args: ["-e", "console.log('native printed tool')"],
        capabilities: ["evidence"],
        installation: "installed",
        authentication: "none",
        evidenceMode: "compact",
        providesMcpServer: false,
        supportsInterrupt: false,
        maxConcurrentTasks: 1,
      });
      const verification = tools.printingPressVerify({ cliId: "pp-node" });
      const run = await tools.printingPressRun({ cliId: "pp-node", timeoutMs: 2_000 });
      tools.modelProfileRegister({
        profileId: "small-local",
        providerId: "local",
        modelId: "mini-coder",
        strengths: ["coding"],
        modes: ["fast"],
        costTier: "low",
        latencyTier: "low",
        privacy: "local",
        contextWindow: 16_000,
      });
      const route = tools.modelProfileSelect({
        taskType: "coding",
        mode: "fast",
        requiredStrengths: ["coding"],
      });
      const outcome = tools.modelProfileRecordOutcome({
        traceId: route.traceId,
        status: "succeeded",
        latencyMs: 50,
        outputQuality: 5,
      });

      expect(context.contextId).toMatch(/^ctx:sha256:/);
      expect(pack.rendered).toContain("connectDatabase");
      expect(retrieved.originalContent).toContain("database failed");
      expect(report.markdown).toContain("Native Repo Graph Report");
      expect(verification.status).toBe("passed");
      expect(run.stdout).toContain("native printed tool");
      expect(route.profile.profileId).toBe("small-local");
      expect(outcome.profileStats.successCount).toBe(1);
      expect(tools.modelProfileExportTraces()).toContain(route.traceId);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("builds and queries the repo index through generic tool handlers", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-index-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "server.ts"),
      [
        'import { connectDatabase } from "./db";',
        "",
        "export function startServer() {",
        "  return connectDatabase('primary');",
        "}",
      ].join("\n"),
    );
    writeFileSync(
      path.join(repoRoot, "src", "db.ts"),
      [
        "export function connectDatabase(name: string) {",
        "  return `database pool ${name}`;",
        "}",
      ].join("\n"),
    );

    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
      });
      const summary = tools.repoIndexBuild({ repoRoot });
      const query = tools.repoIndexQuery({
        repoRoot,
        query: "database pool",
        limit: 3,
      });
      const explanation = tools.repoIndexExplain({
        repoRoot,
        target: "connectDatabase",
      });
      const dependencyPath = tools.repoIndexPath({
        repoRoot,
        from: "src/server.ts",
        to: "src/db.ts",
      });

      expect(summary.fileCount).toBe(2);
      expect(summary.symbolCount).toBeGreaterThanOrEqual(2);
      expect(query.results[0].excerpt).toContain("database pool");
      expect(explanation.resolved?.name).toBe("connectDatabase");
      expect(dependencyPath.path).toEqual(["src/server.ts", "src/db.ts"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects repo index roots outside allowed workspace roots", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-index-outside-"));
    writeFileSync(path.join(repoRoot, "secret.txt"), "do not index outside workspace\n");

    try {
      const tools = createToolHandlers(createInMemoryKernel());

      expect(() => tools.repoIndexBuild({ repoRoot })).toThrow(
        "Repo root must stay within an allowed workspace root",
      );
      expect(() =>
        tools.repoIndexQuery({
          repoRoot,
          query: "secret",
        }),
      ).toThrow("Repo root must stay within an allowed workspace root");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refreshes cached repo indexes when files change", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-index-refresh-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    const filePath = path.join(repoRoot, "src", "state.ts");
    writeFileSync(filePath, "export const state = 'old-value';\n");

    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
      });

      expect(
        tools.repoIndexQuery({
          repoRoot,
          query: "old-value",
        }).results[0].excerpt,
      ).toContain("old-value");

      writeFileSync(filePath, "export const state = 'new-value';\n");

      expect(
        tools.repoIndexQuery({
          repoRoot,
          query: "new-value",
        }).results[0].excerpt,
      ).toContain("new-value");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not let filtered index builds poison default repo index queries", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-index-filtered-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = true;\n");
    writeFileSync(path.join(repoRoot, "docs", "notes.md"), "default graph should find docs\n");

    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
      });

      const filtered = tools.repoIndexBuild({
        repoRoot,
        include: ["src"],
      });
      const query = tools.repoIndexQuery({
        repoRoot,
        query: "find docs",
      });

      expect(filtered.fileCount).toBe(1);
      expect(query.results[0].path).toBe("docs/notes.md");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("plans and runs local orchestration without external adapters", async () => {
    const tools = createToolHandlers(createInMemoryKernel());
    const tasks = [
      {
        taskId: "inspect",
        objective: "Inspect repo",
        layer: 2 as const,
        dependencies: [],
        readSet: ["src/server.ts"],
        writeSet: [],
      },
      {
        taskId: "edit",
        objective: "Edit repo",
        layer: 3 as const,
        dependencies: ["inspect"],
        readSet: ["src/server.ts"],
        writeSet: ["src/server.ts"],
      },
    ];
    const plan = tools.orchestrationPlanLocal({
      missionId: "M1",
      tasks,
      maxDepth: 3,
      maxTasks: 4,
    });
    const run = await tools.orchestrationRunLocal({
      missionId: "M1",
      tasks,
      maxDepth: 3,
      maxTasks: 4,
      outcomes: [
        {
          taskId: "inspect",
          status: "completed",
          output: "inspected",
        },
        {
          taskId: "edit",
          status: "completed",
          output: "edited",
        },
      ],
    });

    expect(plan.status).toBe("planned");
    expect(plan.schedule.waves.map((wave) => wave.map((task) => task.taskId))).toEqual([
      ["inspect"],
      ["edit"],
    ]);
    expect(run.status).toBe("completed");
    expect(run.results.map((result) => result.output)).toEqual(["inspected", "edited"]);
  });
});
