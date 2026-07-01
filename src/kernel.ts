import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EventLog } from "./event-log.js";
import {
  compactCommandOutput,
  reviewMinimality,
  type OptimizationResult,
} from "./optimization.js";
import {
  blockingGateSignalMessages,
  type GateFreshnessInput,
  type GateLoopHealthInput,
  type GateResumeInput,
  type GateRuntimeBehaviorInput,
  type GateSourceConflictsInput,
} from "./gate-signals.js";
import type { ClaimGateInput } from "./claim-ledger.js";

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
  rawContent?: string;
};

export type EvidenceRecord = EvidenceInput & {
  evidenceId: string;
  missionId: string;
  recordedAt: string;
  optimizedView?: string;
  optimizations?: OptimizationResult[];
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

export type TaskLayer = 1 | 2 | 3 | 4;

export type TaskStatus =
  | "registered"
  | "running"
  | "blocked"
  | "needs_input"
  | "paused"
  | "interrupted"
  | "completed"
  | "failed";

export type ControlMessageMode = "query" | "advisory" | "direction_change" | "interrupt";

export type ControlPolicy = "next_checkpoint" | "pause_until_ack" | "immediate_stop";

export type TaskRegistrationInput = {
  parentTaskId?: string;
  layer: TaskLayer;
  name: string;
  objective: string;
  assignedTo?: string;
};

export type TaskRecord = TaskRegistrationInput & {
  taskId: string;
  missionId: string;
  status: TaskStatus;
  createdAt: string;
  heartbeatAt?: string;
  currentFlow?: string;
  summary?: string;
  touchedPaths?: string[];
};

export type TaskStatusInput = {
  status: TaskStatus;
  currentFlow?: string;
  summary: string;
  touchedPaths?: string[];
};

export type ControlMessageInput = {
  targetTaskId: string;
  mode: ControlMessageMode;
  content: string;
  sender: string;
  ackRequired?: boolean;
};

export type ControlMessage = {
  messageId: string;
  missionId: string;
  targetTaskId: string;
  mode: ControlMessageMode;
  effectivePolicy: ControlPolicy;
  content: string;
  sender: string;
  ackRequired: boolean;
  sentAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  response?: string;
};

export type ControlAckInput = {
  acknowledgedBy: string;
  response?: string;
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
  optimizations?: OptimizationResult[];
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
  tasks: TaskRecord[];
  controlMessages: ControlMessage[];
  events: EventRecord[];
};

export type WormholeKernel = ReturnType<typeof createInMemoryKernel>;

function resolvePathWithinRepo(repoRoot: string, sourcePath: string): string {
  const absoluteRoot = path.resolve(repoRoot);
  const resolvedPath = path.resolve(absoluteRoot, sourcePath);
  const relativePath = path.relative(absoluteRoot, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Evidence source path must stay within repoRoot");
  }
  return resolvedPath;
}

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
        tasks: [],
        controlMessages: [],
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
      case "task.registered":
        state.tasks.push(event.payload as TaskRecord);
        break;
      case "task.status_reported": {
        const report = event.payload as { taskId: string; update: TaskStatusInput; heartbeatAt: string };
        applyTaskStatusReport(state, report.taskId, report.update, report.heartbeatAt);
        break;
      }
      case "control.message_sent": {
        const message = event.payload as ControlMessage;
        state.controlMessages.push(message);
        applyMessagePolicy(state, message);
        break;
      }
      case "control.message_acknowledged": {
        const message = event.payload as ControlMessage;
        const existing = getControlMessage(state, message.messageId);
        Object.assign(existing, message);
        applyAcknowledgementPolicy(state, existing);
        break;
      }
    }
  }

  function getTask(state: MissionState, taskId: string): TaskRecord {
    const task = state.tasks.find((candidate) => candidate.taskId === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  function getControlMessage(state: MissionState, messageId: string): ControlMessage {
    const message = state.controlMessages.find((candidate) => candidate.messageId === messageId);
    if (!message) {
      throw new Error(`Control message not found: ${messageId}`);
    }
    return message;
  }

  function deriveControlPolicy(mode: ControlMessageMode): {
    ackRequired: boolean;
    effectivePolicy: ControlPolicy;
  } {
    switch (mode) {
      case "query":
      case "advisory":
        return { ackRequired: false, effectivePolicy: "next_checkpoint" };
      case "direction_change":
        return { ackRequired: true, effectivePolicy: "pause_until_ack" };
      case "interrupt":
        return { ackRequired: true, effectivePolicy: "immediate_stop" };
    }
  }

  function applyTaskStatusReport(
    state: MissionState,
    taskId: string,
    update: TaskStatusInput,
    heartbeatAt: string,
  ): TaskRecord {
    const task = getTask(state, taskId);
    task.status = update.status;
    task.currentFlow = update.currentFlow;
    task.summary = update.summary;
    task.touchedPaths = update.touchedPaths;
    task.heartbeatAt = heartbeatAt;
    return task;
  }

  function applyMessagePolicy(state: MissionState, message: ControlMessage): void {
    const task = getTask(state, message.targetTaskId);
    if (message.effectivePolicy === "pause_until_ack") {
      task.status = "paused";
    }
    if (message.effectivePolicy === "immediate_stop") {
      task.status = "interrupted";
    }
  }

  function applyAcknowledgementPolicy(state: MissionState, message: ControlMessage): void {
    const task = getTask(state, message.targetTaskId);
    if (message.effectivePolicy === "pause_until_ack" && task.status === "paused") {
      task.status = "running";
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
    try {
      return existsSync(resolvePathWithinRepo(state.mission.repoRoot, record.sourcePath));
    } catch {
      return false;
    }
  }

  function getFreshEvidence(state: MissionState): EvidenceRecord[] {
    return state.evidence.filter((record) => isEvidenceFresh(state, record));
  }

  function renderPlan(
    state: MissionState,
    input: PlanInput,
    supportingEvidenceIds: Set<string>,
    minimalityReview: OptimizationResult,
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
      "## Minimality review",
      minimalityReview.content,
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
        tasks: [],
        controlMessages: [],
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
        const fullPath = resolvePathWithinRepo(state.mission.repoRoot, input.sourcePath);
        if (!existsSync(fullPath)) {
          appendEvent(state, "error.recorded", {
            message: "Evidence source path does not exist",
            sourcePath: input.sourcePath,
          });
          throw new Error(`Evidence source path does not exist: ${input.sourcePath}`);
        }
      }
      const optimizations: OptimizationResult[] = [];
      let optimizedView: string | undefined;
      if (input.sourceType === "command_output" && input.rawContent) {
        const optimization = compactCommandOutput({ content: input.rawContent });
        optimizations.push(optimization);
        optimizedView = optimization.content;
      }
      const record: EvidenceRecord = {
        evidenceId: randomUUID(),
        missionId,
        recordedAt: new Date().toISOString(),
        ...input,
        ...(optimizedView ? { optimizedView } : {}),
        ...(optimizations.length > 0 ? { optimizations } : {}),
      };
      state.evidence.push(record);
      appendEvent(state, "evidence.recorded", record);
      for (const optimization of optimizations) {
        appendEvent(state, "optimization.recorded", {
          ownerType: "evidence",
          ownerId: record.evidenceId,
          optimization,
        });
      }
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

    registerTask(missionId: string, input: TaskRegistrationInput): TaskRecord {
      const state = getMissionState(missionId);
      if (input.layer < 1 || input.layer > 4) {
        throw new Error("Task layer must be between 1 and 4");
      }
      if (input.parentTaskId) {
        const parent = getTask(state, input.parentTaskId);
        if (input.layer <= parent.layer) {
          throw new Error("Child task layer must be deeper than its parent task layer");
        }
      }
      const task: TaskRecord = {
        taskId: randomUUID(),
        missionId,
        status: "registered",
        createdAt: new Date().toISOString(),
        ...input,
      };
      state.tasks.push(task);
      appendEvent(state, "task.registered", task);
      return task;
    },

    reportTaskStatus(
      missionId: string,
      taskId: string,
      input: TaskStatusInput,
    ): TaskRecord {
      const state = getMissionState(missionId);
      const heartbeatAt = new Date().toISOString();
      const task = applyTaskStatusReport(state, taskId, input, heartbeatAt);
      appendEvent(state, "task.status_reported", {
        taskId,
        update: input,
        heartbeatAt,
      });
      return task;
    },

    sendControlMessage(missionId: string, input: ControlMessageInput): ControlMessage {
      const state = getMissionState(missionId);
      getTask(state, input.targetTaskId);
      const defaults = deriveControlPolicy(input.mode);
      const message: ControlMessage = {
        messageId: randomUUID(),
        missionId,
        targetTaskId: input.targetTaskId,
        mode: input.mode,
        effectivePolicy: defaults.effectivePolicy,
        content: input.content,
        sender: input.sender,
        ackRequired: input.ackRequired ?? defaults.ackRequired,
        sentAt: new Date().toISOString(),
      };
      state.controlMessages.push(message);
      applyMessagePolicy(state, message);
      appendEvent(state, "control.message_sent", message);
      return message;
    },

    ackControlMessage(
      missionId: string,
      taskId: string,
      messageId: string,
      input: ControlAckInput,
    ): ControlMessage {
      const state = getMissionState(missionId);
      const message = getControlMessage(state, messageId);
      if (message.targetTaskId !== taskId) {
        throw new Error(`Control message ${messageId} does not target task ${taskId}`);
      }
      message.acknowledgedAt = new Date().toISOString();
      message.acknowledgedBy = input.acknowledgedBy;
      message.response = input.response;
      applyAcknowledgementPolicy(state, message);
      appendEvent(state, "control.message_acknowledged", message);
      return message;
    },

    listTaskInbox(
      missionId: string,
      taskId: string,
      input: { includeAcknowledged?: boolean } = {},
    ): ControlMessage[] {
      const state = getMissionState(missionId);
      getTask(state, taskId);
      return state.controlMessages.filter(
        (message) =>
          message.targetTaskId === taskId &&
          (input.includeAcknowledged || !message.acknowledgedAt),
      );
    },

    taskStatus(missionId: string, taskId: string) {
      const state = getMissionState(missionId);
      const task = getTask(state, taskId);
      const inbox = state.controlMessages.filter((message) => message.targetTaskId === taskId);
      return {
        task,
        inboxCount: inbox.filter((message) => !message.acknowledgedAt).length,
        pendingAckCount: inbox.filter(
          (message) => message.ackRequired && !message.acknowledgedAt,
        ).length,
      };
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

    requestGate(
      missionId: string,
      input: {
        sourceConflicts?: GateSourceConflictsInput;
        freshness?: GateFreshnessInput;
        runtimeBehavior?: GateRuntimeBehaviorInput;
        loopHealth?: GateLoopHealthInput;
        resume?: GateResumeInput;
        claimChecks?: ClaimGateInput;
      } = {},
    ): GateResult {
      const state = getMissionState(missionId);
      const reasons: string[] = [];
      if (state.evidence.length === 0) {
        reasons.push("At least one evidence record is required");
      } else if (getFreshEvidence(state).length === 0) {
        reasons.push("At least one fresh evidence record is required");
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
      reasons.push(...blockingGateSignalMessages(input));
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
      const supportingEvidence = getFreshEvidence(state);
      if (supportingEvidence.length === 0) {
        throw new Error("At least one fresh evidence record is required before emitting a plan");
      }
      const supportingEvidenceIds = new Set(
        supportingEvidence.map((record) => record.evidenceId),
      );
      const minimalityReview = reviewMinimality({
        objective: state.mission.objective,
        planSteps: [input.recommendedApproach, ...input.implementationSteps],
      });
      const artifact: PlanArtifact = {
        artifactId: randomUUID(),
        missionId,
        emittedAt: new Date().toISOString(),
        format: "markdown",
        content: renderPlan(state, input, supportingEvidenceIds, minimalityReview),
        evidenceIds: supportingEvidence.map((record) => record.evidenceId),
        optimizations: [minimalityReview],
      };
      state.artifacts.push(artifact);
      appendEvent(state, "optimization.recorded", {
        ownerType: "artifact",
        ownerId: artifact.artifactId,
        optimization: minimalityReview,
      });
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

    evidenceRecords(): EvidenceRecord[] {
      return [...missions.values()].flatMap((state) => state.evidence.map((record) => ({ ...record })));
    },
  };
}
