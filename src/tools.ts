import type {
  EvidenceInput,
  PlanInput,
  QuestionInput,
  QuestionUpdate,
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
