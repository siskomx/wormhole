import { mkdtempSync } from "node:fs";
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
    const cacheRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-cache-"));
    const cache = tools.cacheEvidence({
      cacheRoot,
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

    expect(schedule.waves).toHaveLength(2);
    expect(reconciliation.status).toBe("merged");
    expect(route.selectedModel.modelId).toBe("local-coder");
    expect(cache.cacheKey).toMatch(/^sha256:/);
    expect(codex.pluginName).toBe("wormhole");
    expect(connector.connectorId).toBe("codex");
  });
});
