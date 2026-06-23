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
});
