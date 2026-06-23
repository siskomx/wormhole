import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EventLog } from "./event-log.js";

export type SourceType = "file" | "command_output" | "user_input" | "derived_note";

export type Mission = {
  missionId: string;
  objective: string;
  repoRoot: string;
};

export type EvidenceInput = {
  sourceType: SourceType;
  sourcePath?: string;
  lineStart?: number;
  lineEnd?: number;
  retrievalMethod: string;
  summary: string;
};

export type EvidenceRecord = EvidenceInput & {
  evidenceId: string;
  missionId: string;
  recordedAt: string;
};

export type QuestionInput = {
  question: string;
  blocking: boolean;
  rationale: string;
  assumptionFallback?: string;
};

export type QuestionRecord = QuestionInput & {
  questionId: string;
  missionId: string;
  status: "open" | "answered" | "accepted_as_assumption" | "deferred";
};

export type QuestionUpdate = Partial<
  Pick<QuestionRecord, "assumptionFallback" | "blocking" | "rationale" | "status">
>;

export type GateResult = {
  open: boolean;
  reasons: string[];
};

export type PlanInput = {
  recommendedApproach: string;
  implementationSteps: string[];
  risks: string[];
  verificationPlan: string[];
};

export type PlanArtifact = {
  artifactId: string;
  missionId: string;
  emittedAt: string;
  format: "markdown";
  content: string;
  evidenceIds: string[];
};

export type EventRecord = {
  eventId: string;
  missionId: string;
  type: string;
  createdAt: string;
  payload: unknown;
};

type MissionState = {
  mission: Mission;
  roundsStarted: number;
  evidence: EvidenceRecord[];
  questions: QuestionRecord[];
  gate?: GateResult;
  artifacts: PlanArtifact[];
  events: EventRecord[];
};

export type WormholeKernel = ReturnType<typeof createInMemoryKernel>;

export function createInMemoryKernel(
  options: { eventLog?: EventLog; initialEvents?: EventRecord[] } = {},
) {
  const missions = new Map<string, MissionState>();

  function getMissionState(missionId: string): MissionState {
    const state = missions.get(missionId);
    if (!state) {
      throw new Error(`Mission not found: ${missionId}`);
    }
    return state;
  }

  function appendEvent(state: MissionState, type: string, payload: unknown): void {
    state.events.push({
      eventId: randomUUID(),
      missionId: state.mission.missionId,
      type,
      createdAt: new Date().toISOString(),
      payload,
    });
    options.eventLog?.append(state.events[state.events.length - 1]);
  }

  function replayEvent(event: EventRecord): void {
    if (event.type === "mission.started") {
      const mission = event.payload as Mission;
      const state: MissionState = missions.get(mission.missionId) ?? {
        mission,
        roundsStarted: 0,
        evidence: [],
        questions: [],
        artifacts: [],
        events: [],
      };
      state.mission = mission;
      state.events.push(event);
      missions.set(mission.missionId, state);
      return;
    }

    const state = getMissionState(event.missionId);
    state.events.push(event);

    switch (event.type) {
      case "round.started": {
        const payload = event.payload as { round?: number };
        state.roundsStarted = Math.max(state.roundsStarted, payload.round ?? 0);
        break;
      }
      case "evidence.recorded":
        state.evidence.push(event.payload as EvidenceRecord);
        break;
      case "question.recorded":
        state.questions.push(event.payload as QuestionRecord);
        break;
      case "question.updated": {
        const updated = event.payload as QuestionRecord;
        const index = state.questions.findIndex(
          (question) => question.questionId === updated.questionId,
        );
        if (index >= 0) {
          state.questions[index] = updated;
        } else {
          state.questions.push(updated);
        }
        break;
      }
      case "gate.opened":
      case "gate.closed":
        state.gate = event.payload as GateResult;
        break;
      case "artifact.emitted":
        state.artifacts.push(event.payload as PlanArtifact);
        break;
    }
  }

  function formatEvidenceSource(record: EvidenceRecord): string {
    if (record.sourceType === "file" && record.sourcePath) {
      const range =
        record.lineStart && record.lineEnd
          ? `:${record.lineStart}-${record.lineEnd}`
          : record.lineStart
            ? `:${record.lineStart}`
            : "";
      return `${record.sourcePath}${range}`;
    }
    return record.sourcePath
      ? `${record.sourceType}:${record.sourcePath}`
      : record.sourceType;
  }

  function formatBullets(items: string[]): string {
    return items.length > 0
      ? items.map((item) => `- ${item}`).join("\n")
      : "- None recorded.";
  }

  function formatSteps(items: string[]): string {
    return items.length > 0
      ? items.map((item, index) => `${index + 1}. ${item}`).join("\n")
      : "1. No implementation steps provided.";
  }

  function isEvidenceFresh(state: MissionState, record: EvidenceRecord): boolean {
    if (record.sourceType !== "file" || !record.sourcePath) {
      return true;
    }
    return existsSync(path.resolve(state.mission.repoRoot, record.sourcePath));
  }

  function renderPlan(
    state: MissionState,
    input: PlanInput,
    supportingEvidenceIds: Set<string>,
  ): string {
    let supportingIndex = 0;
    const evidenceSummary =
      state.evidence.length > 0
        ? state.evidence
            .map((record) => {
              const isSupporting = supportingEvidenceIds.has(record.evidenceId);
              const marker = isSupporting ? `[E${++supportingIndex}]` : "[stale]";
              const staleNote = isSupporting
                ? ""
                : "; stale source, excluded from supporting citations";
              return (
                `- ${marker} ${formatEvidenceSource(record)}: ${record.summary} ` +
                `(retrieved with ${record.retrievalMethod}; evidenceId ${record.evidenceId}${staleNote})`
              );
            })
            .join("\n")
        : "- No evidence recorded.";

    const questions =
      state.questions.length > 0
        ? state.questions
            .map((question, index) => {
              const fallback = question.assumptionFallback
                ? `\n  - Assumption fallback: ${question.assumptionFallback}`
                : "";
              return (
                `- Q${index + 1}: ${question.question}\n` +
                `  - Status: ${question.status}\n` +
                `  - Blocking: ${question.blocking ? "yes" : "no"}\n` +
                `  - Rationale: ${question.rationale}${fallback}`
              );
            })
            .join("\n")
        : "- None recorded.";

    return [
      "# Wormhole Plan",
      "",
      "## Objective",
      state.mission.objective,
      "",
      "## Repo evidence summary",
      evidenceSummary,
      "",
      "## Open questions and assumptions",
      questions,
      "",
      "## Recommended approach",
      input.recommendedApproach,
      "",
      "## Implementation steps",
      formatSteps(input.implementationSteps),
      "",
      "## Risks",
      formatBullets(input.risks),
      "",
      "## Verification plan",
      formatBullets(input.verificationPlan),
      "",
    ].join("\n");
  }

  for (const event of options.initialEvents ?? []) {
    replayEvent(event);
  }

  return {
    startMission(input: { objective: string; repoRoot: string }): Mission {
      const mission: Mission = {
        missionId: randomUUID(),
        objective: input.objective,
        repoRoot: path.resolve(input.repoRoot),
      };
      const state: MissionState = {
        mission,
        roundsStarted: 0,
        evidence: [],
        questions: [],
        artifacts: [],
        events: [],
      };
      missions.set(mission.missionId, state);
      appendEvent(state, "mission.started", mission);
      return mission;
    },

    startRound(missionId: string): number {
      const state = getMissionState(missionId);
      if (state.roundsStarted >= 3) {
        throw new Error("Mission exceeded the maximum of 3 gather/reason rounds");
      }
      state.roundsStarted += 1;
      appendEvent(state, "round.started", { round: state.roundsStarted });
      return state.roundsStarted;
    },

    recordEvidence(missionId: string, input: EvidenceInput): EvidenceRecord {
      const state = getMissionState(missionId);
      if (state.roundsStarted === 0) {
        throw new Error("Start a round before recording evidence");
      }
      if (input.sourceType === "file") {
        if (!input.sourcePath) {
          throw new Error("File evidence requires sourcePath");
        }
        const fullPath = path.resolve(state.mission.repoRoot, input.sourcePath);
        if (!existsSync(fullPath)) {
          appendEvent(state, "error.recorded", {
            message: "Evidence source path does not exist",
            sourcePath: input.sourcePath,
          });
          throw new Error(`Evidence source path does not exist: ${input.sourcePath}`);
        }
      }
      const record: EvidenceRecord = {
        evidenceId: randomUUID(),
        missionId,
        recordedAt: new Date().toISOString(),
        ...input,
      };
      state.evidence.push(record);
      appendEvent(state, "evidence.recorded", record);
      return record;
    },

    recordQuestion(missionId: string, input: QuestionInput): QuestionRecord {
      const state = getMissionState(missionId);
      const record: QuestionRecord = {
        questionId: randomUUID(),
        missionId,
        status: "open",
        ...input,
      };
      state.questions.push(record);
      appendEvent(state, "question.recorded", record);
      return record;
    },

    updateQuestion(
      missionId: string,
      questionId: string,
      input: QuestionUpdate,
    ): QuestionRecord {
      const state = getMissionState(missionId);
      const question = state.questions.find((candidate) => candidate.questionId === questionId);
      if (!question) {
        throw new Error(`Question not found: ${questionId}`);
      }
      Object.assign(question, input);
      appendEvent(state, "question.updated", question);
      return question;
    },

    requestGate(missionId: string): GateResult {
      const state = getMissionState(missionId);
      const reasons: string[] = [];
      if (state.evidence.length === 0) {
        reasons.push("At least one evidence record is required");
      }
      const blockingWithoutFallback = state.questions.filter(
        (question) =>
          question.status === "open" &&
          question.blocking &&
          !question.assumptionFallback,
      );
      if (blockingWithoutFallback.length > 0) {
        reasons.push("Blocking questions require answers or assumption fallbacks");
      }
      const result: GateResult = {
        open: reasons.length === 0,
        reasons,
      };
      state.gate = result;
      appendEvent(state, result.open ? "gate.opened" : "gate.closed", result);
      return result;
    },

    emitPlan(missionId: string, input: PlanInput): PlanArtifact {
      const state = getMissionState(missionId);
      if (state.gate?.open !== true) {
        throw new Error("Gate must be open before emitting a plan");
      }
      const supportingEvidence = state.evidence.filter((record) =>
        isEvidenceFresh(state, record),
      );
      const supportingEvidenceIds = new Set(
        supportingEvidence.map((record) => record.evidenceId),
      );
      const artifact: PlanArtifact = {
        artifactId: randomUUID(),
        missionId,
        emittedAt: new Date().toISOString(),
        format: "markdown",
        content: renderPlan(state, input, supportingEvidenceIds),
        evidenceIds: supportingEvidence.map((record) => record.evidenceId),
      };
      state.artifacts.push(artifact);
      appendEvent(state, "artifact.emitted", artifact);
      return artifact;
    },

    missionStatus(missionId: string) {
      const state = getMissionState(missionId);
      return {
        mission: state.mission,
        roundsStarted: state.roundsStarted,
        evidenceCount: state.evidence.length,
        openQuestionCount: state.questions.filter((question) => question.status === "open")
          .length,
        gate: state.gate,
        artifactCount: state.artifacts.length,
      };
    },
  };
}
