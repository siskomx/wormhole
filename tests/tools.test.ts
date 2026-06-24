import { mkdtempSync, rmSync } from "node:fs";
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
});
