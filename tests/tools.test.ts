import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createIndexHealthSnapshot } from "../src/index-health.js";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

function runGit(repoRoot: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

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

  it("exposes lifecycle gap closure handlers with safety boundaries", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-life-tools-"));
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-life-outside-"));
    const calls: Array<{ timeoutMs: number }> = [];
    try {
      runGit(repoRoot, ["init", "-b", "main"]);
      runGit(repoRoot, ["config", "user.name", "Wormhole Test"]);
      runGit(repoRoot, ["config", "user.email", "wormhole@example.test"]);
      writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ dependencies: { zod: "4.0.0" } }));
      writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
      writeFileSync(path.join(repoRoot, "README.md"), "# Lifecycle\n");
      runGit(repoRoot, ["add", "--", "README.md", "package.json", "package-lock.json"]);
      runGit(repoRoot, ["commit", "--no-verify", "--message=initial"]);
      writeFileSync(path.join(repoRoot, "feature.ts"), "export const feature = true;\n");

      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
        dependencyAuditRunner: (_command, _args, options) => {
          calls.push({ timeoutMs: options.timeoutMs });
          return { status: 0, stdout: JSON.stringify({ vulnerabilities: {} }), stderr: "" };
        },
      });

      expect(tools.gitLifecycleStatus({ repoRoot }).changedFiles).toContain("feature.ts");
      expect(tools.gitBranchPrepare({ objective: "Close lifecycle gaps", prefix: "IQx" }).branchName).toBe(
        "IQx/close-lifecycle-gaps",
      );
      expect(tools.gitCommitPrepare({ repoRoot, objective: "Close lifecycle gaps" }).advisory).toBe(true);
      expect(tools.gitPrPrepare({ repoRoot, baseRef: "main", objective: "Close lifecycle gaps" }).body).toContain(
        "## Summary",
      );
      expect(tools.gitCommitCreate({ repoRoot, files: [path.join(outsideRoot, "outside.ts")], message: "feat: bad" }))
        .toMatchObject({ refused: true });
      expect(tools.dependencyRiskReport({ repoRoot }).local.packageManager).toBe("npm");
      expect(tools.dependencyAuditLive({ repoRoot, timeoutMs: 999_999 }).refused).toBe(false);
      expect(calls[0]?.timeoutMs).toBe(120_000);
      expect(tools.docsSyncCheck({ repoRoot, changedFiles: ["feature.ts"] }).decision).toBe("pass");
      expect(tools.workspaceGraphAnalyze({ repoRoot }).summary.repoCount).toBe(1);
      expect(() => tools.workspaceGraphAnalyze({ repoRoot, additionalRepoRoots: [outsideRoot] })).toThrow(
        "Repo root must stay within an allowed workspace root",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("analyzes source conflicts through the public tool handler", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-source-conflict-tool-"));
    try {
      mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
      mkdirSync(path.join(repoRoot, "src"), { recursive: true });
      writeFileSync(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }, null, 2),
      );
      writeFileSync(path.join(repoRoot, "src", "existing.ts"), "export const existing = true;\n");
      writeFileSync(
        path.join(repoRoot, "docs", "architecture.md"),
        [
          "# Architecture",
          "",
          "See [missing](../src/missing.ts).",
          "Run `npm run deploy` before release.",
        ].join("\n"),
      );

      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const result = tools.sourceConflictsAnalyze({ repoRoot });

      expect(result.indexFingerprint).toEqual(expect.any(String));
      expect(result.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subject: "docs/architecture.md -> src/missing.ts",
            resolution: "needs_validation",
          }),
          expect.objectContaining({
            subject: "script:deploy",
            resolution: "trust_authoritative",
          }),
        ]),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("closes the mission gate when supplied source conflicts include stale generated artifacts", () => {
    const kernel = createInMemoryKernel();
    const tools = createToolHandlers(kernel);
    const mission = tools.missionStart({
      objective: "Plan from current repo facts.",
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

    const gate = tools.gateRequest({
      missionId: mission.missionId,
      sourceConflicts: [
        {
          subject: ".wormhole/workflows/latest.json#indexFingerprint",
          authoritative: [
            {
              authority: "derived_code_fact",
              freshness: "current",
              authorityScore: 0.88,
              sourcePath: "repo-index",
              reason: "Current repo index fingerprint.",
            },
          ],
          conflicting: [
            {
              authority: "generated_note",
              freshness: "stale",
              authorityScore: 0.2,
              sourcePath: ".wormhole/workflows/latest.json",
              reason: "Generated workflow pointer was built from an old repo index.",
            },
          ],
          severity: "warning",
          resolution: "needs_validation",
          message: ".wormhole/workflows/latest.json was generated from a stale repo index fingerprint.",
        },
      ],
    });

    expect(gate.open).toBe(false);
    expect(gate.reasons).toContain(
      "Resolve stale generated artifact conflict for .wormhole/workflows/latest.json#indexFingerprint: .wormhole/workflows/latest.json was generated from a stale repo index fingerprint.",
    );
  });

  it("closes the mission gate from stored state-maintenance source conflicts and freshness", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-gate-maintenance-signals-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, ".wormhole", "workflows"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({ type: "module", scripts: { test: "vitest run tests" } }, null, 2),
    );
    writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = 1;\n");
    writeFileSync(
      path.join(repoRoot, ".wormhole", "workflows", "stale.json"),
      `${JSON.stringify({ indexFingerprint: "old-fingerprint" }, null, 2)}\n`,
    );

    try {
      const kernel = createInMemoryKernel();
      const tools = createToolHandlers(kernel, { allowedRepoRoots: [repoRoot] });
      const mission = tools.missionStart({
        objective: "Use current lifecycle facts.",
        repoRoot,
      });
      tools.roundStart({ missionId: mission.missionId });
      tools.recordEvidence({
        missionId: mission.missionId,
        sourceType: "file",
        sourcePath: "src/app.ts",
        retrievalMethod: "read_file",
        summary: "Current source file exists.",
      });
      tools.durableIndexManifestRefresh({ repoRoot });
      writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = 2;\n");

      const maintenance = tools.stateMaintenanceRun({
        repoRoot,
        missionId: mission.missionId,
        objective: "Use current lifecycle facts.",
        changedFiles: ["src/app.ts"],
        refreshGraph: false,
        sourceConflicts: true,
        freshness: true,
      });
      const gate = tools.gateRequest({ missionId: mission.missionId });

      expect(maintenance.sourceConflicts?.conflicts.length).toBeGreaterThan(0);
      expect(maintenance.freshness?.durableIndex.repoIndex?.fresh).toBe(false);
      expect(gate.open).toBe(false);
      expect(gate.reasons.join("\n")).toContain("stale generated artifact");
      expect(gate.reasons.join("\n")).toContain("Index health is stale");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("state maintenance starts an evidence round when recording maintenance evidence", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-maintenance-round-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = true;\n");

    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const mission = tools.missionStart({
        objective: "Record maintenance evidence.",
        repoRoot,
      });

      const maintenance = tools.stateMaintenanceRun({
        repoRoot,
        missionId: mission.missionId,
        objective: "Record maintenance evidence.",
        recordEvidence: true,
      });
      const gate = tools.gateRequest({ missionId: mission.missionId });

      expect(maintenance.status).toBe("completed");
      expect(maintenance.actions.map((action) => action.toolName)).toEqual(
        expect.arrayContaining(["round_start", "record_evidence"]),
      );
      expect(maintenance.recordedEvidence).toHaveLength(1);
      expect(gate.open).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("filters stored maintenance signals by mission/status and lets caller signals override them", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-gate-maintenance-filter-"));
    const runtimeStatePath = path.join(repoRoot, ".wormhole", "runtime-state.json");
    mkdirSync(path.dirname(runtimeStatePath), { recursive: true });
    writeFileSync(path.join(repoRoot, "evidence.md"), "fresh evidence\n");

    try {
      const kernel = createInMemoryKernel();
      const mission = kernel.startMission({
        objective: "Use stored maintenance signals.",
        repoRoot,
      });
      kernel.startRound(mission.missionId);
      kernel.recordEvidence(mission.missionId, {
        sourceType: "file",
        sourcePath: "evidence.md",
        retrievalMethod: "read_file",
        summary: "Evidence exists.",
      });
      const otherMission = kernel.startMission({
        objective: "Other mission.",
        repoRoot,
      });
      const freshHealth = createIndexHealthSnapshot({
        source: "durable_repo_index",
        present: true,
        fresh: true,
      });
      const staleHealth = createIndexHealthSnapshot({
        source: "durable_repo_index",
        present: true,
        fresh: false,
      });
      const storedConflict = {
        subject: "stored-conflict",
        authoritative: [],
        conflicting: [],
        severity: "blocking" as const,
        resolution: "needs_validation" as const,
        message: "Stored conflict blocks gate.",
      };
      const ignoredConflict = (subject: string) => ({
        subject,
        authoritative: [],
        conflicting: [],
        severity: "blocking" as const,
        resolution: "needs_validation" as const,
        message: `${subject} should be ignored.`,
      });
      const runBase = {
        repoRoot,
        objective: "Use stored maintenance signals.",
        query: "stored signals",
        input: {
          repoRoot,
          objective: "Use stored maintenance signals.",
        },
        changedFiles: [],
        actions: [],
        startedAt: "2026-06-28T00:00:00.000Z",
      };
      writeFileSync(
        runtimeStatePath,
        JSON.stringify(
          {
            stateMaintenance: {
              runs: [
                {
                  ...runBase,
                  runId: "old-source-conflicts",
                  status: "completed",
                  missionId: mission.missionId,
                  updatedAt: "2026-06-28T00:00:01.000Z",
                  sourceConflicts: { repoRoot, indexFingerprint: "old", conflicts: [storedConflict] },
                },
                {
                  ...runBase,
                  runId: "newer-freshness",
                  status: "completed",
                  missionId: mission.missionId,
                  updatedAt: "2026-06-28T00:00:02.000Z",
                  freshness: { indexHealth: staleHealth },
                },
                {
                  ...runBase,
                  runId: "newest-context-only",
                  status: "completed",
                  missionId: mission.missionId,
                  updatedAt: "2026-06-28T00:00:03.000Z",
                },
                {
                  ...runBase,
                  runId: "failed-run",
                  status: "failed",
                  missionId: mission.missionId,
                  updatedAt: "2026-06-28T00:00:04.000Z",
                  sourceConflicts: { repoRoot, indexFingerprint: "failed", conflicts: [ignoredConflict("failed-conflict")] },
                },
                {
                  ...runBase,
                  runId: "running-run",
                  status: "running",
                  missionId: mission.missionId,
                  updatedAt: "2026-06-28T00:00:05.000Z",
                  sourceConflicts: { repoRoot, indexFingerprint: "running", conflicts: [ignoredConflict("running-conflict")] },
                },
                {
                  ...runBase,
                  runId: "other-mission-run",
                  status: "completed",
                  missionId: otherMission.missionId,
                  updatedAt: "2026-06-28T00:00:06.000Z",
                  sourceConflicts: { repoRoot, indexFingerprint: "other", conflicts: [ignoredConflict("other-mission-conflict")] },
                },
              ],
            },
          },
          null,
          2,
        ),
      );
      const tools = createToolHandlers(kernel, {
        allowedRepoRoots: [repoRoot],
        runtimeStatePath,
      });

      const storedGate = tools.gateRequest({ missionId: mission.missionId });
      expect(storedGate.open).toBe(false);
      expect(storedGate.reasons.join("\n")).toContain("Stored conflict blocks gate.");
      expect(storedGate.reasons.join("\n")).toContain("Index health is stale");
      expect(storedGate.reasons.join("\n")).not.toContain("failed-conflict");
      expect(storedGate.reasons.join("\n")).not.toContain("running-conflict");
      expect(storedGate.reasons.join("\n")).not.toContain("other-mission-conflict");

      const overrideGate = tools.gateRequest({
        missionId: mission.missionId,
        sourceConflicts: [],
        freshness: { indexHealth: freshHealth },
      });
      expect(overrideGate.open).toBe(true);

      const freshOnlyKernel = createInMemoryKernel();
      const freshOnlyMission = freshOnlyKernel.startMission({
        objective: "Use fresh stored maintenance signals.",
        repoRoot,
      });
      freshOnlyKernel.startRound(freshOnlyMission.missionId);
      freshOnlyKernel.recordEvidence(freshOnlyMission.missionId, {
        sourceType: "file",
        sourcePath: "evidence.md",
        retrievalMethod: "read_file",
        summary: "Evidence exists.",
      });
      writeFileSync(
        runtimeStatePath,
        JSON.stringify(
          {
            stateMaintenance: {
              runs: [
                {
                  ...runBase,
                  runId: "fresh-run",
                  status: "completed",
                  missionId: freshOnlyMission.missionId,
                  updatedAt: "2026-06-28T00:00:07.000Z",
                  freshness: { indexHealth: freshHealth },
                },
              ],
            },
          },
          null,
          2,
        ),
      );
      const freshOnlyTools = createToolHandlers(freshOnlyKernel, {
        allowedRepoRoots: [repoRoot],
        runtimeStatePath,
      });

      expect(freshOnlyTools.gateRequest({ missionId: freshOnlyMission.missionId }).open).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
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
      const graphArtifacts = tools.repoGraphExport({
        repoRoot,
        communities: [{ id: "community-1", members: ["src/db.ts"] }],
      });
      const pythonProbe = await tools.pythonSidecarProbe();
      const pythonMetrics = await tools.pythonGraphMetrics({
        nodes: [{ id: "src/db.ts" }],
        edges: [],
      });
      const optimizedCommand = await tools.optimizedCommandRun({
        command: process.execPath,
        args: ["-e", "console.log('optimized command output')"],
        timeoutMs: 2_000,
      });
      const optimizationStats = tools.optimizationStats();
      const generatedTool = tools.toolFactoryGenerate({
        toolId: "demo-tool",
        displayName: "Demo Tool",
        description: "Demo generated tool.",
        commandName: "demo-tool",
        capabilities: ["demo"],
        inputs: [{ name: "query", type: "string", required: true }],
      });
      const conductor = tools.conductorPlan({
        objective: "Review native runtime",
        risk: "high",
        complexity: "medium",
        requiredStrengths: ["review"],
        modelProfileIds: ["small-local", "deep-reviewer"],
      });
      const replayed = tools.conductorReplay(conductor.trace);
      const behaviorMode = tools.behaviorModeSet({ brevity: "dense", minimality: "strict" });
      const behavior = tools.behaviorApply({
        text: "Run `npm test`. Keep `src/tools.ts`.",
      });
      const minimality = tools.behaviorMinimalityReview({
        objective: "Add a small report",
        planSteps: ["Deploy kubernetes"],
      });
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
      expect(graphArtifacts.graphJson).toContain("src/db.ts");
      expect(graphArtifacts.reportMarkdown).toContain("community-1");
      expect(pythonProbe.required).toBe(true);
      expect(pythonProbe.ok).toBe(true);
      expect(pythonProbe.packageName).toBe("wormhole_sidecar");
      expect(pythonMetrics.job).toBe("graph_metrics");
      expect(optimizedCommand.optimizedStdout).toContain("optimized command output");
      expect(optimizationStats.runCount).toBeGreaterThanOrEqual(1);
      expect(generatedTool.toolId).toBe("demo-tool");
      expect(conductor.scaffoldId).toBe("plan-execute-verify");
      expect(replayed.trace.traceId).toBe(conductor.trace.traceId);
      expect(behaviorMode).toEqual({ brevity: "dense", minimality: "strict" });
      expect(behavior.text).toContain("`npm test`");
      expect(minimality.findings.map((finding) => finding.phrase)).toContain("kubernetes");
      expect(verification.status).toBe("passed");
      expect(run.stdout).toContain("native printed tool");
      expect(route.profile.profileId).toBe("small-local");
      expect(outcome.profileStats.successCount).toBe(1);
      expect(tools.modelProfileExportTraces()).toContain(route.traceId);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("runs advanced native media, shell, discovery, and policy handlers", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-advanced-tools-"));
    const imagePath = path.join(repoRoot, "tiny.png");
    writeFileSync(
      imagePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGNgYPgPAAEDAQDq1X4bAAAAAElFTkSuQmCC",
        "base64",
      ),
    );

    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
      });
      const mediaDeps = await tools.mediaDependencyReport();
      const image = await tools.mediaIngestImage({
        repoRoot,
        sourcePath: imagePath,
        ocrMode: "auto",
      });
      const hookPlan = tools.shellHookPlan({
        shells: ["bash"],
        dryRun: true,
      });
      expect(() => tools.shellHookInstall({ shells: ["cmd"] })).toThrow(/apply/);
      expect(() => tools.shellHookInstall({ shells: ["bash"], apply: true })).toThrow(/planToken/);

      const har = tools.discoveryHarImport({
        harJson: {
          log: {
            version: "1.2",
            entries: [
              {
                request: {
                  method: "GET",
                  url: "https://api.example.test/users/123?expand=1",
                  headers: [{ name: "Authorization", value: "secret" }],
                },
                response: {
                  status: 200,
                  headers: [{ name: "Content-Type", value: "application/json" }],
                  content: { mimeType: "application/json", text: "{}" },
                },
              },
              {
                request: {
                  method: "GET",
                  url: "https://api.example.test/users/456?expand=1",
                  headers: [],
                },
                response: {
                  status: 200,
                  headers: [{ name: "Content-Type", value: "application/json" }],
                  content: { mimeType: "application/json", text: "{}" },
                },
              },
            ],
          },
        },
      });
      const openapi = tools.discoveryOpenApiImport({
        specText: JSON.stringify({
          openapi: "3.0.0",
          servers: [{ url: "https://api.example.test" }],
          paths: {
            "/users/{id}": {
              get: {
                operationId: "getUser",
                responses: { "200": { content: { "application/json": {} } } },
              },
            },
          },
        }),
        sourceName: "users.json",
      });
      const generated = tools.discoveryToolSpecGenerate({
        observations: [...har.observations, ...openapi.observations],
        baseCommand: "api-call",
      });
      const browser = await tools.discoveryBrowserCapture({
        url: "https://api.example.test",
        maxRequests: 1,
        timeoutMs: 10,
      });
      const trace = {
        traceId: "trace-1",
        taskKind: "feature",
        graphNodeCount: 100,
        evidenceCount: 4,
        openQuestions: 0,
        action: {
          workerCount: 2,
          verifierCount: 1,
          maxDepth: 3,
          modelProfile: "balanced",
          splitStrategy: "parallel" as const,
          contextBudget: "large" as const,
          evidenceMode: "strict" as const,
          stopRule: "verify" as const,
        },
        outcome: {
          testsPassed: true,
          evidenceCount: 4,
          openQuestions: 0,
          durationMs: 1_000,
          tokenEstimate: 2_000,
          userCorrectionCount: 0,
          reasoningScore: 0.9,
        },
      };
      const recorded = tools.orchestrationTraceRecord(trace);
      for (let index = 2; index <= 60; index += 1) {
        tools.orchestrationTraceRecord({ ...trace, traceId: `trace-${index}` });
      }
      const dataset = tools.orchestrationDatasetExport();
      const evaluation = tools.orchestrationPolicyEvaluate({
        policyJson: {
          policyId: "candidate",
          qTable: {
            "feature|graph:medium|evidence:medium|risk:low": {
              "workers=2|verifiers=1|depth=3|model=balanced|split=parallel|context=large|evidence=strict|stop=verify": 1,
            },
          },
        },
      });
      const baselineComparison = tools.orchestrationPolicyCompareBaselines({
        policyJson: {
          policyId: "candidate",
          qTable: {
            "feature|graph:medium|evidence:medium|risk:low": {
              "workers=2|verifiers=1|depth=3|model=balanced|split=parallel|context=large|evidence=strict|stop=verify": 1,
            },
          },
        },
      });
      tools.orchestrationPolicyActivate({ evaluationId: evaluation.evaluationId });
      const policyConductor = tools.conductorPlan({
        objective: "Use active policy",
        risk: "low",
        complexity: "low",
        requiredStrengths: ["coding"],
        modelProfileIds: ["small-local"],
      });
      const reasoningRecord = tools.reasoningTraceRecord({
        traceId: "reason-1",
        strategy: "critique-revise",
        taskKind: "feature",
        planSummary: "Plan with recorded evidence.",
        critiqueSummary: "Critique missing verification.",
        revisionSummary: "Add verification steps.",
        verifierSummary: "Verifier checks evidence coverage.",
        evidenceReferenced: 4,
        evidenceAvailable: 5,
        openQuestionsResolved: 2,
        openQuestionsRemaining: 0,
        outcome: "succeeded",
        userCorrections: 0,
      });
      tools.reasoningTraceRecord({
        traceId: "reason-2",
        strategy: "critique-revise",
        taskKind: "feature",
        planSummary: "Plan with repo evidence.",
        critiqueSummary: "Critique missing tests.",
        revisionSummary: "Add tests.",
        verifierSummary: "Verifier checks tests.",
        evidenceReferenced: 3,
        evidenceAvailable: 4,
        openQuestionsResolved: 1,
        openQuestionsRemaining: 0,
        outcome: "partial",
        userCorrections: 0,
      });
      const reasoningDataset = tools.reasoningDatasetExport();
      const reasoningEvaluation = tools.reasoningStrategyEvaluate();

      expect(mediaDeps.job).toBe("media_dependency_report");
      expect(image.kind).toBe("image");
      expect(hookPlan.operations[0]).toEqual(expect.objectContaining({ shell: "bash" }));
      expect(hookPlan.planToken).toMatch(/^shell-plan:/);
      expect(har.observations[0]?.pathTemplate).toBe("/users/{id}");
      expect(generated.toolSpecs.map((tool) => tool.toolId)).toEqual(["api_getUser"]);
      expect(browser.available).toBe(false);
      expect(recorded.traceId).toBe("trace-1");
      expect(dataset).toContain("trace-1");
      expect(evaluation.safetyViolations).toEqual([]);
      expect(baselineComparison.best.policyId).toBe("candidate");
      expect(tools.orchestrationPolicyGet()?.policyId).toBe("candidate");
      expect(policyConductor.trace.reasonCodes).toContain("policy:candidate");
      expect(policyConductor.scaffoldId).toBe("plan-execute-verify");
      expect(reasoningRecord.score.total).toBeGreaterThan(0.8);
      expect(reasoningDataset).toContain("reason-1");
      expect(reasoningEvaluation[0]).toMatchObject({
        strategy: "critique-revise",
        recommended: true,
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("runs native coordination-loop context, workspace, and live policy handlers", () => {
    const tools = createToolHandlers(createInMemoryKernel());
    const pinned = tools.ctxRecord({
      source: "src/shared.ts",
      sourceType: "file",
      text: "Shared coordination memory should stay available to workers.",
      tags: ["coordination"],
    });
    const stale = tools.ctxRecord({
      source: "src/old.ts",
      sourceType: "file",
      text: "Old coordination notes should be evicted from refreshed packs.",
      tags: ["stale"],
    });
    const review = tools.ctxPackBudgetReview({
      objective: "Coordinate parallel workers",
      query: "coordination workers",
      maxChars: 160,
      recordIds: [pinned.contextId, stale.contextId],
      pinnedRecordIds: [pinned.contextId],
      staleRecordIds: [stale.contextId],
    });
    const refreshed = tools.ctxPackRefresh({
      objective: "Coordinate parallel workers",
      query: "coordination workers",
      maxChars: 160,
      recordIds: [pinned.contextId, stale.contextId],
      pinnedRecordIds: [pinned.contextId],
      staleRecordIds: [stale.contextId],
    });
    const workspace = tools.agentWorkspaceCreate({
      missionId: "M1",
      objective: "Share worker findings.",
    });
    tools.agentWorkspaceWrite({
      workspaceId: workspace.workspaceId,
      runId: "run-a",
      key: "finding",
      value: "Worker A found a test gap.",
    });
    tools.agentWorkspaceWrite({
      workspaceId: workspace.workspaceId,
      runId: "run-b",
      key: "finding",
      value: "Worker B found a context gap.",
    });
    const merge = tools.agentWorkspaceMerge({
      workspaceId: workspace.workspaceId,
      runIds: ["run-a", "run-b"],
    });
    const feedback = tools.orchestrationPolicyLiveFeedback({
      traceId: "live-1",
      taskKind: "feature",
      graphNodeCount: 120,
      evidenceCount: 1,
      openQuestions: 1,
      action: {
        workerCount: 2,
        verifierCount: 0,
        maxDepth: 2,
        modelProfile: "balanced",
      },
      outcome: {
        testsPassed: false,
        evidenceCount: 1,
        openQuestions: 1,
        durationMs: 60_000,
        tokenEstimate: 75_000,
        userCorrectionCount: 1,
      },
    });

    expect(review.evicted.map((record) => record.contextId)).toEqual([stale.contextId]);
    expect(refreshed.pack.contextIds).toEqual([pinned.contextId]);
    expect(merge.conflicts.map((conflict) => conflict.key)).toEqual(["finding"]);
    expect(feedback.advisory.activationChanged).toBe(false);
    expect(feedback.advisory.recommendedAction.stopRule).toBe("escalate");
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
      const graphAnalysis = tools.repoGraphAnalyze({
        repoRoot,
        changedFiles: ["src/server.ts"],
        limit: 5,
      });

      expect(summary.fileCount).toBe(2);
      expect(summary.symbolCount).toBeGreaterThanOrEqual(2);
      expect(query.results[0].excerpt).toContain("database pool");
      expect(explanation.resolved?.name).toBe("connectDatabase");
      expect(dependencyPath.path).toEqual(["src/server.ts", "src/db.ts"]);
      expect(graphAnalysis.parserCoverage.treeSitterFiles).toBe(2);
      expect(graphAnalysis.affectedFlows[0]?.source).toBe("src/server.ts");
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

  it("exposes patch transaction checkpoint, apply, status, and rollback handlers", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-patch-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const name = 'old';\n");

    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
      });
      const checkpoint = tools.patchCheckpoint({
        repoRoot,
        label: "before patch",
        files: ["src/app.ts"],
      });
      const applied = tools.patchApply({
        repoRoot,
        checkpointId: checkpoint.checkpointId,
        unifiedDiff: [
          "diff --git a/src/app.ts b/src/app.ts",
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -1 +1 @@",
          "-export const name = 'old';",
          "+export const name = 'new';",
          "",
        ].join("\n"),
      });
      const status = tools.patchStatus({ repoRoot });
      const rolledBack = tools.patchRollback({
        repoRoot,
        transactionId: applied.transactionId,
      });

      expect(applied.status).toBe("applied");
      expect(status.transactions.map((transaction) => transaction.transactionId)).toContain(
        applied.transactionId,
      );
      expect(rolledBack.status).toBe("rolled_back");
      expect(readFileSync(path.join(repoRoot, "src", "app.ts"), "utf8")).toContain("'old'");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses patch apply when strict scope review fails before writing", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-patch-scope-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const name = 'old';\n");

    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
      });
      const checkpoint = tools.patchCheckpoint({
        repoRoot,
        files: ["src/app.ts"],
      });

      expect(() =>
        tools.patchApply({
          repoRoot,
          checkpointId: checkpoint.checkpointId,
          unifiedDiff: [
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "-export const name = 'old';",
            "+export const name = 'new';",
            "",
          ].join("\n"),
          scopeReview: {
            objective: "Fix billing webhook validation",
            strict: true,
          },
        }),
      ).toThrow(/Diff scope review failed/);

      expect(readFileSync(path.join(repoRoot, "src", "app.ts"), "utf8")).toBe("export const name = 'old';\n");
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
