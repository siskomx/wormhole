import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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
import {
  createResumeRepoFingerprint,
  createResumeStore,
  writeResumeArtifacts,
  type ResumeCheckpointInput,
  type ResumeRecordInput,
  type ResumeStoreSnapshot,
  type ResumeValidationGroundTruth,
  type ResumeValidationInput,
  type ResumeValidationResult,
} from "./resume-store.js";
import { createGraphArtifacts, type GraphCommunity } from "./graph-artifacts.js";
import type {
  EvidenceInput,
  EvidenceRecord,
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
import { createPythonSidecar, probePythonRuntime, type PythonSidecar } from "./python-sidecar.js";
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
import {
  createPrivilegedActionGate,
  type PrivilegedActionGate,
  type PrivilegedActionPolicy,
  type PrivilegedActionRequest,
} from "./privileged-action-gate.js";
import { createDependencySecurityReport } from "./dependency-security.js";
import {
  analyzeGitConflicts,
  createGitBranch,
  createGitCommit,
  gitLifecycleStatus,
  prepareGitBranch,
  prepareGitCommit,
  prepareGitPr,
} from "./git-lifecycle.js";
import {
  createDependencyRiskReport,
  runDependencyAuditLive,
  type DependencyCommandRunner,
} from "./dependency-risk.js";
import { checkDocsSync } from "./docs-sync.js";
import { analyzeWorkspaceGraph } from "./workspace-graph.js";
import { analyzeCoverageDelta, type CoverageDeltaInput } from "./coverage-delta.js";
import { scanCodeSmells } from "./code-smell-scan.js";
import {
  reviewDiffScope,
  type DiffScopeEvidence,
  type DiffScopeReviewResult,
} from "./diff-scope-review.js";
import { reviewTestQuality } from "./test-quality-review.js";
import {
  durableRepoIndexBuildOptions,
  durableIndexStatus,
  durableIndexManifestStatus,
  queryDurableShardedRepoIndex,
  refreshDurableIndexManifest,
  refreshDurableRepoIndex,
  refreshDurableSemanticIndex,
  searchDurableSemanticIndex,
} from "./durable-index-store.js";
import {
  queryDomainApi,
  queryDomainCoverage,
  queryDomainDrift,
  queryDomainSlice,
  queryDomainTable,
  queryDomainVerificationGatePlan,
  readDomainIndexStatus,
  refreshDomainIndex,
} from "./sqlite-domain-index.js";
import {
  applyDomainManifestCandidate,
  diffDomainManifestCandidate,
  generateDomainManifestCandidate,
  readDomainManifestSeederStatus,
} from "./domain-manifest-seeder.js";
import {
  createRepoActivityStore,
  type RepoActivityRecordInput,
  type RepoActivitySnapshot,
  type RepoChangeScanInput,
  type RepoWatchStartInput,
} from "./repo-activity.js";
import { createLspSessionManager } from "./lsp-session-manager.js";
import {
  createOptimizationAdapterRegistry,
  type OptimizationAdapterDescriptor,
  type OptimizationAdapterSnapshot,
} from "./optimization-adapter.js";
import { projectOnboard } from "./project-onboard.js";
import {
  buildRepoNativePack,
  queryFeatureSlice,
  type RepoNativePackInput,
} from "./repo-native-pack.js";
import {
  analyzeBlastRadius,
  createArchitectureMap,
  createProjectModelCache,
  discoverEntrypointFlows,
  generateProjectContextPack,
  type ProjectModelCache,
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
  createBugfixWorkflow,
  createFeatureWorkflow,
  createOnboardingWorkflow,
  createReviewWorkflow,
  type WorkflowKind,
  type WorkflowInput,
} from "./workflows.js";
import { writeWorkflowArtifacts } from "./workflow-files.js";
import type {
  GateFreshnessInput,
  GateLoopHealthInput,
  GateRuntimeBehaviorInput,
  GateSourceConflictsInput,
} from "./gate-signals.js";
import {
  createPatchTransactionStore,
  type PatchTransactionSnapshot,
  type PatchVerificationCommand,
} from "./patch-transactions.js";
import {
  queryToolCatalog as queryRegistryToolCatalog,
  reviewToolAdmission as reviewRegistryToolAdmission,
  toolExposureProfile as createRegistryToolExposureProfile,
  toolLayerMap as createRegistryToolLayerMap,
  type ToolAdmissionReviewInput,
  type ToolCatalogQueryInput,
  type ToolExposureProfileInput,
} from "./tool-registry.js";
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
  checkBlueprintGate,
  compileBootstrapBlueprint,
  compileRepoBlueprint,
  type BlueprintGateInput,
} from "./blueprint.js";
import { writeBlueprintArtifacts, writeProgressiveBlueprintArtifacts } from "./blueprint-files.js";
import {
  checkAppProcessGate,
  compileAppProcess,
  validateAppProcess,
  type AppProcess,
  type AppProcessGateInput,
} from "./app-process.js";
import { writeAppProcessArtifacts } from "./app-process-files.js";
import {
  acceptAppProcessRunSectionFile,
  continueAppProcessRunFile,
  loadAppProcessRunBundle,
  recordAppProcessVerificationFile,
} from "./app-process-run-files.js";
import type { AppProcessDraftSectionId } from "./app-process-run.js";
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
import { analyzeRepoGraph } from "./repo-graph-analysis.js";
import {
  getGraphCommunity,
  graphCommunityStorePath,
  listGraphCommunities,
  readGraphCommunityStore,
  refreshGraphCommunities,
} from "./graph-communities.js";
import { getSurprisingConnections as rankSurprisingConnections } from "./surprising-connections.js";
import { renderGraphWiki, writeGraphWiki } from "./graph-wiki.js";
import {
  graphNodeSemanticIndexPath,
  readGraphNodeSemanticIndex,
  refreshGraphNodeSemanticIndex,
  searchGraphNodeSemanticIndex,
  type GraphNodeKind,
} from "./graph-node-semantic.js";
import {
  executionFlowStorePath,
  getExecutionFlow,
  listExecutionFlows,
  readExecutionFlowStore,
  refreshExecutionFlows,
} from "./execution-flow-store.js";
import { analyzeSourceConflicts } from "./source-conflicts.js";
import {
  auditCapabilityRelations,
  createDefaultCapabilityRelationAuditInput,
} from "./capability-relation-audit.js";
import {
  auditRuntimeBehavior,
  type RuntimeBehaviorAuditInput,
} from "./runtime-behavior-audit.js";
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
  privilegedActionGate?: PrivilegedActionGate;
  privilegedActionPolicy?: PrivilegedActionPolicy;
  projectModelCache?: ProjectModelCache;
  pythonSidecar?: PythonSidecar;
  dependencyAuditRunner?: DependencyCommandRunner;
};

export type StateMaintenanceAction = {
  toolName: string;
  status: "ran" | "skipped" | "failed";
  reason?: string;
};

export type StateMaintenanceContextInput = {
  maxChars: number;
  recordIds?: string[];
  pinnedRecordIds?: string[];
  staleRecordIds?: string[];
};

export type StateMaintenanceWorkspaceInput = {
  workspaceId: string;
  runId?: string;
  key?: string;
  value?: unknown;
  visibility?: "shared" | "private";
  merge?: boolean;
  runIds?: string[];
};

export type StateMaintenanceFreshness = {
  durableIndex: ReturnType<typeof durableIndexStatus>;
  durableIndexManifest: ReturnType<typeof durableIndexManifestStatus>;
};

export type StateMaintenanceRunInput = {
  repoRoot: string;
  missionId?: string;
  objective: string;
  query?: string;
  changedFiles?: string[];
  diffText?: string;
  watchId?: string;
  scanWatch?: boolean;
  refreshGraph?: boolean;
  sourceConflicts?: boolean;
  freshness?: boolean;
  recordEvidence?: boolean;
  context?: StateMaintenanceContextInput;
  workspace?: StateMaintenanceWorkspaceInput;
};

export type StateMaintenanceRunStatus = "running" | "completed" | "failed";

export type StateMaintenanceRunRecord = {
  runId: string;
  retryOf?: string;
  status: StateMaintenanceRunStatus;
  repoRoot: string;
  missionId?: string;
  objective: string;
  query: string;
  input: StateMaintenanceRunInput;
  changedFiles: string[];
  actions: StateMaintenanceAction[];
  sourceConflicts?: ReturnType<typeof analyzeSourceConflicts>;
  freshness?: StateMaintenanceFreshness;
  resume?: ResumeValidationResult;
  derivedGraphArtifacts?: StateMaintenanceDerivedGraphArtifacts;
  startedAt: string;
  updatedAt: string;
  error?: string;
};

export type StateMaintenanceDerivedGraphArtifactKind =
  | "communities"
  | "flows"
  | "graph_node_semantic_index"
  | "graph_wiki";

export type StateMaintenanceDerivedGraphArtifactStatus = {
  kind: StateMaintenanceDerivedGraphArtifactKind;
  status: "missing" | "fresh" | "stale";
  path: string;
  hint: string;
  fingerprint?: string;
  reason?: string;
};

export type StateMaintenanceDerivedGraphArtifacts = {
  statuses: StateMaintenanceDerivedGraphArtifactStatus[];
  warnings: string[];
};

export type StateMaintenanceSnapshot = {
  runs: StateMaintenanceRunRecord[];
};

export type StateMaintenanceStatusInput = {
  runId?: string;
  status?: StateMaintenanceRunStatus;
};

export type StateMaintenanceRetryInput = {
  runId: string;
  overrides?: Partial<StateMaintenanceRunInput>;
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
  resume?: Partial<ResumeStoreSnapshot>;
  repoActivity?: Partial<RepoActivitySnapshot>;
  patchTransactions?: Partial<PatchTransactionSnapshot>;
  stateMaintenance?: Partial<StateMaintenanceSnapshot>;
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
  const resumeStore = createResumeStore(runtimeState.resume, (snapshot) =>
    persistRuntimeState("resume", snapshot),
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
  const pythonSidecar = options.pythonSidecar ?? createPythonSidecar();
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
  const repoActivityStore = createRepoActivityStore(runtimeState.repoActivity, (snapshot) =>
    persistRuntimeState("repoActivity", snapshot),
  );
  const patchTransactionStore = createPatchTransactionStore(runtimeState.patchTransactions, (snapshot) =>
    persistRuntimeState("patchTransactions", snapshot),
  );
  const stateMaintenanceRuns = new Map<string, StateMaintenanceRunRecord>(
    (runtimeState.stateMaintenance?.runs ?? []).map((run) => [run.runId, run]),
  );
  function cloneStateMaintenanceRun(run: StateMaintenanceRunRecord): StateMaintenanceRunRecord {
    return JSON.parse(JSON.stringify(run)) as StateMaintenanceRunRecord;
  }
  function persistStateMaintenance(): void {
    persistRuntimeState("stateMaintenance", {
      runs: [...stateMaintenanceRuns.values()].map((run) => cloneStateMaintenanceRun(run)),
    });
  }
  function saveStateMaintenanceRun(run: StateMaintenanceRunRecord): void {
    stateMaintenanceRuns.set(run.runId, cloneStateMaintenanceRun(run));
    persistStateMaintenance();
  }
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
  const projectModelCache = options.projectModelCache ?? createProjectModelCache({
    maxEntries: maxCachedRepoIndexes,
  });
  const privilegedActionGate =
    options.privilegedActionGate ?? createPrivilegedActionGate(options.privilegedActionPolicy);

  function assertPrivilegedAction(request: PrivilegedActionRequest): void {
    privilegedActionGate.assertAllowed(request);
  }

  function existingResumeChangedFiles(repoRoot: string, changedFiles: string[]): string[] {
    return changedFiles.filter((file) => {
      const absolutePath = path.resolve(repoRoot, file);
      const relativePath = path.relative(repoRoot, absolutePath);
      return (
        relativePath !== "" &&
        !relativePath.startsWith("..") &&
        !path.isAbsolute(relativePath) &&
        existsSync(absolutePath)
      );
    });
  }

  function buildResumeValidationGroundTruth(repoRoot: string, changedFiles: string[]): ResumeValidationGroundTruth {
    return {
      evidenceIds: kernel
        .evidenceRecords()
        .map((record) => record.evidenceId)
        .sort((left, right) => left.localeCompare(right)),
      contextPackIds: contextStore.snapshot().packs.map((pack) => pack.packId),
      repoFingerprint: createResumeRepoFingerprint(repoRoot),
      existingChangedFiles: existingResumeChangedFiles(repoRoot, changedFiles),
    };
  }

  function getRepoIndex(
    repoRoot: string,
    indexOptions?: Omit<RepoIndexBuildOptions, "repoRoot">,
  ): RepoIndex {
    const absoluteRoot = resolveAllowedRepoRoot(repoRoot, allowedRepoRoots);
    const cacheKey = createRepoIndexCacheKey({ ...(indexOptions ?? {}), repoRoot: absoluteRoot });
    const existing = repoIndexes.get(cacheKey);
    if (existing && isRepoIndexFresh(existing)) {
      return existing;
    }
    const index = buildRepoIndex({ ...(indexOptions ?? {}), repoRoot: absoluteRoot });
    repoIndexes.set(cacheKey, index);
    evictOldestRepoIndex(repoIndexes, maxCachedRepoIndexes);
    return index;
  }

  function preservedRepoIndexOptions(repoRoot: string): Omit<RepoIndexBuildOptions, "repoRoot"> | undefined {
    return durableRepoIndexBuildOptions({ repoRoot });
  }

  function clearRepoIndexCaches(
    repoRoot: string,
    indexOptions?: Omit<RepoIndexBuildOptions, "repoRoot">,
  ): void {
    const absoluteRoot = resolveAllowedRepoRoot(repoRoot, allowedRepoRoots);
    repoIndexes.delete(createRepoIndexCacheKey({ repoRoot: absoluteRoot }));
    if (indexOptions) {
      repoIndexes.delete(createRepoIndexCacheKey({ ...indexOptions, repoRoot: absoluteRoot }));
    }
    projectModelCache.delete(absoluteRoot);
  }

  function compileBlueprintForRepo(input: { repoRoot: string; objective: string }) {
    const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
    return compileRepoBlueprint({
      objective: input.objective,
      onboard: projectOnboard({ repoRoot }),
      architecture: createArchitectureMap({ repoRoot, projectModelCache }),
      entrypoints: discoverEntrypointFlows({ repoRoot, projectModelCache }),
    });
  }

  function compileAppProcessForRepo(input: { repoRoot: string; objective: string }) {
    const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
    return compileAppProcess({
      repoRoot,
      objective: input.objective,
      blueprint: compileBootstrapBlueprint({ repoRoot, objective: input.objective }),
    });
  }

  function createWorkflowByKind(workflow: WorkflowKind, input: WorkflowInput) {
    switch (workflow) {
      case "workflow_start_feature":
        return createFeatureWorkflow(input);
      case "workflow_fix_bug":
        return createBugfixWorkflow(input);
      case "workflow_review_pr":
        return createReviewWorkflow(input);
      case "workflow_onboard_repo":
        return createOnboardingWorkflow(input);
    }
  }

  function refreshRepoGraphForChangedFiles(input: {
    repoRoot: string;
    changedFiles: string[];
    diffText?: string;
  }) {
    const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
    const changedFiles = uniqueSorted(input.changedFiles.map((file) => repoRelativePath(repoRoot, file)));
    const indexOptions = preservedRepoIndexOptions(repoRoot);
    const index = refreshDurableRepoIndex({ ...(indexOptions ?? {}), repoRoot });
    clearRepoIndexCaches(repoRoot, indexOptions);
    const testImpact = analyzeTestImpactV2({
      repoRoot,
      changedFiles,
      diffText: input.diffText,
    });
    const activity = repoActivityStore.recordActivity({
      repoRoot,
      kind: "graph_refreshed",
      summary: `Refreshed repo graph for changed files: ${changedFiles.join(", ")}.`,
      paths: changedFiles,
      metadata: {
        refreshMode: "full_rebuild",
        indexPath: index.indexPath,
        fileCount: index.summary.fileCount,
        edgeCount: index.summary.edgeCount,
      },
    });
    return {
      repoRoot,
      changedFiles,
      refreshMode: "full_rebuild" as const,
      index,
      testImpact,
      activity,
    };
  }

  function markIncrementalCompatibility<T extends ReturnType<typeof refreshRepoGraphForChangedFiles>>(
    result: T,
  ): T & {
    incremental: false;
    compatibilityAlias: true;
    warnings: string[];
  } {
    return {
      ...result,
      incremental: false,
      compatibilityAlias: true,
      warnings: [
        "repo_graph_refresh_incremental performed a full rebuild; partial graph mutation is not implemented yet.",
      ],
    };
  }

  function createDerivedGraphArtifactsReport(
    repoRoot: string,
    index: RepoIndex,
  ): StateMaintenanceDerivedGraphArtifacts {
    const communities = readGraphCommunityStore(repoRoot);
    const flows = readExecutionFlowStore(repoRoot);
    const graphNodeSemantic = readGraphNodeSemanticIndex(repoRoot);
    const wikiPath = path.join(repoRoot, ".wormhole", "graph-wiki", "index.md");
    const statuses: StateMaintenanceDerivedGraphArtifactStatus[] = [
      fingerprintedArtifactStatus({
        kind: "communities",
        path: graphCommunityStorePath(repoRoot),
        fingerprint: communities?.fingerprint,
        currentFingerprint: index.fingerprint,
        hint: "Run graph_communities_refresh.",
      }),
      fingerprintedArtifactStatus({
        kind: "flows",
        path: executionFlowStorePath(repoRoot),
        fingerprint: flows?.fingerprint,
        currentFingerprint: index.fingerprint,
        hint: "Run flows_refresh.",
      }),
      fingerprintedArtifactStatus({
        kind: "graph_node_semantic_index",
        path: graphNodeSemanticIndexPath(repoRoot),
        fingerprint: graphNodeSemantic?.fingerprint,
        currentFingerprint: index.fingerprint,
        hint: "Run graph_node_semantic_index_refresh.",
      }),
      {
        kind: "graph_wiki",
        status: existsSync(wikiPath) ? "fresh" : "missing",
        path: wikiPath,
        hint: "Run graph_wiki_generate with write=true.",
        ...(existsSync(wikiPath) ? {} : { reason: "Graph wiki index page is missing." }),
      },
    ];
    return {
      statuses,
      warnings: statuses
        .filter((status) => status.status !== "fresh")
        .map((status) => `${status.kind} is ${status.status}: ${status.reason ?? status.hint} ${status.hint}`),
    };
  }

  function fingerprintedArtifactStatus(input: {
    kind: StateMaintenanceDerivedGraphArtifactKind;
    path: string;
    fingerprint?: string;
    currentFingerprint: string;
    hint: string;
  }): StateMaintenanceDerivedGraphArtifactStatus {
    if (!input.fingerprint) {
      return {
        kind: input.kind,
        status: "missing",
        path: input.path,
        hint: input.hint,
        reason: `${input.kind} artifact is missing.`,
      };
    }
    if (input.fingerprint !== input.currentFingerprint) {
      return {
        kind: input.kind,
        status: "stale",
        path: input.path,
        fingerprint: input.fingerprint,
        hint: input.hint,
        reason: `${input.kind} artifact was built from a stale repo index fingerprint.`,
      };
    }
    return {
      kind: input.kind,
      status: "fresh",
      path: input.path,
      fingerprint: input.fingerprint,
      hint: input.hint,
    };
  }

  function runStateMaintenance(input: StateMaintenanceRunInput, retryOf?: string) {
    const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
    const query = input.query ?? input.objective;
    const actions: StateMaintenanceAction[] = [];
    const recordedEvidence: EvidenceRecord[] = [];
    let changedFiles = uniqueSorted((input.changedFiles ?? []).map((file) => repoRelativePath(repoRoot, file)));
    const startedAt = new Date().toISOString();
    const runRecord: StateMaintenanceRunRecord = {
      runId: `state-maintenance:${randomUUID()}`,
      ...(retryOf ? { retryOf } : {}),
      status: "running",
      repoRoot,
      missionId: input.missionId,
      objective: input.objective,
      query,
      input: {
        ...input,
        repoRoot,
        changedFiles,
      },
      changedFiles,
      actions,
      startedAt,
      updatedAt: startedAt,
    };
    let watchScan:
      | ReturnType<ReturnType<typeof createRepoActivityStore>["scanWatch"]>
      | undefined;
    let graph:
      | ReturnType<typeof refreshRepoGraphForChangedFiles>
      | undefined;
    let context:
      | ReturnType<ReturnType<typeof createContextStore>["refreshPack"]>
      | undefined;
    let sourceConflicts: ReturnType<typeof analyzeSourceConflicts> | undefined;
    let freshness: StateMaintenanceFreshness | undefined;
    let resume: ResumeValidationResult | undefined;
    let derivedGraphArtifacts: StateMaintenanceDerivedGraphArtifacts | undefined;
    let workspace:
      | {
          written?: ReturnType<ReturnType<typeof createAgentWorkspaceStore>["write"]>;
          merge?: ReturnType<ReturnType<typeof createAgentWorkspaceStore>["merge"]>;
        }
      | undefined;
    let route: ReturnType<typeof recommendMissionRoute> | undefined;
    let currentToolName = "state_maintenance_run";

    function addAction(action: StateMaintenanceAction): void {
      actions.push(action);
      runRecord.actions = [...actions];
      runRecord.changedFiles = [...changedFiles];
      runRecord.updatedAt = new Date().toISOString();
      saveStateMaintenanceRun(runRecord);
    }

    function finish(status: StateMaintenanceRunStatus, error?: string) {
      runRecord.status = status;
      runRecord.error = error;
      runRecord.actions = [...actions];
      runRecord.changedFiles = [...changedFiles];
      runRecord.sourceConflicts = sourceConflicts;
      runRecord.freshness = freshness;
      runRecord.resume = resume;
      runRecord.derivedGraphArtifacts = derivedGraphArtifacts;
      runRecord.updatedAt = new Date().toISOString();
      saveStateMaintenanceRun(runRecord);
      return {
        runId: runRecord.runId,
        ...(runRecord.retryOf ? { retryOf: runRecord.retryOf } : {}),
        status: runRecord.status,
        startedAt: runRecord.startedAt,
        updatedAt: runRecord.updatedAt,
        ...(runRecord.error ? { error: runRecord.error } : {}),
        repoRoot,
        missionId: input.missionId,
        objective: input.objective,
        query,
        changedFiles,
        actions,
        ...(watchScan ? { watchScan } : {}),
        ...(graph ? { graph } : {}),
        ...(context ? { context } : {}),
        ...(sourceConflicts ? { sourceConflicts } : {}),
        ...(freshness ? { freshness } : {}),
        ...(resume ? { resume } : {}),
        ...(derivedGraphArtifacts ? { derivedGraphArtifacts } : {}),
        recordedEvidence,
        ...(workspace ? { workspace } : {}),
        ...(route ? { route } : {}),
      };
    }

    saveStateMaintenanceRun(runRecord);

    try {
      if (input.watchId && input.scanWatch !== false) {
        currentToolName = "repo_watch_scan";
        watchScan = repoActivityStore.scanWatch({ watchId: input.watchId });
        resolveAllowedRepoRoot(watchScan.repoRoot, allowedRepoRoots);
        changedFiles = uniqueSorted([...changedFiles, ...watchScan.changedFiles]);
        addAction({ toolName: "repo_watch_scan", status: "ran" });
      }

      if (input.refreshGraph || (input.refreshGraph !== false && changedFiles.length > 0)) {
        currentToolName = "repo_graph_refresh_incremental";
        if (changedFiles.length > 0) {
          graph = markIncrementalCompatibility(
            refreshRepoGraphForChangedFiles({
              repoRoot,
              changedFiles,
              diffText: input.diffText,
            }),
          );
          addAction({ toolName: "repo_graph_refresh_incremental", status: "ran" });
        } else {
          addAction({
            toolName: "repo_graph_refresh_incremental",
            status: "skipped",
            reason: "No changed files were supplied or discovered.",
          });
        }
      }

      if (input.context) {
        currentToolName = "ctx_pack_refresh";
        context = contextStore.refreshPack({
          objective: input.objective,
          query,
          maxChars: input.context.maxChars,
          recordIds: input.context.recordIds,
          pinnedRecordIds: input.context.pinnedRecordIds,
          staleRecordIds: input.context.staleRecordIds,
          changedFiles,
        });
        addAction({ toolName: "ctx_pack_refresh", status: "ran" });
      }

      if (input.sourceConflicts) {
        currentToolName = "source_conflicts_analyze";
        const indexOptions = preservedRepoIndexOptions(repoRoot);
        sourceConflicts = analyzeSourceConflicts({
          repoRoot,
          index: getRepoIndex(repoRoot, indexOptions),
          contract: detectProjectContract({ repoRoot }),
        });
        addAction({ toolName: "source_conflicts_analyze", status: "ran" });
      }

      if (input.freshness) {
        currentToolName = "durable_index_status";
        const durableIndex = durableIndexStatus({ repoRoot });
        addAction({ toolName: "durable_index_status", status: "ran" });
        currentToolName = "durable_index_manifest_status";
        const durableIndexManifest = durableIndexManifestStatus({ repoRoot });
        addAction({ toolName: "durable_index_manifest_status", status: "ran" });
        freshness = {
          durableIndex,
          durableIndexManifest,
        };
      }

      if (resumeStore.hasState({ repoRoot })) {
        currentToolName = "resume_validate";
        const loaded = resumeStore.load({ repoRoot });
        resume = resumeStore.validate({
          repoRoot,
          groundTruth: buildResumeValidationGroundTruth(repoRoot, loaded.checkpoint?.changedFiles ?? []),
        });
        addAction({ toolName: "resume_validate", status: "ran" });
      }

      if (input.recordEvidence) {
        currentToolName = "record_evidence";
        if (input.missionId) {
          const missionStatus = kernel.missionStatus(input.missionId);
          if (missionStatus.roundsStarted === 0) {
            currentToolName = "round_start";
            kernel.startRound(input.missionId);
            addAction({
              toolName: "round_start",
              status: "ran",
              reason: "Started an evidence round before state maintenance recorded evidence.",
            });
            currentToolName = "record_evidence";
          }
          recordedEvidence.push(
            kernel.recordEvidence(input.missionId, {
              sourceType: "derived_note",
              retrievalMethod: "state_maintenance_run",
              summary:
                changedFiles.length > 0
                  ? `State maintenance refreshed changed files: ${changedFiles.join(", ")}.`
                  : "State maintenance ran without changed files.",
              rawContent: JSON.stringify(
                {
                  changedFiles,
                  graphRefreshMode: graph?.refreshMode,
                  graphIndexPath: graph?.index.indexPath,
                  contextPackId: context?.pack.packId,
                  sourceConflictCount: sourceConflicts?.conflicts.length,
                  durableRepoIndexFresh: freshness?.durableIndex.repoIndex?.fresh,
                  durableIndexManifestFresh: freshness?.durableIndexManifest.manifest?.fresh,
                  watchId: input.watchId,
                },
                null,
                2,
              ),
            }),
          );
          addAction({ toolName: "record_evidence", status: "ran" });
        } else {
          addAction({
            toolName: "record_evidence",
            status: "skipped",
            reason: "recordEvidence requires missionId.",
          });
        }
      }

      currentToolName = "derived_graph_artifacts_status";
      derivedGraphArtifacts = createDerivedGraphArtifactsReport(repoRoot, getRepoIndex(repoRoot));

      if (input.workspace) {
        workspace = {};
        if (input.workspace.key) {
          currentToolName = "agent_workspace_write";
          workspace.written = agentWorkspaceStore.write({
            workspaceId: input.workspace.workspaceId,
            runId: input.workspace.runId,
            key: input.workspace.key,
            value:
              input.workspace.value ??
              {
                changedFiles,
                graphRefreshMode: graph?.refreshMode,
                contextPackId: context?.pack.packId,
              },
            visibility: input.workspace.visibility,
            provenance:
              recordedEvidence.length > 0
                ? {
                    evidenceIds: recordedEvidence.map((record) => record.evidenceId),
                  }
                : undefined,
          });
          addAction({ toolName: "agent_workspace_write", status: "ran" });
        }
        if (input.workspace.merge) {
          currentToolName = "agent_workspace_merge";
          workspace.merge = agentWorkspaceStore.merge({
            workspaceId: input.workspace.workspaceId,
            runIds: input.workspace.runIds,
          });
          addAction({ toolName: "agent_workspace_merge", status: "ran" });
        }
      }

      currentToolName = "mission_route";
      route = recommendMissionRoute({
        repoRoot,
        objective: input.objective,
        query,
        changedFiles,
        diffText: input.diffText,
      });
      addAction({ toolName: "mission_route", status: "ran" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addAction({ toolName: currentToolName, status: "failed", reason: message });
      return finish("failed", message);
    }

    return finish("completed");
  }

  function latestMaintenanceSignalsForMission(missionId: string):
    | {
        sourceConflicts?: ReturnType<typeof analyzeSourceConflicts>;
        freshness?: StateMaintenanceFreshness;
        resume?: ResumeValidationResult;
      }
    | undefined {
    const completedRuns = [...stateMaintenanceRuns.values()]
      .filter((run) => run.missionId === missionId && run.status === "completed")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    let sourceConflicts: ReturnType<typeof analyzeSourceConflicts> | undefined;
    let freshness: StateMaintenanceFreshness | undefined;
    let resume: ResumeValidationResult | undefined;
    for (const run of completedRuns) {
      sourceConflicts ??= run.sourceConflicts;
      freshness ??= run.freshness;
      resume ??= run.resume;
      if (sourceConflicts && freshness && resume) {
        break;
      }
    }
    return sourceConflicts || freshness || resume
      ? { sourceConflicts, freshness, resume }
      : undefined;
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

    gateRequest(input: {
      missionId: string;
      sourceConflicts?: GateSourceConflictsInput;
      freshness?: GateFreshnessInput;
      runtimeBehavior?: GateRuntimeBehaviorInput;
      loopHealth?: GateLoopHealthInput;
    }) {
      const storedSignals = latestMaintenanceSignalsForMission(input.missionId);
      return kernel.requestGate(input.missionId, {
        sourceConflicts: input.sourceConflicts ?? storedSignals?.sourceConflicts,
        freshness: input.freshness ?? storedSignals?.freshness,
        runtimeBehavior: input.runtimeBehavior,
        loopHealth: input.loopHealth,
      });
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
      assertPrivilegedAction({
        toolName: "optimized_command_run",
        kind: "command",
        operations: [{ kind: "command", command: input.command, args: input.args }],
        target: { command: input.command, args: input.args },
      });
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

    resumeRecord(input: ResumeRecordInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return resumeStore.record({ ...input, repoRoot });
    },

    resumeCheckpoint(input: ResumeCheckpointInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "resume_checkpoint",
        kind: "file_write",
        operations: [{ kind: "file_write", path: path.join(repoRoot, ".wormhole/resume") }],
        target: { repoRoot, path: path.join(repoRoot, ".wormhole/resume") },
      });
      const checkpoint = resumeStore.checkpoint({
        ...input,
        repoRoot,
        repoFingerprint: createResumeRepoFingerprint(repoRoot),
      });
      const artifacts = writeResumeArtifacts({
        repoRoot,
        checkpoint,
        retainedCheckpointIds: resumeStore.retainedCheckpointIds({ repoRoot }),
      });
      return { ...checkpoint, files: artifacts.files, prunedFiles: artifacts.prunedFiles };
    },

    resumeValidate(input: ResumeValidationInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const loaded = resumeStore.load({ repoRoot });
      return resumeStore.validate({
        ...input,
        repoRoot,
        groundTruth: buildResumeValidationGroundTruth(repoRoot, loaded.checkpoint?.changedFiles ?? []),
      });
    },

    resumeLoad(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return resumeStore.load({ repoRoot });
    },

    pythonSidecarProbe() {
      return probePythonRuntime();
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
      assertPrivilegedAction({
        toolName: "shell_hook_install",
        kind: "shell_hook",
        operations: [{ kind: "file_write", path: planned.homeDir }],
        target: { path: planned.homeDir, repoRoot: planned.repoRoot },
      });
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
      assertPrivilegedAction({
        toolName: "shell_hook_uninstall",
        kind: "shell_hook",
        operations: [{ kind: "file_write", path: planned.homeDir }],
        target: { path: planned.homeDir, repoRoot: planned.repoRoot },
      });
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
      assertPrivilegedAction({
        toolName: "agent_dispatch_execute",
        kind: agent.transport === "http" ? "network" : "adapter_execute",
        operations:
          agent.transport === "http" && agent.runtime?.endpoint
            ? [{ kind: "network", url: agent.runtime.endpoint, method: agent.runtime.method ?? "POST" }]
            : [{ kind: "command", command: agent.runtime?.command ?? agent.target, args: agent.runtime?.args }],
        target: {
          adapterId: agent.agentId,
          command: agent.runtime?.command,
          args: agent.runtime?.args,
          url: agent.runtime?.endpoint,
        },
      });
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
      const cli = printingPressRegistry.list().find((candidate) => candidate.cliId === input.cliId);
      assertPrivilegedAction({
        toolName: "printing_press_run",
        kind: "adapter_execute",
        operations: [{ kind: "command", command: cli?.command ?? input.cliId, args: [...(cli?.args ?? []), ...(input.args ?? [])] }],
        target: {
          adapterId: input.cliId,
          command: cli?.command,
          args: [...(cli?.args ?? []), ...(input.args ?? [])],
        },
      });
      return printingPressRegistry.run(input);
    },

    repoIndexBuild(input: RepoIndexBuildOptions) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const index = buildRepoIndex({ ...input, repoRoot });
      repoIndexes.set(createRepoIndexCacheKey({ ...input, repoRoot }), index);
      projectModelCache.delete(repoRoot);
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

    repoGraphAnalyze(input: { repoRoot: string; changedFiles?: string[]; limit?: number }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const changedFiles = input.changedFiles?.map((file) => repoRelativePath(repoRoot, file));
      return analyzeRepoGraph({
        index: getRepoIndex(repoRoot),
        changedFiles,
        limit: input.limit,
      });
    },

    sourceConflictsAnalyze(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return analyzeSourceConflicts({
        repoRoot,
        index: getRepoIndex(repoRoot),
        contract: detectProjectContract({ repoRoot }),
      });
    },

    capabilityRelationAudit(input: { allowlist?: string[] } = {}) {
      return auditCapabilityRelations(
        createDefaultCapabilityRelationAuditInput({
          allowlist: input.allowlist,
        }),
      );
    },

    runtimeBehaviorAudit(input: RuntimeBehaviorAuditInput) {
      return auditRuntimeBehavior(input);
    },

    repoGraphExport(input: { repoRoot: string; communities?: GraphCommunity[] }) {
      return createGraphArtifacts(getRepoIndex(input.repoRoot), {
        communities: input.communities,
      });
    },

    async graphCommunitiesRefresh(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return await refreshGraphCommunities({
        repoRoot,
        index: getRepoIndex(repoRoot),
        sidecar: pythonSidecar,
      });
    },

    listCommunities(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return listGraphCommunities({ repoRoot, index: getRepoIndex(repoRoot) });
    },

    getCommunity(input: { repoRoot: string; id: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return getGraphCommunity({ repoRoot, index: getRepoIndex(repoRoot), id: input.id });
    },

    getSurprisingConnections(input: { repoRoot: string; limit?: number }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const index = getRepoIndex(repoRoot);
      const communities = listGraphCommunities({ repoRoot, index });
      if (communities.refused) {
        return {
          repoRoot,
          fingerprint: index.fingerprint,
          generatedAt: new Date().toISOString(),
          results: [],
          warnings: communities.reason ? [communities.reason] : [],
          refused: true as const,
          reason: communities.reason,
          hint: communities.hint,
        };
      }
      return rankSurprisingConnections({
        repoRoot,
        index,
        communities: communities.communities,
        limit: input.limit,
      });
    },

    graphWikiGenerate(input: {
      repoRoot: string;
      scope?: "all" | "overview" | "communities" | "flows";
      communityId?: string;
      flowId?: string;
      write?: boolean;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const index = getRepoIndex(repoRoot);
      const communities = listGraphCommunities({ repoRoot, index });
      const flows = listExecutionFlows({ repoRoot, currentFingerprint: index.fingerprint });
      const surprisingConnections = communities.refused
        ? undefined
        : rankSurprisingConnections({
            repoRoot,
            index,
            communities: communities.communities,
            limit: 12,
          }).results;
      const pages = renderGraphWiki({
        repoRoot,
        index,
        communities: communities.refused ? [] : communities.communities,
        flows: flows.refused ? [] : flows.flows,
        surprisingConnections,
        scope: input.scope,
        communityId: input.communityId,
        flowId: input.flowId,
      });
      if (!input.write) {
        return {
          repoRoot,
          pages,
          warnings: [
            ...(communities.refused && communities.reason ? [communities.reason] : []),
            ...(flows.refused && flows.reason ? [flows.reason] : []),
          ],
        };
      }
      assertPrivilegedAction({
        toolName: "graph_wiki_generate",
        kind: "file_write",
        operations: [{ kind: "file_write", path: path.join(repoRoot, ".wormhole/graph-wiki") }],
        target: { repoRoot, path: path.join(repoRoot, ".wormhole/graph-wiki") },
      });
      return {
        repoRoot,
        pages,
        written: writeGraphWiki({ repoRoot, pages }),
      };
    },

    flowsRefresh(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const index = getRepoIndex(repoRoot);
      const communities = listGraphCommunities({ repoRoot, index });
      return refreshExecutionFlows({
        repoRoot,
        discovery: discoverEntrypointFlows({ repoRoot, projectModelCache }),
        communities: communities.refused ? [] : communities.communities,
      });
    },

    listFlows(input: { repoRoot: string; kind?: "api" | "cli" | "worker" | "script"; query?: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return listExecutionFlows({
        ...input,
        repoRoot,
        currentFingerprint: getRepoIndex(repoRoot).fingerprint,
      });
    },

    getFlow(input: { repoRoot: string; idOrName: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return getExecutionFlow({
        repoRoot,
        idOrName: input.idOrName,
        currentFingerprint: getRepoIndex(repoRoot).fingerprint,
      });
    },

    graphNodeSemanticIndexRefresh(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const index = getRepoIndex(repoRoot);
      const communities = listGraphCommunities({ repoRoot, index });
      const flows = listExecutionFlows({ repoRoot, currentFingerprint: index.fingerprint });
      return refreshGraphNodeSemanticIndex({
        repoRoot,
        index,
        communities: communities.refused ? [] : communities.communities,
        flows: flows.refused ? [] : flows.flows,
      });
    },

    graphNodeSemanticSearch(input: {
      repoRoot: string;
      query: string;
      limit?: number;
      kinds?: GraphNodeKind[];
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return searchGraphNodeSemanticIndex({ ...input, repoRoot });
    },

    repoWatchStart(input: RepoWatchStartInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return repoActivityStore.startWatch({ ...input, repoRoot });
    },

    repoWatchScan(input: { watchId: string }) {
      const scan = repoActivityStore.scanWatch(input);
      resolveAllowedRepoRoot(scan.repoRoot, allowedRepoRoots);
      const session = repoActivityStore.status({ watchId: input.watchId }).sessions[0];
      const recordedEvidence = [];
      if (session?.options.autoRecord && session.missionId && scan.changedFiles.length > 0) {
        recordedEvidence.push(
          kernel.recordEvidence(session.missionId, {
            sourceType: "derived_note",
            retrievalMethod: "repo_watch_scan",
            summary: `Repo watch detected changed files: ${scan.changedFiles.join(", ")}.`,
            rawContent: JSON.stringify(
              {
                changedFiles: scan.changedFiles,
                fileChanges: scan.fileChanges,
                git: scan.git,
              },
              null,
              2,
            ),
          }),
        );
      }
      const graphRefresh =
        session?.options.autoRefreshGraph && scan.changedFiles.length > 0
          ? refreshDurableRepoIndex({
              ...(preservedRepoIndexOptions(scan.repoRoot) ?? {}),
              repoRoot: scan.repoRoot,
            })
          : undefined;
      if (graphRefresh) {
        clearRepoIndexCaches(scan.repoRoot, preservedRepoIndexOptions(scan.repoRoot));
        repoActivityStore.recordActivity({
          repoRoot: scan.repoRoot,
          watchId: input.watchId,
          missionId: session?.missionId,
          kind: "graph_refreshed",
          summary: `Refreshed repo graph after watch changes: ${scan.changedFiles.join(", ")}.`,
          paths: scan.changedFiles,
          metadata: {
            indexPath: graphRefresh.indexPath,
            fileCount: graphRefresh.summary.fileCount,
            edgeCount: graphRefresh.summary.edgeCount,
          },
        });
      }
      return {
        ...scan,
        recordedEvidence,
        ...(graphRefresh ? { graphRefresh } : {}),
      };
    },

    repoWatchStatus(input: { repoRoot?: string; watchId?: string } = {}) {
      const repoRoot = input.repoRoot ? resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots) : undefined;
      return repoActivityStore.status({ ...input, repoRoot });
    },

    repoWatchStop(input: { watchId: string }) {
      return repoActivityStore.stopWatch(input);
    },

    repoChangeScan(input: RepoChangeScanInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return repoActivityStore.scanChanges({ ...input, repoRoot });
    },

    repoActivityRecord(input: RepoActivityRecordInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return repoActivityStore.recordActivity({ ...input, repoRoot });
    },

    repoGraphRefreshIncremental(input: {
      repoRoot: string;
      changedFiles: string[];
      diffText?: string;
    }) {
      return markIncrementalCompatibility(refreshRepoGraphForChangedFiles(input));
    },

    repoGraphRefreshFull(input: {
      repoRoot: string;
      changedFiles: string[];
      diffText?: string;
    }) {
      return refreshRepoGraphForChangedFiles(input);
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
      const model = projectModelCache.get({ repoRoot });
      return analyzeImpact({ ...input, repoRoot, index: model.index });
    },

    testPlanSelect(input: { repoRoot: string; changedFiles: string[]; tier?: VerificationCommand["tier"] }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const model = projectModelCache.get({ repoRoot });
      const contract = model.contract;
      const impact = analyzeImpact({ repoRoot, changedFiles: input.changedFiles, index: model.index });
      return createVerificationPlan({ contract, impact, changedFiles: input.changedFiles, tier: input.tier });
    },

    verificationRun(input: { commands: VerificationCommand[] }) {
      for (const command of input.commands) {
        assertPrivilegedAction({
          toolName: "verification_run",
          kind: "command",
          operations: [{ kind: "command", command: command.command, args: command.args }],
          target: { command: command.command, args: command.args, repoRoot: command.cwd },
        });
      }
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

    repoNativePackBuild(input: RepoNativePackInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return buildRepoNativePack({ ...input, repoRoot });
    },

    featureSliceQuery(input: RepoNativePackInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return queryFeatureSlice({ ...input, repoRoot });
    },

    blueprintCompileRepo(input: { repoRoot: string; objective: string; progressive?: boolean }) {
      if (input.progressive) {
        const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
        return compileBootstrapBlueprint({ ...input, repoRoot });
      }
      return compileBlueprintForRepo(input);
    },

    blueprintWriteArtifacts(input: { repoRoot: string; objective: string; progressive?: boolean }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "blueprint_write_artifacts",
        kind: "file_write",
        operations: [{ kind: "file_write", path: path.join(repoRoot, ".wormhole") }],
        target: { repoRoot, path: path.join(repoRoot, ".wormhole") },
      });
      if (input.progressive) {
        const result = compileBootstrapBlueprint({ ...input, repoRoot });
        return writeProgressiveBlueprintArtifacts({ repoRoot, result });
      }
      const result = compileBlueprintForRepo({ ...input, repoRoot });
      return writeBlueprintArtifacts({ repoRoot, result });
    },

    blueprintGateCheck(input: BlueprintGateInput) {
      return checkBlueprintGate(input);
    },

    appProcessCompile(input: { repoRoot: string; objective: string }) {
      return compileAppProcessForRepo(input);
    },

    appProcessWriteArtifacts(input: { repoRoot: string; objective: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "app_process_write_artifacts",
        kind: "file_write",
        operations: [{ kind: "file_write", path: path.join(repoRoot, ".wormhole") }],
        target: { repoRoot, path: path.join(repoRoot, ".wormhole") },
      });
      return writeAppProcessArtifacts({
        repoRoot,
        result: compileAppProcessForRepo({ ...input, repoRoot }),
      });
    },

    appProcessValidate(input: { appProcess: AppProcess }) {
      return validateAppProcess(input.appProcess);
    },

    appProcessGateCheck(input: AppProcessGateInput) {
      return checkAppProcessGate(input);
    },

    appProcessStatus(input: { repoRoot: string; objective?: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return loadAppProcessRunBundle({ repoRoot, objective: input.objective });
    },

    appProcessAcceptSection(input: {
      repoRoot: string;
      section: AppProcessDraftSectionId;
      acceptedBy?: string;
      note?: string;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "app_process_accept_section",
        kind: "file_write",
        operations: [{ kind: "file_write", path: path.join(repoRoot, ".wormhole/app-process") }],
        target: { repoRoot, path: path.join(repoRoot, ".wormhole/app-process") },
      });
      return acceptAppProcessRunSectionFile({ ...input, repoRoot });
    },

    appProcessContinue(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "app_process_continue",
        kind: "file_write",
        operations: [{ kind: "file_write", path: path.join(repoRoot, ".wormhole/app-process") }],
        target: { repoRoot, path: path.join(repoRoot, ".wormhole/app-process") },
      });
      return continueAppProcessRunFile({ repoRoot });
    },

    appProcessRecordVerification(input: {
      repoRoot: string;
      command: string;
      args?: string[];
      status: "passed" | "failed" | "skipped";
      evidencePath?: string;
      summary?: string;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "app_process_record_verification",
        kind: "file_write",
        operations: [{ kind: "file_write", path: path.join(repoRoot, ".wormhole/app-process") }],
        target: { repoRoot, path: path.join(repoRoot, ".wormhole/app-process") },
      });
      return recordAppProcessVerificationFile({ ...input, repoRoot });
    },

    architectureMap(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createArchitectureMap({ repoRoot, projectModelCache });
    },

    entrypointFlowDiscover(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return discoverEntrypointFlows({ repoRoot, projectModelCache });
    },

    blastRadiusAnalyze(input: { repoRoot: string; changedFiles: string[]; diffText?: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return analyzeBlastRadius({ ...input, repoRoot, projectModelCache });
    },

    contextPackGenerate(input: {
      repoRoot: string;
      objective: string;
      query: string;
      changedFiles?: string[];
      maxChars: number;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return generateProjectContextPack({ ...input, repoRoot, projectModelCache });
    },

    projectIntelligenceSnapshot(input: Parameters<typeof createProjectIntelligenceSnapshot>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createProjectIntelligenceSnapshot({ ...input, repoRoot, projectModelCache });
    },

    toolLayerMap() {
      return createRegistryToolLayerMap();
    },

    toolExposureProfile(input: ToolExposureProfileInput = {}) {
      return createRegistryToolExposureProfile(input);
    },

    toolCatalogQuery(input: ToolCatalogQueryInput = {}) {
      return queryRegistryToolCatalog(input);
    },

    toolAdmissionReview(input: ToolAdmissionReviewInput) {
      return reviewRegistryToolAdmission(input);
    },

    workflowStartFeature(input: WorkflowInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createFeatureWorkflow({ ...input, repoRoot });
    },

    workflowFixBug(input: WorkflowInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createBugfixWorkflow({ ...input, repoRoot });
    },

    workflowReviewPr(input: WorkflowInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createReviewWorkflow({ ...input, repoRoot });
    },

    workflowOnboardRepo(input: WorkflowInput) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createOnboardingWorkflow({ ...input, repoRoot });
    },

    workflowWriteArtifacts(input: WorkflowInput & { workflow: WorkflowKind }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "workflow_write_artifacts",
        kind: "file_write",
        operations: [{ kind: "file_write", path: path.join(repoRoot, ".wormhole/workflows") }],
        target: { repoRoot, path: path.join(repoRoot, ".wormhole/workflows") },
      });
      return writeWorkflowArtifacts({
        repoRoot,
        workflow: createWorkflowByKind(input.workflow, { ...input, repoRoot }),
      });
    },

    nextBestTool(input: Parameters<typeof recommendNextBestTool>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return recommendNextBestTool({ ...input, repoRoot });
    },

    missionRoute(input: Parameters<typeof recommendMissionRoute>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return recommendMissionRoute({ ...input, repoRoot, projectModelCache });
    },

    agentContextPrepare(input: Parameters<typeof prepareAgentContext>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const indexOptions = preservedRepoIndexOptions(repoRoot);
      const durableStatus = durableIndexStatus({ repoRoot });
      const hasFreshDurableIndex = durableStatus.sqliteIndex?.fresh === true || durableStatus.repoIndex?.fresh === true;
      const durableQuery = hasFreshDurableIndex
        ? queryDurableShardedRepoIndex({
            repoRoot,
            query: input.query ?? input.objective,
            limit: 8,
            requireFresh: true,
          })
        : undefined;
      const durableRetrieval = durableQuery && !durableQuery.refused
        ? {
            usedSqlite: durableQuery.usedSqlite,
            ...(durableQuery.retrievalMode ? { retrievalMode: durableQuery.retrievalMode } : {}),
            results: durableQuery.results,
            warnings: durableQuery.warnings,
            indexHealth: durableQuery.indexHealth,
          }
        : undefined;
      const preferredSources = uniqueSorted(durableRetrieval?.results.map((result) => result.path) ?? []);
      return prepareAgentContext({
        ...input,
        repoRoot,
        projectModelCache,
        ...(indexOptions ? { indexOptions } : {}),
        ...(preferredSources.length > 0 ? { preferredSources } : {}),
        ...(durableRetrieval ? { durableRetrieval } : {}),
      });
    },

    projectModelCacheStats() {
      return projectModelCache.stats();
    },

    stateMaintenanceRun(input: StateMaintenanceRunInput) {
      return runStateMaintenance(input);
    },

    stateMaintenanceStatus(input: StateMaintenanceStatusInput = {}) {
      const runs = [...stateMaintenanceRuns.values()]
        .filter((run) => !input.runId || run.runId === input.runId)
        .filter((run) => !input.status || run.status === input.status)
        .map((run) => cloneStateMaintenanceRun(run));
      return { runs, count: runs.length };
    },

    stateMaintenanceRetry(input: StateMaintenanceRetryInput) {
      const previousRun = stateMaintenanceRuns.get(input.runId);
      if (!previousRun) {
        throw new Error(`State maintenance run not found: ${input.runId}`);
      }
      return runStateMaintenance(
        {
          ...cloneStateMaintenanceRun(previousRun).input,
          ...(input.overrides ?? {}),
        },
        previousRun.runId,
      );
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
      const result = refreshDurableRepoIndex({ ...input, repoRoot });
      const { repoRoot: _repoRoot, ...indexOptions } = input;
      clearRepoIndexCaches(repoRoot, indexOptions);
      return result;
    },

    durableIndexManifestRefresh(input: RepoIndexBuildOptions) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const result = refreshDurableIndexManifest({ ...input, repoRoot });
      const { repoRoot: _repoRoot, ...indexOptions } = input;
      clearRepoIndexCaches(repoRoot, indexOptions);
      return result;
    },

    durableIndexStatus(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return durableIndexStatus({ repoRoot });
    },

    durableIndexManifestStatus(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return durableIndexManifestStatus({ repoRoot });
    },

    durableRepoIndexQuery(input: Parameters<typeof queryDurableShardedRepoIndex>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return queryDurableShardedRepoIndex({ ...input, repoRoot });
    },

    domainIndexRefresh(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return refreshDomainIndex({ ...input, repoRoot });
    },

    domainIndexStatus(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return readDomainIndexStatus({ repoRoot });
    },

    domainManifestGenerate(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return generateDomainManifestCandidate({ repoRoot });
    },

    domainManifestDiff(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return diffDomainManifestCandidate({ repoRoot });
    },

    domainManifestStatus(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return readDomainManifestSeederStatus({ repoRoot });
    },

    domainManifestApply(input: { repoRoot: string; baseHash: string; refreshAfterApply?: boolean }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const diff = diffDomainManifestCandidate({ repoRoot });
      if (diff.blockers.length > 0) {
        throw new Error(`Cannot apply domain manifest candidate: ${diff.blockers.join(" ")}`);
      }
      if (input.baseHash !== diff.baseHash) {
        throw new Error(
          `Domain manifest base hash is stale: expected ${diff.baseHash}, received ${input.baseHash}. Re-run domain_manifest_diff before applying.`,
        );
      }
      assertPrivilegedAction({
        toolName: "domain_manifest_apply",
        kind: "file_write",
        operations: [{ kind: "file_write", path: path.join(repoRoot, ".wormhole/domain-index.json") }],
        target: { repoRoot, path: path.join(repoRoot, ".wormhole/domain-index.json") },
      });
      const result = applyDomainManifestCandidate({ repoRoot, baseHash: input.baseHash });
      if (!input.refreshAfterApply) {
        return result;
      }
      return {
        ...result,
        refreshed: refreshDomainIndex({ repoRoot }),
      };
    },

    domainSliceQuery(input: Parameters<typeof queryDomainSlice>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const result = queryDomainSlice({ ...input, repoRoot });
      if (result.refused || result.indexHealth.status === "missing" || result.indexHealth.status === "stale") {
        return {
          ...result,
          fallbackFeatureSlice: queryFeatureSlice({
            repoRoot,
            query: input.feature,
            limit: 1,
          }),
        };
      }
      return result;
    },

    domainApiQuery(input: Parameters<typeof queryDomainApi>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return queryDomainApi({ ...input, repoRoot });
    },

    domainTableQuery(input: Parameters<typeof queryDomainTable>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return queryDomainTable({ ...input, repoRoot });
    },

    domainIndexCoverage(input: Parameters<typeof queryDomainCoverage>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return queryDomainCoverage({ ...input, repoRoot });
    },

    domainIndexDrift(input: Parameters<typeof queryDomainDrift>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return queryDomainDrift({ repoRoot });
    },

    domainVerificationGatePlan(input: Parameters<typeof queryDomainVerificationGatePlan>[0]) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return queryDomainVerificationGatePlan({ ...input, repoRoot });
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
      const model = projectModelCache.get({ repoRoot });
      return analyzeTestImpactV2({ ...input, repoRoot, index: model.index });
    },

    dependencySecurityReport(input: { repoRoot: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createDependencySecurityReport({ repoRoot });
    },

    gitLifecycleStatus(input: { repoRoot: string; baseRef?: string; timeoutMs?: number }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return gitLifecycleStatus({ ...input, repoRoot });
    },

    gitBranchPrepare(input: { objective: string; prefix?: string }) {
      return prepareGitBranch(input);
    },

    gitBranchCreate(input: { repoRoot: string; branchName: string; checkout?: boolean; timeoutMs?: number }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "git_branch_create",
        kind: "command",
        operations: [{ kind: "command", command: "git", args: input.checkout ? ["switch", "-c", input.branchName] : ["branch", input.branchName] }],
        target: {
          repoRoot,
          command: "git",
          args: input.checkout ? ["switch", "-c", input.branchName] : ["branch", input.branchName],
        },
      });
      return createGitBranch({ ...input, repoRoot });
    },

    gitCommitPrepare(input: {
      repoRoot: string;
      objective: string;
      evidence?: Array<{ sourcePath?: string; summary: string }>;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return prepareGitCommit({ ...input, repoRoot });
    },

    gitCommitCreate(input: { repoRoot: string; files: string[]; message: string; timeoutMs?: number }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "git_commit_create",
        kind: "command",
        operations: [{ kind: "command", command: "git", args: ["commit", "--no-verify", "--message=<message>"] }],
        target: {
          repoRoot,
          command: "git",
          args: ["commit", "--no-verify", "--message=<message>"],
        },
      });
      return createGitCommit({ ...input, repoRoot });
    },

    gitPrPrepare(input: { repoRoot: string; baseRef?: string; objective?: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return prepareGitPr({ ...input, repoRoot });
    },

    gitConflictAnalyze(input: {
      repoRoot: string;
      timeoutMs?: number;
      maxFileBytes?: number;
      maxTotalBytes?: number;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return analyzeGitConflicts({ ...input, repoRoot });
    },

    dependencyRiskReport(input: { repoRoot: string; auditJson?: string; outdatedJson?: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return createDependencyRiskReport({ ...input, repoRoot });
    },

    dependencyAuditLive(input: {
      repoRoot: string;
      includeOutdated?: boolean;
      timeoutMs?: number;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "dependency_audit_live",
        kind: "command",
        operations: [{ kind: "command", command: "npm", args: ["audit", "--json"] }],
        target: { repoRoot, command: "npm", args: ["audit", "--json"] },
      });
      return runDependencyAuditLive({ ...input, repoRoot }, options.dependencyAuditRunner);
    },

    docsSyncCheck(input: {
      repoRoot: string;
      changedFiles?: string[];
      diffText?: string;
      requireDocsForPublicChanges?: boolean;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return checkDocsSync({
        ...input,
        repoRoot,
        index: getRepoIndex(repoRoot),
        contract: detectProjectContract({ repoRoot }),
      });
    },

    workspaceGraphAnalyze(input: { repoRoot: string; additionalRepoRoots?: string[] }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      const additionalRepoRoots = (input.additionalRepoRoots ?? []).map((root) =>
        resolveAllowedRepoRoot(root, allowedRepoRoots),
      );
      return analyzeWorkspaceGraph({ repoRoot, additionalRepoRoots });
    },

    codeSmellScan(input: {
      repoRoot: string;
      changedFiles?: string[];
      diffText?: string;
      maxComplexity?: number;
      duplicateMinLines?: number;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return scanCodeSmells({ ...input, repoRoot, index: getRepoIndex(repoRoot) });
    },

    diffScopeReview(input: {
      repoRoot: string;
      objective: string;
      diffText?: string;
      changedFiles?: string[];
      evidence?: DiffScopeEvidence[];
      approvedPaths?: string[];
      strict?: boolean;
    }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return reviewDiffScope({ ...input, repoRoot });
    },

    testQualityReview(input: { repoRoot: string; changedFiles: string[] }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return reviewTestQuality({ ...input, repoRoot });
    },

    coverageDeltaAnalyze(input: CoverageDeltaInput) {
      return analyzeCoverageDelta(input);
    },

    actionPolicyReview(input: { operations: ActionPolicyOperation[] }) {
      return reviewActionPolicy(input);
    },

    patchCheckpoint(input: { repoRoot: string; label?: string; files: string[] }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      return patchTransactionStore.checkpoint({ ...input, repoRoot });
    },

    patchApply(input: {
      repoRoot: string;
      checkpointId: string;
      unifiedDiff: string;
      verificationCommands?: PatchVerificationCommand[];
      scopeReview?: {
        objective: string;
        evidence?: DiffScopeEvidence[];
        approvedPaths?: string[];
        strict?: boolean;
      };
    }) {
      const { scopeReview: scopeReviewInput, ...patchInput } = input;
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      let scopeReview: DiffScopeReviewResult | undefined;
      if (scopeReviewInput) {
        scopeReview = reviewDiffScope({
          repoRoot,
          diffText: input.unifiedDiff,
          ...scopeReviewInput,
        });
        if (scopeReview.decision === "fail") {
          throw new Error(
            `Diff scope review failed: ${scopeReview.findings.map((finding) => finding.message).join(" ")}`,
          );
        }
      }
      assertPrivilegedAction({
        toolName: "patch_apply",
        kind: "file_write",
        operations: [{ kind: "file_write", path: repoRoot }],
        target: { repoRoot, path: repoRoot },
      });
      return patchTransactionStore.apply({ ...patchInput, repoRoot, ...(scopeReview ? { scopeReview } : {}) });
    },

    patchStatus(input: { repoRoot?: string; checkpointId?: string; transactionId?: string } = {}) {
      const repoRoot = input.repoRoot ? resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots) : undefined;
      return patchTransactionStore.status({ ...input, repoRoot });
    },

    patchRollback(input: { repoRoot: string; transactionId: string }) {
      const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
      assertPrivilegedAction({
        toolName: "patch_rollback",
        kind: "file_write",
        operations: [{ kind: "file_write", path: repoRoot }],
        target: { repoRoot, path: repoRoot },
      });
      return patchTransactionStore.rollback({ ...input, repoRoot });
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
      assertPrivilegedAction({
        toolName: "lsp_session_start",
        kind: "command",
        operations: [{ kind: "command", command: input.command, args: input.args }],
        target: { repoRoot, command: input.command, args: input.args },
      });
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
      const adapter = optimizationAdapterRegistry.list().find((candidate) => candidate.adapterId === input.adapterId);
      assertPrivilegedAction({
        toolName: "optimization_adapter_run",
        kind: adapter?.transport === "http" ? "network" : "adapter_execute",
        operations:
          adapter?.transport === "http" && adapter.endpoint
            ? [{ kind: "network", url: adapter.endpoint, method: "POST" }]
            : [{ kind: "command", command: adapter?.command ?? input.adapterId, args: adapter?.args }],
        target: {
          adapterId: input.adapterId,
          command: adapter?.command,
          args: adapter?.args,
          url: adapter?.endpoint,
        },
      });
      return optimizationAdapterRegistry.run(input);
    },

    toolFactoryGenerate(input: ToolFactoryInput) {
      return generateToolScaffold(input);
    },

    toolFactoryValidate(input: ToolScaffold) {
      return validateToolScaffold(input);
    },

    toolFactoryWrite(input: { scaffold: ToolScaffold; targetDir: string }) {
      assertPrivilegedAction({
        toolName: "tool_factory_write",
        kind: "file_write",
        operations: [{ kind: "tool_write", targetDir: input.targetDir }],
        target: { path: input.targetDir },
      });
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
