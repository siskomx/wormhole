import type {
  EvidenceInput,
  PlanInput,
  ControlAckInput,
  ControlMessageInput,
  QuestionInput,
  QuestionUpdate,
  TaskRegistrationInput,
  TaskStatusInput,
  WormholeKernel,
} from "./kernel.js";
import { optimizeText, type OptimizationKind } from "./optimization.js";

export function createToolHandlers(kernel: WormholeKernel) {
  return {
    missionStart(input: { objective: string; repoRoot: string }) {
      return kernel.startMission(input);
    },

    roundStart(input: { missionId: string }) {
      return { round: kernel.startRound(input.missionId) };
    },

    recordEvidence(input: { missionId: string } & EvidenceInput) {
      const { missionId, ...evidence } = input;
      return kernel.recordEvidence(missionId, evidence);
    },

    recordQuestion(input: { missionId: string } & QuestionInput) {
      const { missionId, ...question } = input;
      return kernel.recordQuestion(missionId, question);
    },

    updateQuestion(input: { missionId: string; questionId: string } & QuestionUpdate) {
      const { missionId, questionId, ...update } = input;
      return kernel.updateQuestion(missionId, questionId, update);
    },

    taskRegister(input: { missionId: string } & TaskRegistrationInput) {
      const { missionId, ...task } = input;
      return kernel.registerTask(missionId, task);
    },

    taskStatusReport(input: { missionId: string; taskId: string } & TaskStatusInput) {
      const { missionId, taskId, ...status } = input;
      return kernel.reportTaskStatus(missionId, taskId, status);
    },

    controlMessage(input: { missionId: string } & ControlMessageInput) {
      const { missionId, ...message } = input;
      return kernel.sendControlMessage(missionId, message);
    },

    controlAck(
      input: { missionId: string; taskId: string; messageId: string } & ControlAckInput,
    ) {
      const { missionId, taskId, messageId, ...ack } = input;
      return kernel.ackControlMessage(missionId, taskId, messageId, ack);
    },

    taskInbox(input: { missionId: string; taskId: string; includeAcknowledged?: boolean }) {
      const { missionId, taskId, ...options } = input;
      return kernel.listTaskInbox(missionId, taskId, options);
    },

    taskStatus(input: { missionId: string; taskId: string }) {
      return kernel.taskStatus(input.missionId, input.taskId);
    },

    gateRequest(input: { missionId: string }) {
      return kernel.requestGate(input.missionId);
    },

    emitPlan(input: { missionId: string } & PlanInput) {
      const { missionId, ...plan } = input;
      return kernel.emitPlan(missionId, plan);
    },

    optimizeText(input: { kind: OptimizationKind; content: string }) {
      return optimizeText(input);
    },

    missionStatus(input: { missionId: string }) {
      return kernel.missionStatus(input.missionId);
    },
  };
}
