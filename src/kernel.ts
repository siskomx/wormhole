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
  events: EventRecord[];
};

export type WormholeKernel = ReturnType<typeof createInMemoryKernel>;

export function createInMemoryKernel(options: { eventLog?: EventLog } = {}) {
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

    missionStatus(missionId: string) {
      const state = getMissionState(missionId);
      return {
        mission: state.mission,
        roundsStarted: state.roundsStarted,
        evidenceCount: state.evidence.length,
        openQuestionCount: state.questions.filter((question) => question.status === "open")
          .length,
        gate: state.gate,
      };
    },
  };
}
