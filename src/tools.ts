import path from "node:path";
import { createBehaviorPolicyStore, type BehaviorMode } from "./behavior-policy.js";
import {
  createConductorPlan,
  replayConductorPlan,
  type ConductorInput,
  type ConductorTrace,
} from "./conductor.js";
import { createContextStore, type ContextRecordInput, type ContextPackInput, type ContextQueryInput } from "./context-store.js";
import { createGraphArtifacts, type GraphCommunity } from "./graph-artifacts.js";
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
import {
  createOptimizationStore,
  optimizeText,
  type OptimizationKind,
  type OptimizationRequestKind,
} from "./optimization.js";
import { createOptimizedCommandRunner, type OptimizedCommandInput } from "./optimized-command-runner.js";
import { createOptimizationStats } from "./optimization-stats.js";
import { createPythonSidecar } from "./python-sidecar.js";
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
import {
  createPrintingPressRegistry,
  type PrintingPressCliDescriptor,
  type PrintingPressRunInput,
  type PrintingPressSelection,
} from "./printing-press.js";
import { generateToolScaffold, type ToolFactoryInput } from "./tool-factory.js";
import {
  buildRepoIndex,
  createRepoIndexCacheKey,
  explainRepoIndex,
  findRepoIndexPath,
  getRepoGraphReport,
  isRepoIndexFresh,
  queryRepoIndex,
  summarizeRepoIndex,
  type RepoIndex,
  type RepoIndexBuildOptions,
  type RepoIndexExplainInput,
  type RepoIndexPathInput,
  type RepoIndexQueryInput,
} from "./repo-index.js";
import {
  createModelProfileRegistry,
  type ModelProfile,
  type ModelProfileOutcomeInput,
  type ModelProfileSelectInput,
} from "./model-profile.js";
import {
  executeLocalOrchestrationWithOutcomes,
  planLocalOrchestration,
  type LocalOrchestrationInput,
  type LocalOrchestrationOutcomeInput,
} from "./orchestration-runner.js";

export type ToolHandlerOptions = {
  allowedRepoRoots?: string[];
  maxCachedRepoIndexes?: number;
};

function resolveCacheRoot(cacheRoot: string, repoRoot: string = process.cwd()): string {
  const absoluteRoot = path.resolve(repoRoot);
  const absoluteCacheRoot = path.resolve(absoluteRoot, cacheRoot);
  const relativePath = path.relative(absoluteRoot, absoluteCacheRoot);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Cache root must stay within repoRoot");
  }
  return absoluteCacheRoot;
}

function parseAllowedRepoRoots(options: ToolHandlerOptions): string[] {
  const configuredRoots =
    options.allowedRepoRoots ??
    process.env.WORMHOLE_ALLOWED_REPO_ROOTS?.split(/[;,]/).filter(Boolean);
  return (configuredRoots && configuredRoots.length > 0 ? configuredRoots : [process.cwd()]).map(
    (repoRoot) => path.resolve(repoRoot),
  );
}

function resolveAllowedRepoRoot(repoRoot: string, allowedRepoRoots: string[]): string {
  const absoluteRoot = path.resolve(repoRoot);
  const allowed = allowedRepoRoots.some((allowedRoot) => {
    const relativePath = path.relative(allowedRoot, absoluteRoot);
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
  });
  if (!allowed) {
    throw new Error("Repo root must stay within an allowed workspace root");
  }
  return absoluteRoot;
}

function evictOldestRepoIndex(repoIndexes: Map<string, RepoIndex>, maxCachedRepoIndexes: number) {
  while (repoIndexes.size > maxCachedRepoIndexes) {
    const oldestKey = repoIndexes.keys().next().value;
    if (!oldestKey) {
      break;
    }
    repoIndexes.delete(oldestKey);
  }
}

export function createToolHandlers(
  kernel: WormholeKernel,
  options: ToolHandlerOptions = {},
) {
  const agentRegistry = createAgentRegistry();
  const printingPressRegistry = createPrintingPressRegistry();
  const contextStore = createContextStore();
  const optimizationStore = createOptimizationStore();
  const optimizationStatsStore = createOptimizationStats();
  const optimizedCommandRunner = createOptimizedCommandRunner({ stats: optimizationStatsStore });
  const modelProfileRegistry = createModelProfileRegistry();
  const pythonSidecar = createPythonSidecar();
  const behaviorPolicy = createBehaviorPolicyStore();
  const repoIndexes = new Map<string, RepoIndex>();
  const allowedRepoRoots = parseAllowedRepoRoots(options);
  const maxCachedRepoIndexes = options.maxCachedRepoIndexes ?? 8;

  function getRepoIndex(repoRoot: string): RepoIndex {
    const absoluteRoot = resolveAllowedRepoRoot(repoRoot, allowedRepoRoots);
    const cacheKey = createRepoIndexCacheKey({ repoRoot: absoluteRoot });
    const existing = repoIndexes.get(cacheKey);
    if (existing && isRepoIndexFresh(existing)) {
      return existing;
    }
    const index = buildRepoIndex({ repoRoot: absoluteRoot });
    repoIndexes.set(cacheKey, index);
    evictOldestRepoIndex(repoIndexes, maxCachedRepoIndexes);
    return index;
  }

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

    optimizationApply(input: { kind: OptimizationRequestKind; content: string; sourceId?: string }) {
      return optimizationStore.apply(input);
    },

    optimizationRetrieve(input: { retrievalId: string }) {
      return optimizationStore.retrieve(input);
    },

    optimizedCommandRun(input: OptimizedCommandInput) {
      return optimizedCommandRunner.run(input);
    },

    optimizationStats() {
      return optimizationStatsStore.snapshot();
    },

    ctxRecord(input: ContextRecordInput) {
      return contextStore.record(input);
    },

    ctxPackQuery(input: ContextQueryInput) {
      return contextStore.query(input);
    },

    ctxPackCreate(input: ContextPackInput) {
      return contextStore.createPack(input);
    },

    ctxPackRender(input: { packId: string }) {
      return contextStore.renderPack(input);
    },

    pythonSidecarProbe() {
      return pythonSidecar.run({ job: "probe", payload: {} });
    },

    pythonGraphMetrics(input: {
      nodes: Array<{ id: string; kind?: string }>;
      edges: Array<{ from: string; to: string; kind?: string }>;
    }) {
      return pythonSidecar.run({ job: "graph_metrics", payload: input });
    },

    pythonGraphCommunities(input: {
      nodes: Array<{ id: string; kind?: string }>;
      edges: Array<{ from: string; to: string; kind?: string }>;
    }) {
      return pythonSidecar.run({ job: "graph_communities", payload: input });
    },

    pythonTraceSummary(input: {
      traces: Array<{
        profileId?: string;
        profile?: { profileId?: string };
        status?: string;
        latencyMs?: number;
        outputQuality?: number;
      }>;
    }) {
      return pythonSidecar.run({ job: "trace_summary", payload: input });
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

    orchestrationPlanLocal(input: LocalOrchestrationInput) {
      return planLocalOrchestration(input);
    },

    orchestrationRunLocal(input: LocalOrchestrationOutcomeInput) {
      return executeLocalOrchestrationWithOutcomes(input);
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

    printingPressRegister(input: PrintingPressCliDescriptor) {
      return printingPressRegistry.register(input);
    },

    printingPressList() {
      return printingPressRegistry.list();
    },

    printingPressSelect(input: PrintingPressSelection) {
      return printingPressRegistry.select(input);
    },

    printingPressRegisterAgent(input: { cliId: string }) {
      const agent = printingPressRegistry.toAgentDescriptor(input.cliId);
      return agentRegistry.register(agent);
    },

    printingPressVerify(input: { cliId: string }) {
      return printingPressRegistry.verify(input);
    },

    printingPressRun(input: PrintingPressRunInput) {
      return printingPressRegistry.run(input);
    },

    repoIndexBuild(input: RepoIndexBuildOptions) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const index = buildRepoIndex({ ...input, repoRoot });
      repoIndexes.set(createRepoIndexCacheKey({ ...input, repoRoot }), index);
      evictOldestRepoIndex(repoIndexes, maxCachedRepoIndexes);
      return summarizeRepoIndex(index);
    },

    repoIndexQuery(input: { repoRoot: string } & RepoIndexQueryInput) {
      const { repoRoot, ...query } = input;
      return queryRepoIndex(getRepoIndex(repoRoot), query);
    },

    repoIndexExplain(input: { repoRoot: string } & RepoIndexExplainInput) {
      const { repoRoot, ...explain } = input;
      return explainRepoIndex(getRepoIndex(repoRoot), explain);
    },

    repoIndexPath(input: { repoRoot: string } & RepoIndexPathInput) {
      const { repoRoot, ...pathInput } = input;
      return findRepoIndexPath(getRepoIndex(repoRoot), pathInput);
    },

    repoIndexReport(input: { repoRoot: string }) {
      return getRepoGraphReport(getRepoIndex(input.repoRoot));
    },

    repoGraphExport(input: { repoRoot: string; communities?: GraphCommunity[] }) {
      return createGraphArtifacts(getRepoIndex(input.repoRoot), {
        communities: input.communities,
      });
    },

    toolFactoryGenerate(input: ToolFactoryInput) {
      return generateToolScaffold(input);
    },

    conductorPlan(input: ConductorInput) {
      return createConductorPlan(input);
    },

    conductorReplay(input: ConductorTrace) {
      return replayConductorPlan(input);
    },

    behaviorModeSet(input: Partial<BehaviorMode>) {
      return behaviorPolicy.setMode(input);
    },

    behaviorModeGet() {
      return behaviorPolicy.getMode();
    },

    behaviorApply(input: { text: string }) {
      return behaviorPolicy.apply(input);
    },

    behaviorMinimalityReview(input: { objective: string; planSteps: string[] }) {
      return behaviorPolicy.reviewMinimality(input);
    },

    modelProfileRegister(input: ModelProfile) {
      return modelProfileRegistry.register(input);
    },

    modelProfileSelect(input: ModelProfileSelectInput) {
      return modelProfileRegistry.select(input);
    },

    modelProfileRecordOutcome(input: ModelProfileOutcomeInput) {
      return modelProfileRegistry.recordOutcome(input);
    },

    modelProfileExportTraces() {
      return modelProfileRegistry.exportTraces();
    },

    missionStatus(input: { missionId: string }) {
      return kernel.missionStatus(input.missionId);
    },
  };
}
