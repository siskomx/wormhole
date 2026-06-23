import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";

describe("Wormhole v1 kernel", () => {
  it("opens the gate after a mission records evidence with no blocking questions", () => {
    const kernel = createInMemoryKernel();

    const mission = kernel.startMission({
      objective: "Plan how to add audit logging",
      repoRoot: process.cwd(),
    });

    kernel.startRound(mission.missionId);
    kernel.recordEvidence(mission.missionId, {
      sourceType: "file",
      sourcePath: "docs/planning/wormhole-canonical-plan.md",
      retrievalMethod: "read_file",
      summary: "Audit logging helpers already exist.",
    });

    const gate = kernel.requestGate(mission.missionId);

    expect(gate.open).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it("closes the gate when no evidence has been recorded", () => {
    const kernel = createInMemoryKernel();
    const mission = kernel.startMission({
      objective: "Plan how to add audit logging",
      repoRoot: process.cwd(),
    });

    const gate = kernel.requestGate(mission.missionId);

    expect(gate.open).toBe(false);
    expect(gate.reasons).toContain("At least one evidence record is required");
  });

  it("closes the gate when a blocking question has no assumption fallback", () => {
    const kernel = createInMemoryKernel();
    const mission = kernel.startMission({
      objective: "Plan how to add audit logging",
      repoRoot: process.cwd(),
    });

    kernel.startRound(mission.missionId);
    kernel.recordEvidence(mission.missionId, {
      sourceType: "file",
      sourcePath: "docs/planning/wormhole-canonical-plan.md",
      retrievalMethod: "read_file",
      summary: "Canonical plan exists.",
    });
    kernel.recordQuestion(mission.missionId, {
      question: "Which logging backend should be used?",
      blocking: true,
      rationale: "The backend changes the implementation steps.",
    });

    const gate = kernel.requestGate(mission.missionId);

    expect(gate.open).toBe(false);
    expect(gate.reasons).toContain(
      "Blocking questions require answers or assumption fallbacks",
    );
  });

  it("opens the gate after a blocking question is accepted as an assumption", () => {
    const kernel = createInMemoryKernel();
    const mission = kernel.startMission({
      objective: "Plan how to add audit logging",
      repoRoot: process.cwd(),
    });

    kernel.startRound(mission.missionId);
    kernel.recordEvidence(mission.missionId, {
      sourceType: "file",
      sourcePath: "docs/planning/wormhole-canonical-plan.md",
      retrievalMethod: "read_file",
      summary: "Canonical plan exists.",
    });
    const question = kernel.recordQuestion(mission.missionId, {
      question: "Which logging backend should be used?",
      blocking: true,
      rationale: "The backend changes the implementation steps.",
    });

    kernel.updateQuestion(mission.missionId, question.questionId, {
      status: "accepted_as_assumption",
      assumptionFallback: "Use the existing application logger.",
    });
    const gate = kernel.requestGate(mission.missionId);

    expect(gate.open).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it("blocks plan emission until the gate is open", () => {
    const kernel = createInMemoryKernel();
    const mission = kernel.startMission({
      objective: "Plan how to add audit logging",
      repoRoot: process.cwd(),
    });

    expect(() =>
      kernel.emitPlan(mission.missionId, {
        recommendedApproach: "Add a repository-local audit logging adapter.",
        implementationSteps: ["Identify call sites.", "Add tests.", "Wire the adapter."],
        risks: ["The storage backend may not be configured."],
        verificationPlan: ["Run unit tests.", "Run an integration smoke test."],
      }),
    ).toThrow("Gate must be open before emitting a plan");
  });

  it("emits an evidence-cited Markdown plan after the gate opens", () => {
    const kernel = createInMemoryKernel();
    const mission = kernel.startMission({
      objective: "Plan how to add audit logging",
      repoRoot: process.cwd(),
    });

    kernel.startRound(mission.missionId);
    const evidence = kernel.recordEvidence(mission.missionId, {
      sourceType: "file",
      sourcePath: "docs/planning/wormhole-canonical-plan.md",
      lineStart: 342,
      lineEnd: 370,
      retrievalMethod: "read_file",
      summary: "The canonical plan defines the required final artifact and MCP surface.",
    });
    kernel.recordQuestion(mission.missionId, {
      question: "Which logging backend should be used?",
      blocking: false,
      rationale: "The plan can proceed with an adapter recommendation.",
      assumptionFallback: "Use the existing application logger.",
    });
    kernel.requestGate(mission.missionId);

    const artifact = kernel.emitPlan(mission.missionId, {
      recommendedApproach: "Add a repository-local audit logging adapter.",
      implementationSteps: ["Identify call sites.", "Add tests.", "Wire the adapter."],
      risks: ["The storage backend may not be configured."],
      verificationPlan: ["Run unit tests.", "Run an integration smoke test."],
    });

    expect(artifact.evidenceIds).toEqual([evidence.evidenceId]);
    expect(artifact.content).toContain("## Objective");
    expect(artifact.content).toContain("## Repo evidence summary");
    expect(artifact.content).toContain("## Open questions and assumptions");
    expect(artifact.content).toContain("## Recommended approach");
    expect(artifact.content).toContain("## Implementation steps");
    expect(artifact.content).toContain("## Risks");
    expect(artifact.content).toContain("## Verification plan");
    expect(artifact.content).toContain("[E1]");
    expect(artifact.content).toContain("docs/planning/wormhole-canonical-plan.md:342-370");
    expect(kernel.missionStatus(mission.missionId).artifactCount).toBe(1);
  });

  it("marks deleted file evidence as stale when emitting a plan", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wormhole-stale-evidence-"));
    const evidencePath = path.join(tempDir, "evidence.md");
    writeFileSync(evidencePath, "initial evidence", "utf8");

    try {
      const kernel = createInMemoryKernel();
      const mission = kernel.startMission({
        objective: "Plan how to add audit logging",
        repoRoot: tempDir,
      });

      kernel.startRound(mission.missionId);
      kernel.recordEvidence(mission.missionId, {
        sourceType: "file",
        sourcePath: "evidence.md",
        retrievalMethod: "read_file",
        summary: "Temporary evidence exists before artifact emission.",
      });
      kernel.requestGate(mission.missionId);
      rmSync(evidencePath);

      const artifact = kernel.emitPlan(mission.missionId, {
        recommendedApproach: "Recheck citations before relying on them.",
        implementationSteps: ["Check file paths during artifact emission."],
        risks: ["Evidence can become stale between gathering and planning."],
        verificationPlan: ["Delete a cited file before emitting the plan."],
      });

      expect(artifact.evidenceIds).toEqual([]);
      expect(artifact.content).toContain("[stale] evidence.md");
      expect(artifact.content).toContain("excluded from supporting citations");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
