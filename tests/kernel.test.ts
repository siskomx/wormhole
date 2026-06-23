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
});
