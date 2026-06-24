import path from "node:path";
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
import { createEvidenceCache } from "./evidence-cache.js";
import { reconcileArtifacts, type ArtifactProposal } from "./reconciliation.js";
import { createDagSchedule, type ScheduledTask } from "./scheduler.js";
import {
  createProviderRegistry,
  selectRoutingPlan,
  type ModelDescriptor,
  type RepoSize,
  type RoutingLevel,
} from "./adaptive-routing.js";
import { createCodexAdapterConfig } from "./codex-adapter.js";
import {
  createConnectorRegistry,
  type ConnectorDescriptor,
} from "./connector-registry.js";
import { createArtifactRecord, type ArtifactRecordInput } from "./artifacts.js";
import {
  createWorkbenchSnapshot,
  renderWorkbenchHtml,
  type WorkbenchSnapshotInput,
} from "./workbench.js";
import {
  createAgentRegistry,
  type AgentDescriptor,
  type AgentDispatchInput,
  type AgentRunResult,
} from "./agent-adapter.js";

function resolveCacheRoot(cacheRoot: string, repoRoot: string = process.cwd()): string {
  const absoluteRoot = path.resolve(repoRoot);
  const absoluteCacheRoot = path.resolve(absoluteRoot, cacheRoot);
  const relativePath = path.relative(absoluteRoot, absoluteCacheRoot);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Cache root must stay within repoRoot");
  }
  return absoluteCacheRoot;
}

export function createToolHandlers(kernel: WormholeKernel) {
  const agentRegistry = createAgentRegistry();

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

    cacheEvidence(input: {
      cacheRoot: string;
      repoRoot?: string;
      content: string;
      mediaType: string;
      source: string;
    }) {
      return createEvidenceCache(resolveCacheRoot(input.cacheRoot, input.repoRoot)).put(
        input.content,
        {
          mediaType: input.mediaType,
          source: input.source,
        },
      );
    },

    scheduleTasks(input: { tasks: ScheduledTask[] }) {
      return createDagSchedule(input.tasks);
    },

    reconcileArtifacts(input: { proposals: ArtifactProposal[] }) {
      return reconcileArtifacts(input.proposals);
    },

    routeMission(input: {
      taskCategory: string;
      ambiguity: RoutingLevel;
      risk: RoutingLevel;
      repoSize: RepoSize;
      requiresPrivacy: boolean;
      models: ModelDescriptor[];
    }) {
      return selectRoutingPlan(
        {
          taskCategory: input.taskCategory,
          ambiguity: input.ambiguity,
          risk: input.risk,
          repoSize: input.repoSize,
          requiresPrivacy: input.requiresPrivacy,
        },
        createProviderRegistry(input.models),
      );
    },

    codexAdapterConfig(input: { repoRoot: string }) {
      return createCodexAdapterConfig(input.repoRoot);
    },

    selectConnector(input: {
      connectors: ConnectorDescriptor[];
      target: string;
      requiredCapabilities: string[];
    }) {
      return createConnectorRegistry(input.connectors).select({
        target: input.target,
        requiredCapabilities: input.requiredCapabilities,
      });
    },

    createArtifact(input: ArtifactRecordInput) {
      return createArtifactRecord(input);
    },

    renderWorkbench(input: WorkbenchSnapshotInput) {
      const snapshot = createWorkbenchSnapshot(input);
      return {
        snapshot,
        html: renderWorkbenchHtml(snapshot),
      };
    },

    agentRegister(input: AgentDescriptor) {
      return agentRegistry.register(input);
    },

    agentList() {
      return agentRegistry.list();
    },

    agentDispatch(input: AgentDispatchInput) {
      return agentRegistry.dispatch(input);
    },

    agentStatus(input: { runId: string }) {
      return agentRegistry.status(input.runId);
    },

    agentComplete(input: { runId: string } & AgentRunResult) {
      const { runId, ...result } = input;
      return agentRegistry.complete(runId, result);
    },

    agentInterrupt(input: { runId: string; reason: string }) {
      return agentRegistry.interrupt(input.runId, input.reason);
    },

    missionStatus(input: { missionId: string }) {
      return kernel.missionStatus(input.missionId);
    },
  };
}
