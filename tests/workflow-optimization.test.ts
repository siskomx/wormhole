import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

describe("optimization integration", () => {
  it("compacts command output evidence during record_evidence", () => {
    const kernel = createInMemoryKernel();
    const mission = kernel.startMission({
      objective: "Plan how to fix the build",
      repoRoot: process.cwd(),
    });

    kernel.startRound(mission.missionId);
    const evidence = kernel.recordEvidence(mission.missionId, {
      sourceType: "command_output",
      sourcePath: "npm test",
      retrievalMethod: "shell_command",
      summary: "The test command failed.",
      rawContent: [
        "npm test started",
        ...Array.from({ length: 60 }, (_, index) => `passing test ${index}`),
        "FAIL tests/kernel.test.ts",
        "Expected gate to open",
      ].join("\n"),
    });

    expect(evidence.optimizations).toContainEqual(
      expect.objectContaining({
        kind: "command_output_compaction",
      }),
    );
    expect(evidence.optimizedView).toContain("FAIL tests/kernel.test.ts");
  });

  it("adds a minimality review to emitted plans", () => {
    const kernel = createInMemoryKernel();
    const mission = kernel.startMission({
      objective: "Plan how to add audit logging",
      repoRoot: process.cwd(),
    });

    kernel.startRound(mission.missionId);
    kernel.recordEvidence(mission.missionId, {
      sourceType: "file",
      sourcePath: "README.md",
      retrievalMethod: "read_file",
      summary: "README describes the current Wormhole surface.",
    });
    kernel.requestGate(mission.missionId);

    const artifact = kernel.emitPlan(mission.missionId, {
      recommendedApproach: "Use a small adapter in the existing service.",
      implementationSteps: [
        "Create a Kubernetes microservice and distributed event bus.",
        "Add tests around the existing handler.",
      ],
      risks: ["Overbuilding could slow delivery."],
      verificationPlan: ["Run npm test."],
    });

    expect(artifact.optimizations).toContainEqual(
      expect.objectContaining({
        kind: "minimality_review",
      }),
    );
    expect(artifact.content).toContain("## Minimality review");
    expect(artifact.content).toContain("kubernetes");
  });

  it("exposes direct optimization through tool handlers", () => {
    const tools = createToolHandlers(createInMemoryKernel());

    const result = tools.optimizeText({
      kind: "dense_summary",
      content: "Wormhole captures raw evidence. Wormhole also creates optimized views for planning.",
    });

    expect(result.kind).toBe("dense_summary");
    expect(result.content).toContain("- Wormhole captures raw evidence.");
  });
});
