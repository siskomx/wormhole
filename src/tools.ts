import path from "node:path";
import { homedir } from "node:os";
import { createBehaviorPolicyStore, type BehaviorMode } from "./behavior-policy.js";
import { captureBrowserNetwork } from "./browser-capture.js";
import {
  createConductorPlan,
  replayConductorPlan,
  type ConductorInput,
  type ConductorTrace,
} from "./conductor.js";
import {
  createContextStore,
  type ContextRecordInput,
  type ContextPackBudgetReviewInput,
  type ContextPackInput,
  type ContextQueryInput,
  type ContextStoreSnapshot,
} from "./context-store.js";
import {
  createAgentWorkspaceStore,
  type AgentWorkspaceCreateInput,
  type AgentWorkspaceMergeInput,
  type AgentWorkspaceReadInput,
  type AgentWorkspaceSnapshot,
  type AgentWorkspaceWriteInput,
} from "./agent-workspace.js";
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
  type OptimizationStoreSnapshot,
} from "./optimization.js";
import { createOptimizedCommandRunner, type OptimizedCommandInput } from "./optimized-command-runner.js";
import { createOptimizationStats, type OptimizationStatsSnapshot } from "./optimization-stats.js";
import { createPythonSidecar } from "./python-sidecar.js";
import { createMediaIngestion, type MediaIngestInput } from "./media-ingestion.js";
import { createEvidenceCache } from "./evidence-cache.js";
import {
  generateToolSpecsFromDiscovery,
  type EndpointObservation,
} from "./api-discovery.js";
import { importHar } from "./har-import.js";
import { importOpenApi } from "./openapi-import.js";
import { crawlHttp } from "./http-crawler.js";
import {
  createPolicyStore,
  type OrchestrationTrace,
  type PolicyActivationInput,
  type PolicyStoreSnapshot,
} from "./orchestration-learning.js";
import {
  createReasoningResearchStore,
  type ReasoningTrace,
  type ReasoningResearchSnapshot,
} from "./reasoning-research.js";
import {
  createDiagnosticStore,
  normalizeCommandDiagnostics,
  normalizeLspDiagnostics,
  type DiagnosticRecord,
  type DiagnosticStoreSnapshot,
  type DiagnosticQuery,
} from "./diagnostics.js";
import { analyzeImpact } from "./impact-analysis.js";
import {
  detectProjectContract,
  type ProjectContract,
} from "./project-contract.js";
import {
  createVerificationPlan,
  runVerificationPlan,
  type VerificationCommand,
} from "./verification-runner.js";
import {
  reviewOperationRisk,
  scanRepoForSecrets,
  scanTextForSecrets,
} from "./safety-scan.js";
import {
  buildSemanticIndex,
  semanticSearch,
  type SemanticIndex,
  type SemanticRecordInput,
} from "./semantic-search.js";
import {
  detectLanguageServerConfigs,
  lspProbe,
  normalizeLspLocation,
  type LspProtocolLocation,
} from "./lsp-ground-truth.js";
import { reviewActionPolicy, type ActionPolicyOperation } from "./action-policy.js";
import { createDependencySecurityReport } from "./dependency-security.js";
import {
  durableIndexStatus,
  refreshDurableRepoIndex,
  refreshDurableSemanticIndex,
  searchDurableSemanticIndex,
} from "./durable-index-store.js";
import { createLspSessionManager } from "./lsp-session-manager.js";
import {
  createOptimizationAdapterRegistry,
  type OptimizationAdapterDescriptor,
  type OptimizationAdapterSnapshot,
} from "./optimization-adapter.js";
import { projectOnboard } from "./project-onboard.js";
import {
  analyzeBlastRadius,
  createArchitectureMap,
  discoverEntrypointFlows,
  generateProjectContextPack,
} from "./project-intelligence.js";
import {
  createMissionDeltaReplan,
  type MissionDeltaReplanInput,
} from "./mission-delta-replan.js";
import { analyzeTestImpactV2 } from "./test-impact-v2.js";
import { reconcileArtifacts, type ArtifactProposal } from "./reconciliation.js";
import { createDagSchedule, type ScheduledTask } from "./scheduler.js";
import { createShellHookManager, type ShellHookOperation, type ShellKind } from "./shell-hooks.js";
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
  createProjectIntelligenceSnapshot,
  prepareAgentContext,
  recommendMissionRoute,
  recommendNextBestTool,
} from "./agent-routing.js";
import {
  analyzeAgentDrift,
  createAgentRemit,
  createRemitCoverageReport,
  inventoryAgentCapabilities,
  renderBehaviorFindings,
  verifyAgentBehavior,
  type AgentBehaviorVerificationReport,
  type AgentCapabilityInventory,
  type AgentCapabilityInventoryInput,
  type AgentRemit,
  type AgentRemitInput,
} from "./agent-behavior-verification.js";
import {
  createWorkbenchSnapshot,
  renderWorkbenchHtml,
  type WorkbenchSnapshotInput,
} from "./workbench.js";
import {
  createAgentRegistry,
  type AgentDescriptor,
  type AgentDispatchInput,
  type AgentRegistrySnapshot,
  type AgentRunResult,
} from "./agent-adapter.js";
import { executeAgentTransport } from "./agent-transport.js";
import {
  createPrintingPressRegistry,
  type PrintingPressCliDescriptor,
  type PrintingPressRegistrySnapshot,
  type PrintingPressRunInput,
  type PrintingPressSelection,
} from "./printing-press.js";
import { createJsonRuntimeStateStore } from "./runtime-state.js";
import {
  generateToolScaffold,
  validateToolScaffold,
  writeToolScaffold,
  type ToolFactoryInput,
  type ToolScaffold,
} from "./tool-factory.js";
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
  type ModelProfileRegistrySnapshot,
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
  runtimeStatePath?: string;
};

type RuntimeToolState = {
  agents?: Partial<AgentRegistrySnapshot>;
  printingPress?: Partial<PrintingPressRegistrySnapshot>;
  context?: Partial<ContextStoreSnapshot>;
  optimization?: Partial<OptimizationStoreSnapshot>;
  optimizationStats?: Partial<OptimizationStatsSnapshot>;
  modelProfiles?: Partial<ModelProfileRegistrySnapshot>;
  behavior?: Partial<BehaviorMode>;
  policy?: Partial<PolicyStoreSnapshot>;
  reasoning?: Partial<ReasoningResearchSnapshot>;
  diagnostics?: Partial<DiagnosticStoreSnapshot>;
  optimizationAdapters?: Partial<OptimizationAdapterSnapshot>;
  agentWorkspace?: Partial<AgentWorkspaceSnapshot>;
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function repoRelativePath(repoRoot: string, value: string): string {
  const absoluteValue = path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
  const relativePath = path.relative(repoRoot, absoluteValue);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return value.replace(/\\/g, "/");
  }
  return relativePath.replace(/\\/g, "/");
}

function defaultHomeDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? homedir();
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
  const runtimeStateStore = options.runtimeStatePath
    ? createJsonRuntimeStateStore<RuntimeToolState>({
        statePath: options.runtimeStatePath,
        defaultState: {},
      })
    : undefined;
  const runtimeState = runtimeStateStore?.read() ?? {};
  function persistRuntimeState<K extends keyof RuntimeToolState>(key: K, value: RuntimeToolState[K]): void {
    if (!runtimeStateStore) {
      return;
    }
    runtimeState[key] = value;
    runtimeStateStore.write(runtimeState);
  }

  const agentRegistry = createAgentRegistry(runtimeState.agents, (snapshot) =>
    persistRuntimeState("agents", snapshot),
  );
  const printingPressRegistry = createPrintingPressRegistry(runtimeState.printingPress, (snapshot) =>
    persistRuntimeState("printingPress", snapshot),
  );
  const contextStore = createContextStore(runtimeState.context, (snapshot) =>
    persistRuntimeState("context", snapshot),
  );
  const agentWorkspaceStore = createAgentWorkspaceStore(runtimeState.agentWorkspace, (snapshot) =>
    persistRuntimeState("agentWorkspace", snapshot),
  );
  const optimizationStore = createOptimizationStore(runtimeState.optimization, (snapshot) =>
    persistRuntimeState("optimization", snapshot),
  );
  const optimizationStatsStore = createOptimizationStats(runtimeState.optimizationStats, (snapshot) =>
    persistRuntimeState("optimizationStats", snapshot),
  );
  const optimizedCommandRunner = createOptimizedCommandRunner({ stats: optimizationStatsStore });
  const modelProfileRegistry = createModelProfileRegistry(runtimeState.modelProfiles, (snapshot) =>
    persistRuntimeState("modelProfiles", snapshot),
  );
  const pythonSidecar = createPythonSidecar();
  const behaviorPolicy = createBehaviorPolicyStore(runtimeState.behavior, (snapshot) =>
    persistRuntimeState("behavior", snapshot),
  );
  const policyStore = createPolicyStore(runtimeState.policy, (snapshot) =>
    persistRuntimeState("policy", snapshot),
  );
  const reasoningStore = createReasoningResearchStore(runtimeState.reasoning, (snapshot) =>
    persistRuntimeState("reasoning", snapshot),
  );
  const diagnosticStore = createDiagnosticStore(runtimeState.diagnostics, (snapshot) =>
    persistRuntimeState("diagnostics", snapshot),
  );
  const optimizationAdapterRegistry = createOptimizationAdapterRegistry(
    runtimeState.optimizationAdapters,
    (snapshot) => persistRuntimeState("optimizationAdapters", snapshot),
  );
  const lspSessionManager = createLspSessionManager();
  const shellHookPlans = new Map<string, {
    operations: ShellHookOperation[];
    homeDir: string;
    repoRoot: string;
    allowRegistry?: boolean;
    action: "install" | "uninstall";
  }>();
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

    ctxPackBudgetReview(input: ContextPackBudgetReviewInput) {
      return contextStore.reviewPackBudget(input);
    },

    ctxPackRefresh(input: ContextPackBudgetReviewInput) {
      return contextStore.refreshPack(input);
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

    mediaDependencyReport() {
      return pythonSidecar.run({ job: "media_dependency_report", payload: {} });
    },

    async mediaIngestPdf(input: { repoRoot: string; missionId?: string; recordEvidence?: boolean } & MediaIngestInput) {
      const { repoRoot, missionId, recordEvidence, ...mediaInput } = input;
      const absoluteRoot = resolveAllowedRepoRoot(repoRoot, allowedRepoRoots);
      const ingestion = createMediaIngestion({
        repoRoot: absoluteRoot,
        sidecar: {
          run: (request) =>
            pythonSidecar.run({
              job: request.job as "pdf_extract",
              payload: request.payload,
            }),
        },
      });
      const result = await ingestion.ingestPdf(mediaInput);
      if (recordEvidence && missionId) {
        const evidence = kernel.recordEvidence(missionId, {
          sourceType: "file",
          sourcePath: result.sourcePath,
          retrievalMethod: "media_ingest_pdf",
          summary: result.evidenceCandidate.summary,
          rawContent: result.extractedText || undefined,
        });
        return { ...result, evidence };
      }
      return result;
    },

    async mediaIngestImage(
      input: { repoRoot: string; missionId?: string; recordEvidence?: boolean } & MediaIngestInput,
    ) {
      const { repoRoot, missionId, recordEvidence, ...mediaInput } = input;
      const absoluteRoot = resolveAllowedRepoRoot(repoRoot, allowedRepoRoots);
      const ingestion = createMediaIngestion({
        repoRoot: absoluteRoot,
        sidecar: {
          run: (request) =>
            pythonSidecar.run({
              job: request.job as "image_inspect",
              payload: request.payload,
            }),
        },
      });
      const result = await ingestion.ingestImage(mediaInput);
      if (recordEvidence && missionId) {
        const evidence = kernel.recordEvidence(missionId, {
          sourceType: "file",
          sourcePath: result.sourcePath,
          retrievalMethod: "media_ingest_image",
          summary: result.evidenceCandidate.summary,
          rawContent: result.extractedText || undefined,
        });
        return { ...result, evidence };
      }
      return result;
    },

    shellHookDiscover(input: { homeDir?: string; repoRoot?: string } = {}) {
      if (input.homeDir) {
        throw new Error("shell_hook_discover does not accept custom homeDir");
      }
      return createShellHookManager({
        homeDir: defaultHomeDir(),
        repoRoot: input.repoRoot ? resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots) : process.cwd(),
      }).discover();
    },

    shellHookPlan(input: {
      shells: ShellKind[];
      dryRun?: boolean;
      allowRegistry?: boolean;
      homeDir?: string;
      repoRoot?: string;
      action?: "install" | "uninstall";
    }) {
      if (input.homeDir) {
        throw new Error("shell_hook_plan does not accept custom homeDir");
      }
      const homeDir = defaultHomeDir();
      const repoRoot = input.repoRoot
        ? resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots)
        : process.cwd();
      const manager = createShellHookManager({ homeDir, repoRoot });
      const action = input.action ?? "install";
      const plan =
        action === "uninstall"
          ? manager.planUninstall({ shells: input.shells, allowRegistry: input.allowRegistry })
          : manager.planInstall({
              shells: input.shells,
              dryRun: input.dryRun ?? true,
              allowRegistry: input.allowRegistry,
            });
      if (plan.planToken) {
        shellHookPlans.set(plan.planToken, {
          operations: plan.operations,
          homeDir,
          repoRoot,
          allowRegistry: input.allowRegistry,
          action,
        });
      }
      return plan;
    },

    shellHookInstall(input: {
      shells: ShellKind[];
      apply?: boolean;
      planToken?: string;
      allowRegistry?: boolean;
    }) {
      if (!input.apply) {
        throw new Error("shell_hook_install requires apply: true");
      }
      if (!input.planToken) {
        throw new Error("shell_hook_install requires a planToken from shell_hook_plan");
      }
      const planned = shellHookPlans.get(input.planToken);
      if (!planned) {
        throw new Error("Unknown shell hook planToken");
      }
      if (planned.action !== "install") {
        throw new Error("shell_hook_install requires an install planToken");
      }
      const manager = createShellHookManager({
        homeDir: planned.homeDir,
        repoRoot: planned.repoRoot,
      });
      const current = manager.planInstall({
        shells: input.shells,
        dryRun: true,
        allowRegistry: planned.allowRegistry,
      });
      if (JSON.stringify(current.operations) !== JSON.stringify(planned.operations)) {
        throw new Error("Shell hook plan is stale; run shell_hook_plan again");
      }
      const result = manager.install({ shells: input.shells, allowRegistry: planned.allowRegistry });
      shellHookPlans.delete(input.planToken);
      return result;
    },

    shellHookUninstall(input: {
      shells: ShellKind[];
      apply?: boolean;
      planToken?: string;
      allowRegistry?: boolean;
    }) {
      if (!input.apply) {
        throw new Error("shell_hook_uninstall requires apply: true");
      }
      if (!input.planToken) {
        throw new Error("shell_hook_uninstall requires a planToken from shell_hook_plan");
      }
      const planned = shellHookPlans.get(input.planToken);
      if (!planned) {
        throw new Error("Unknown shell hook planToken");
      }
      if (planned.action !== "uninstall") {
        throw new Error("shell_hook_uninstall requires an uninstall planToken");
      }
      const manager = createShellHookManager({
        homeDir: planned.homeDir,
        repoRoot: planned.repoRoot,
      });
      const current = manager.planUninstall({
        shells: input.shells,
        allowRegistry: planned.allowRegistry,
      });
      if (JSON.stringify(current.operations) !== JSON.stringify(planned.operations)) {
        throw new Error("Shell hook uninstall plan is stale; run shell_hook_plan again");
      }
      const result = manager.uninstall({ shells: input.shells, allowRegistry: planned.allowRegistry });
      shellHookPlans.delete(input.planToken);
      return result;
    },

    shellHookVerify(input: { shells: ShellKind[]; homeDir?: string; repoRoot?: string }) {
      if (input.homeDir) {
        throw new Error("shell_hook_verify does not accept custom homeDir");
      }
      return createShellHookManager({
        homeDir: defaultHomeDir(),
        repoRoot: input.repoRoot ? resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots) : process.cwd(),
      }).verify({ shells: input.shells });
    },

    discoveryHarImport(input: { harJson: unknown; maxEntries?: number }) {
      return importHar(input);
    },

    discoveryOpenApiImport(input: { specText: string; sourceName: string }) {
      return importOpenApi(input);
    },

    discoveryHttpCrawl(input: {
      startUrl: string;
      maxPages?: number;
      maxDepth?: number;
      allowOrigins?: string[];
      userAgent?: string;
      timeoutMs?: number;
      allowPrivateNetwork?: boolean;
      maxResponseBytes?: number;
    }) {
      return crawlHttp(input);
    },

    discoveryBrowserCapture(input: {
      url: string;
      maxRequests?: number;
      browserEndpoint?: string;
      timeoutMs?: number;
    }) {
      return captureBrowserNetwork(input);
    },

    discoveryToolSpecGenerate(input: {
      observations: EndpointObservation[];
      baseCommand?: string;
      authMode?: "none" | "bearer-env" | "api-key-env";
    }) {
      return generateToolSpecsFromDiscovery(input);
    },

    orchestrationTraceRecord(input: OrchestrationTrace) {
      policyStore.record(input);
      return input;
    },

    orchestrationDatasetExport() {
      return policyStore.exportJsonl();
    },

    orchestrationPolicyTrain(input: { traceJsonl: string; learningRate?: number; discount?: number; epochs?: number }) {
      return pythonSidecar.run({ job: "policy_train", payload: input });
    },

    orchestrationPolicyEvaluate(input: {
      policyJson: unknown;
    }) {
      return policyStore.evaluate(input.policyJson);
    },

    orchestrationPolicyCompareBaselines(input: {
      policyJson: unknown;
    }) {
      return policyStore.comparePolicyToBaselines(input.policyJson);
    },

    orchestrationPolicyActivate(input: PolicyActivationInput) {
      return policyStore.activate(input);
    },

    orchestrationPolicyGet() {
      return policyStore.getActive();
    },

    orchestrationPolicyLiveFeedback(input: OrchestrationTrace) {
      return policyStore.recordLiveFeedback(input);
    },

    reasoningTraceRecord(input: ReasoningTrace) {
      return reasoningStore.record(input);
    },

    reasoningDatasetExport() {
      return reasoningStore.exportJsonl();
    },

    reasoningStrategyEvaluate() {
      return reasoningStore.evaluateStrategies();
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

    async agentDispatchExecute(input: AgentDispatchInput) {
      const run = agentRegistry.dispatch(input);
      const agent = agentRegistry.list().find((candidate) => candidate.agentId === run.assignedAgentId);
      if (!agent) {
        throw new Error(`Agent not found for run: ${run.assignedAgentId}`);
      }
      let result: AgentRunResult;
      try {
        result = await executeAgentTransport(agent, run);
      } catch (error) {
        result = {
          status: "failed",
          summary: `Agent transport failed: ${error instanceof Error ? error.message : String(error)}`,
          output: {
            transport: agent.transport,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
      return agentRegistry.complete(run.runId, result);
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

    projectContractDetect(input: { repoRoot: string }): ProjectContract {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return detectProjectContract({ repoRoot });
    },

    dependencyInventory(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const contract = detectProjectContract({ repoRoot });
      return {
        repoRoot,
        packageManager: contract.packageManager,
        dependencies: contract.dependencies,
      };
    },

    projectCommandMap(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const contract = detectProjectContract({ repoRoot });
      return {
        repoRoot,
        packageManager: contract.packageManager,
        scripts: contract.scripts,
      };
    },

    diagnosticsFromCommand(input: { source: string; output: string }) {
      return normalizeCommandDiagnostics(input);
    },

    diagnosticsFromLsp(input: Parameters<typeof normalizeLspDiagnostics>[0]) {
      return normalizeLspDiagnostics(input);
    },

    diagnosticsRecord(input: { diagnostics: DiagnosticRecord[] }) {
      const diagnostics = diagnosticStore.recordMany(input.diagnostics);
      return { diagnostics, count: diagnostics.length };
    },

    diagnosticsQuery(input: DiagnosticQuery = {}) {
      return diagnosticStore.query(input);
    },

    lspFeedbackReplan(
      input: Parameters<typeof normalizeLspDiagnostics>[0] &
        Omit<MissionDeltaReplanInput, "repoRoot" | "objective" | "changedFiles" | "diagnostics"> & {
          repoRoot?: string;
          objective?: string;
          changedFiles?: string[];
        },
    ) {
      const mission = input.missionId ? kernel.missionStatus(input.missionId).mission : undefined;
      const repoRootInput = input.repoRoot ?? mission?.repoRoot;
      const objective = input.objective ?? mission?.objective;
      if (!repoRootInput) {
        throw new Error("lsp_feedback_replan requires repoRoot or missionId");
      }
      if (!objective) {
        throw new Error("lsp_feedback_replan requires objective or missionId");
      }
      const repoRoot = resolveAllowedRepoRoot(repoRootInput, allowedRepoRoots);
      const diagnostics = normalizeLspDiagnostics(input).map((diagnostic) => ({
        ...diagnostic,
        file: diagnostic.file ? repoRelativePath(repoRoot, diagnostic.file) : undefined,
      }));
      const recordedDiagnostics = diagnosticStore.recordMany(diagnostics);
      const changedFiles = uniqueSorted([
        ...(input.changedFiles ?? []).map((file) => repoRelativePath(repoRoot, file)),
        ...diagnostics.map((diagnostic) => diagnostic.file ?? ""),
      ]);
      return {
        recorded: {
          diagnostics: recordedDiagnostics,
          count: recordedDiagnostics.length,
        },
        changedFiles,
        replan: createMissionDeltaReplan({
          ...input,
          repoRoot,
          objective,
          changedFiles,
          diagnostics,
        }),
      };
    },

    impactAnalyze(input: { repoRoot: string; changedFiles: string[] }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return analyzeImpact({ ...input, repoRoot });
    },

    testPlanSelect(input: { repoRoot: string; changedFiles: string[] }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const contract = detectProjectContract({ repoRoot });
      const impact = analyzeImpact({ repoRoot, changedFiles: input.changedFiles });
      return createVerificationPlan({ contract, impact });
    },

    verificationRun(input: { commands: VerificationCommand[] }) {
      return runVerificationPlan(input);
    },

    secretScan(input: { repoRoot?: string; source?: string; text?: string }) {
      if (input.text !== undefined) {
        return {
          findings: scanTextForSecrets({
            source: input.source ?? "inline",
            text: input.text,
          }),
        };
      }
      if (!input.repoRoot) {
        throw new Error("secret_scan requires repoRoot or text");
      }
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return scanRepoForSecrets({ repoRoot });
    },

    operationRiskReview(input: { command: string; args?: string[] }) {
      return reviewOperationRisk(input);
    },

    semanticIndexBuild(input: { records: SemanticRecordInput[] }) {
      return buildSemanticIndex(input);
    },

    semanticSearch(input: { index: SemanticIndex; query: string; limit?: number }) {
      return semanticSearch(input.index, { query: input.query, limit: input.limit });
    },

    lspProbe(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return lspProbe({ repoRoot });
    },

    lspServerConfigs(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return { repoRoot, servers: detectLanguageServerConfigs({ repoRoot }) };
    },

    lspNormalizeLocation(input: LspProtocolLocation) {
      return normalizeLspLocation(input);
    },

    projectOnboard(input: Parameters<typeof projectOnboard>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return projectOnboard({ ...input, repoRoot });
    },

    architectureMap(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createArchitectureMap({ repoRoot });
    },

    entrypointFlowDiscover(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return discoverEntrypointFlows({ repoRoot });
    },

    blastRadiusAnalyze(input: { repoRoot: string; changedFiles: string[]; diffText?: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return analyzeBlastRadius({ ...input, repoRoot });
    },

    contextPackGenerate(input: {
      repoRoot: string;
      objective: string;
      query: string;
      changedFiles?: string[];
      maxChars: number;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return generateProjectContextPack({ ...input, repoRoot });
    },

    projectIntelligenceSnapshot(input: Parameters<typeof createProjectIntelligenceSnapshot>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createProjectIntelligenceSnapshot({ ...input, repoRoot });
    },

    nextBestTool(input: Parameters<typeof recommendNextBestTool>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return recommendNextBestTool({ ...input, repoRoot });
    },

    missionRoute(input: Parameters<typeof recommendMissionRoute>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return recommendMissionRoute({ ...input, repoRoot });
    },

    agentContextPrepare(input: Parameters<typeof prepareAgentContext>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return prepareAgentContext({ ...input, repoRoot });
    },

    missionDeltaReplan(
      input: Omit<MissionDeltaReplanInput, "repoRoot" | "objective"> & {
        repoRoot?: string;
        objective?: string;
      },
    ) {
      const mission = input.missionId ? kernel.missionStatus(input.missionId).mission : undefined;
      const repoRootInput = input.repoRoot ?? mission?.repoRoot;
      const objective = input.objective ?? mission?.objective;
      if (!repoRootInput) {
        throw new Error("mission_delta_replan requires repoRoot or missionId");
      }
      if (!objective) {
        throw new Error("mission_delta_replan requires objective or missionId");
      }
      const repoRoot = resolveAllowedRepoRoot(repoRootInput, allowedRepoRoots);
      return createMissionDeltaReplan({
        ...input,
        repoRoot,
        objective,
      });
    },

    durableRepoIndexRefresh(input: RepoIndexBuildOptions) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return refreshDurableRepoIndex({ ...input, repoRoot });
    },

    durableIndexStatus(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return durableIndexStatus({ repoRoot });
    },

    durableSemanticIndexRefresh(input: { repoRoot: string; records: SemanticRecordInput[] }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return refreshDurableSemanticIndex({ ...input, repoRoot });
    },

    durableSemanticSearch(input: { repoRoot: string; query: string; limit?: number }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return searchDurableSemanticIndex({ ...input, repoRoot });
    },

    testImpactAnalyzeV2(input: { repoRoot: string; changedFiles: string[]; diffText?: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return analyzeTestImpactV2({ ...input, repoRoot });
    },

    dependencySecurityReport(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createDependencySecurityReport({ repoRoot });
    },

    actionPolicyReview(input: { operations: ActionPolicyOperation[] }) {
      return reviewActionPolicy(input);
    },

    agentRemitCreate(input: AgentRemitInput) {
      return createAgentRemit(input);
    },

    agentCapabilityInventory(input: AgentCapabilityInventoryInput) {
      const repoRoot = input.repoRoot ? resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots) : undefined;
      return inventoryAgentCapabilities({ ...input, repoRoot });
    },

    agentBehaviorVerify(input: { remit: AgentRemit; inventory: AgentCapabilityInventory }) {
      return verifyAgentBehavior(input);
    },

    remitCoverageReport(input: { report: AgentBehaviorVerificationReport }) {
      return createRemitCoverageReport(input.report);
    },

    agentDriftAnalyze(input: { remit: AgentRemit; currentInventory: AgentCapabilityInventory }) {
      return analyzeAgentDrift(input);
    },

    behaviorFindingsRender(input: { report: AgentBehaviorVerificationReport }) {
      return { markdown: renderBehaviorFindings(input.report) };
    },

    lspSessionStart(input: Parameters<typeof lspSessionManager.start>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return lspSessionManager.start({ ...input, repoRoot });
    },

    lspSessionList() {
      return lspSessionManager.list();
    },

    lspSessionStatus(input: { sessionId: string }) {
      return lspSessionManager.status(input);
    },

    lspSessionRequest(input: Parameters<typeof lspSessionManager.request>[0]) {
      return lspSessionManager.request(input);
    },

    lspSessionStop(input: { sessionId: string }) {
      return lspSessionManager.stop(input);
    },

    agentWorkspaceCreate(input: AgentWorkspaceCreateInput) {
      return agentWorkspaceStore.create(input);
    },

    agentWorkspaceWrite(input: AgentWorkspaceWriteInput) {
      return agentWorkspaceStore.write(input);
    },

    agentWorkspaceRead(input: AgentWorkspaceReadInput) {
      return agentWorkspaceStore.read(input);
    },

    agentWorkspaceMerge(input: AgentWorkspaceMergeInput) {
      return agentWorkspaceStore.merge(input);
    },

    optimizationAdapterRegister(input: OptimizationAdapterDescriptor) {
      return optimizationAdapterRegistry.register(input);
    },

    optimizationAdapterList() {
      return optimizationAdapterRegistry.list();
    },

    optimizationAdapterSelect(input: { capability: OptimizationKind }) {
      return optimizationAdapterRegistry.select(input);
    },

    optimizationAdapterRun(input: Parameters<typeof optimizationAdapterRegistry.run>[0]) {
      return optimizationAdapterRegistry.run(input);
    },

    toolFactoryGenerate(input: ToolFactoryInput) {
      return generateToolScaffold(input);
    },

    toolFactoryValidate(input: ToolScaffold) {
      return validateToolScaffold(input);
    },

    toolFactoryWrite(input: { scaffold: ToolScaffold; targetDir: string }) {
      resolveAllowedRepoRoot(input.targetDir, allowedRepoRoots);
      return writeToolScaffold(input.scaffold, { targetDir: input.targetDir });
    },

    conductorPlan(input: ConductorInput) {
      const activePolicy = policyStore.getActive();
      const { policyHint: _ignoredPolicyHint, ...publicInput } = input;
      return createConductorPlan({
        ...publicInput,
        policyHint: activePolicy
          ? { policyId: activePolicy.policyId, ...activePolicy.recommendedAction }
          : undefined,
      });
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
