import {
  analyzeBlastRadius,
  createArchitectureMap,
  discoverEntrypointFlows,
  generateProjectContextPack,
  createProjectModelCache,
  type ArchitectureMap,
  type BlastRadiusAnalysis,
  type EntrypointFlowDiscovery,
  type ProjectModelCache,
  type ProjectContextPack,
} from "./project-intelligence.js";
import type { IndexHealthSnapshot } from "./index-health.js";
import type { RepoIndexBuildOptions, RepoIndexSearchResult } from "./repo-index.js";
import { buildRepoNativePack, type RepoNativePack } from "./repo-native-pack.js";
import type { RuntimeRecommendedTool } from "./runtime-behavior-audit.js";
import { TOOL_REGISTRY } from "./tool-registry.js";
import { getToolProfile, type ToolCapabilityProfile, type ToolProfileId } from "./tool-profiles.js";
import { reviewToolPromotion, type ToolPromotionReview } from "./tool-promotion.js";

export type AgentRoute = "fast" | "balanced" | "deep";

export type AgentToolCall = {
  toolName: string;
  reason: string;
  priority: number;
  missingInput?: string[];
  input: Record<string, unknown> & {
    repoRoot?: string;
    objective?: string;
    query?: string;
    changedFiles?: string[];
    maxChars?: number;
  };
};

export type ProjectIntelligenceSnapshot = {
  repoRoot: string;
  generatedAt: string;
  summary: {
    recommendedPath: AgentRoute;
    moduleCount: number;
    entrypointCount: number;
    changedFileCount: number;
    riskLevel: "low" | "medium" | "high";
  };
  indexHealth: IndexHealthSnapshot;
  orientation: {
    topModules: ArchitectureMap["modules"];
    topEntrypoints: EntrypointFlowDiscovery["entrypoints"];
  };
  blastRadius?: BlastRadiusAnalysis;
  toolSequence: AgentToolCall[];
};

export type NextBestToolRecommendation = {
  recommended: AgentToolCall;
  alternatives: AgentToolCall[];
  remainingSequence: AgentToolCall[];
};

export type MissionRouteStage = {
  name: "orient" | "impact" | "context" | "verify" | "gate";
  purpose: string;
  toolCalls: AgentToolCall[];
};

export type StateMaintenanceAdvice = {
  coordinator: {
    toolName: "state_maintenance_run";
    purpose: string;
    useWhen: string[];
  };
  discovery: {
    firstTools: string[];
    purpose: string;
  };
  graph: {
    ownerTools: string[];
    refreshWhen: string[];
  };
  context: {
    ownerTools: string[];
    refreshWhen: string[];
  };
  workspace: {
    ownerTools: string[];
    useWhen: string[];
  };
};

export type AgentDurableRetrieval = {
  usedSqlite: boolean;
  retrievalMode?: string;
  results: RepoIndexSearchResult[];
  warnings: string[];
  indexHealth: IndexHealthSnapshot;
};

export type MissionRouteRecommendation = {
  repoRoot: string;
  objective: string;
  route: AgentRoute;
  stages: MissionRouteStage[];
  stateMaintenance: StateMaintenanceAdvice;
  stopRule: string;
};

export type PreparedAgentContext = {
  repoRoot: string;
  objective: string;
  snapshot: ProjectIntelligenceSnapshot;
  route: MissionRouteRecommendation;
  contextPack: ProjectContextPack;
  indexHealth: IndexHealthSnapshot;
  nextToolCalls: AgentToolCall[];
  recommendedDiscovery: AgentToolCall[];
  stateMaintenance: StateMaintenanceAdvice;
  durableRetrieval?: AgentDurableRetrieval;
  toolProfile?: ToolCapabilityProfile;
  toolPromotion?: ToolPromotionReview;
  agentInstructions: string;
};

export type AgentRoutingInput = {
  repoRoot: string;
  objective?: string;
  query?: string;
  changedFiles?: string[];
  diffText?: string;
  completedTools?: string[];
  maxChars?: number;
  indexOptions?: Omit<RepoIndexBuildOptions, "repoRoot">;
  preferredSources?: string[];
  toolProfileId?: ToolProfileId;
  durableRetrieval?: AgentDurableRetrieval;
  repoNativePack?: RepoNativePack;
  projectModelCache?: ProjectModelCache;
  projectIntelligenceSnapshot?: ProjectIntelligenceSnapshot;
};

const DEFAULT_CONTEXT_CHARS = 6_000;
const RUNTIME_BEHAVIOR_REQUIRED_TOOLS = ["record_evidence", "verification_run", "gate_request"] as const;
const RUNTIME_BEHAVIOR_IGNORED_TOOL_NAMES = [
  "agent_context_prepare",
  "app_process_compile",
  "app_process_status",
  "app_process_validate",
  "app_process_write_artifacts",
  "ctx_pack_refresh",
  "durable_index_manifest_status",
  "durable_index_status",
  "durable_repo_index_query",
  "durable_repo_index_refresh",
  "mission_route",
  "mission_start",
  "next_best_tool",
  "project_intelligence_snapshot",
  "resume_checkpoint",
  "resume_load",
  "resume_record",
  "resume_validate",
  "round_start",
  "source_conflicts_analyze",
  "state_maintenance_run",
  "tool_catalog_query",
  "tool_layer_map",
  "workflow_start_feature",
  "workflow_write_artifacts",
] as const;

export function createProjectIntelligenceSnapshot(
  input: AgentRoutingInput,
): ProjectIntelligenceSnapshot {
  const changedFiles = normalizeChangedFiles(input.changedFiles);
  const architecture = createArchitectureMap({
    repoRoot: input.repoRoot,
    projectModelCache: input.projectModelCache,
    indexOptions: input.indexOptions,
  });
  const entrypoints = discoverEntrypointFlows({
    repoRoot: input.repoRoot,
    projectModelCache: input.projectModelCache,
    indexOptions: input.indexOptions,
  });
  const blastRadius =
    changedFiles.length > 0
      ? analyzeBlastRadius({
          repoRoot: input.repoRoot,
          changedFiles,
          diffText: input.diffText,
          projectModelCache: input.projectModelCache,
          indexOptions: input.indexOptions,
        })
      : undefined;
  const route = routeFor({
    moduleCount: architecture.summary.moduleCount,
    changedFileCount: changedFiles.length,
    riskLevel: blastRadius?.verification.riskLevel ?? "low",
  });

  return {
    repoRoot: input.repoRoot,
    generatedAt: new Date().toISOString(),
    summary: {
      recommendedPath: route,
      moduleCount: architecture.summary.moduleCount,
      entrypointCount: entrypoints.entrypoints.length,
      changedFileCount: changedFiles.length,
      riskLevel: blastRadius?.verification.riskLevel ?? "low",
    },
    indexHealth: architecture.indexHealth,
    orientation: {
      topModules: rankModules(architecture).slice(0, 8),
      topEntrypoints: entrypoints.entrypoints.slice(0, 8),
    },
    blastRadius,
    toolSequence: createDefaultToolSequence({
      repoRoot: input.repoRoot,
      objective: input.objective ?? "Understand and safely work in this project.",
      query: input.query ?? input.objective ?? "project architecture entrypoints tests",
      changedFiles,
      maxChars: input.maxChars ?? DEFAULT_CONTEXT_CHARS,
    }),
  };
}

export function recommendNextBestTool(input: AgentRoutingInput): NextBestToolRecommendation {
  const sequence = createDefaultToolSequence({
    repoRoot: input.repoRoot,
    objective: input.objective ?? "Safely complete the requested coding task.",
    query: input.query ?? input.objective ?? "project architecture entrypoints tests",
    changedFiles: normalizeChangedFiles(input.changedFiles),
    maxChars: input.maxChars ?? DEFAULT_CONTEXT_CHARS,
  });
  const completed = new Set(input.completedTools ?? []);
  const remaining = sequence.filter((call) => !completed.has(call.toolName));
  const recommended = remaining[0] ?? toolCall("mission_status", 90, "Inspect current Wormhole mission status.", {});
  return {
    recommended,
    alternatives: alternativesFor(recommended, input),
    remainingSequence: remaining,
  };
}

export function recommendMissionRoute(input: AgentRoutingInput): MissionRouteRecommendation {
  const snapshot = input.projectIntelligenceSnapshot ?? createProjectIntelligenceSnapshot(input);
  const changedFiles = normalizeChangedFiles(input.changedFiles);
  const objective = input.objective ?? "Safely complete the requested coding task.";
  return {
    repoRoot: input.repoRoot,
    objective,
    route: snapshot.summary.recommendedPath,
    stages: [
      {
        name: "orient",
        purpose: "Build the repo-level map before broad file reads.",
        toolCalls: [
          toolCall("project_onboard", 100, "Collect initial project contract, index, safety, dependency, and policy signals.", {
            repoRoot: input.repoRoot,
            changedFiles,
          }),
          toolCall("architecture_map", 95, "Summarize modules, ownership, dependencies, and evidence.", {
            repoRoot: input.repoRoot,
          }),
          toolCall("entrypoint_flow_discover", 90, "Find user-facing and operational entrypoints.", {
            repoRoot: input.repoRoot,
          }),
          ...(isReachabilityObjective(objective)
            ? [
                toolCall(
                  "repo_reachability_analyze",
                  88,
                  "Run read-only repo-wide reachability evidence collection before deletion recommendations.",
                  {
                    repoRoot: input.repoRoot,
                  },
                ),
              ]
            : []),
        ],
      },
      {
        name: "impact",
        purpose: "Constrain the affected surface before editing.",
        toolCalls: [
          toolCall("blast_radius_analyze", 100, "Find impacted files, modules, entrypoints, and likely tests.", {
            repoRoot: input.repoRoot,
            changedFiles,
            diffText: input.diffText,
          }),
          toolCall("test_impact_analyze_v2", 85, "Map changed hunks and symbols to focused tests.", {
            repoRoot: input.repoRoot,
            changedFiles,
            diffText: input.diffText,
          }),
        ],
      },
      {
        name: "context",
        purpose: "Prepare a small source-backed context pack for the agent.",
        toolCalls: [
          toolCall("context_pack_generate", 100, "Render a bounded task context pack from native project intelligence.", {
            repoRoot: input.repoRoot,
            objective,
            query: input.query ?? objective,
            changedFiles,
            maxChars: input.maxChars ?? DEFAULT_CONTEXT_CHARS,
          }),
        ],
      },
      {
        name: "verify",
        purpose: "Select and run focused verification before claiming success.",
        toolCalls: [
          toolCall("test_plan_select", 90, "Select focused verification from project contract and impact.", {
            repoRoot: input.repoRoot,
            changedFiles,
          }),
          toolCall(
            "verification_run",
            80,
            "Run the selected verification commands and preserve evidence hashes.",
            {},
            ["commands from test_plan_select"],
          ),
        ],
      },
      {
        name: "gate",
        purpose: "Record evidence and ask the Wormhole gate before the final response.",
        toolCalls: [
          toolCall("record_evidence", 90, "Record source-backed findings before recommendations.", {}, [
            "missionId",
            "source evidence fields",
          ]),
          toolCall("gate_request", 85, "Check whether evidence and open-question requirements are satisfied.", {}, [
            "missionId",
          ]),
        ],
      },
    ],
    stateMaintenance: createStateMaintenanceAdvice(),
    stopRule: "Stop after the gate closes, verification fails, or a blocking question lacks an assumption fallback.",
  };
}

export function prepareAgentContext(input: Required<Pick<AgentRoutingInput, "repoRoot" | "objective" | "query">> & AgentRoutingInput): PreparedAgentContext {
  const changedFiles = normalizeChangedFiles(input.changedFiles);
  const projectModelCache = input.projectModelCache ?? createProjectModelCache();
  const cachedInput = { ...input, projectModelCache };
  const snapshot = createProjectIntelligenceSnapshot(cachedInput);
  const route = recommendMissionRoute({ ...cachedInput, projectIntelligenceSnapshot: snapshot });
  const repoNativePack = input.repoNativePack ?? buildRepoNativePack({
    repoRoot: input.repoRoot,
    objective: input.objective,
    query: input.query,
    changedFiles,
    diffText: input.diffText,
  });
  const repoNativeSources = uniqueSorted(
    repoNativePack.featureSlices.flatMap((slice) => [
      ...slice.keyFiles,
      ...slice.routes,
      ...slice.hooks,
      ...slice.schemaFiles,
      ...slice.tests,
    ]),
  );
  const preferredSources = uniqueSorted([
    ...(input.preferredSources ?? []),
    ...repoNativeSources,
  ]);
  const contextPack = generateProjectContextPack({
    repoRoot: input.repoRoot,
    objective: input.objective,
    query: input.query,
    changedFiles,
    maxChars: input.maxChars ?? DEFAULT_CONTEXT_CHARS,
    projectModelCache,
    indexOptions: input.indexOptions,
    preferredSources,
  });
  const effectiveIndexHealth = selectPreparedIndexHealth(contextPack.indexHealth, input.durableRetrieval?.indexHealth);
  const effectiveContextPack = {
    ...contextPack,
    indexHealth: effectiveIndexHealth,
  };
  const languageCoverageSummaries = (effectiveContextPack.indexHealth.languageCoverage ?? []).map(
    (coverage) => `${coverage.displayName} ${coverage.indexedFileCount}/${coverage.totalFileCount} indexed`,
  );
  const languageCoverageReasons = (effectiveContextPack.indexHealth.languageCoverage ?? []).flatMap(
    (coverage) => coverage.reasons,
  );
  const instructionParts = [
    "Start with tool_layer_map before browsing the full MCP surface.",
    "Use this context pack before broad file reads.",
    ...(languageCoverageSummaries.length > 0
      ? [`Language profile: ${languageCoverageSummaries.join("; ")}.`]
      : []),
    ...(languageCoverageReasons.length > 0
      ? [`Language coverage gaps: ${languageCoverageReasons.join(" ")}`]
      : []),
    "Use tool_catalog_query when the route recommends a plane, phase, pack, risk, or exact tool name.",
    "Use tool_search and tool_promote to keep the active tool set small before selecting lower-level tools.",
    "Prefer the recommended route over browsing the full MCP tool surface.",
    "Refresh graph and context state only through the stateMaintenance owner tools.",
    "Use durable_repo_index_query, ctx_pack_refresh, workflow_write_artifacts, resume_record, resume_checkpoint, resume_validate, and resume_load for durable handoff and resume paths.",
    "Use resume_record for material session decisions, owner approvals, blockers, verification results, tool errors, exact next actions, final responses, and fresh-session recommendations.",
    "Use resume_checkpoint before fresh-chat handoff, final output, or any context-heavy transition; use resume_validate before claiming a session is safely resumable.",
    "Refresh index state before trusting degraded or stale context.",
    ...(input.durableRetrieval ? ["A durable repo index retrieval seeded this context pack."] : []),
    ...(repoNativePack.featureSlices.length > 0 ? ["Repo-native feature slices seeded this context pack."] : []),
    "Continue into implementation and verification for coding tasks.",
    "Record source-backed evidence before making implementation claims.",
    "Run focused verification before requesting the gate.",
    "Run gate_request after verification_run and record_evidence.",
    "Enforce resume validity (enforceResume) at the final gate; checkpoint before claiming the session is resumable.",
    "Run runtime_behavior_audit before final claims when observed tool calls are available.",
    "Call emit_plan only when the user explicitly asks for a plan, spec, design, or planning-only artifact.",
  ];
  const finalNextToolCalls = [
    toolCall("record_evidence", 90, "Record the context pack and key source files as evidence.", {}, [
      "missionId",
      "source evidence fields",
    ]),
    toolCall("test_plan_select", 85, "Select focused verification for the changed files.", {
      repoRoot: input.repoRoot,
      changedFiles,
    }),
    toolCall("gate_request", 80, "Request the Wormhole gate before the final response.", { enforceResume: true }, [
      "missionId",
    ]),
  ];
  const runtimeAuditToolCall = createRuntimeBehaviorAuditToolCall(route, finalNextToolCalls);
  const toolProfile = input.toolProfileId ? getToolProfile(input.toolProfileId) : undefined;
  const toolPromotion = reviewToolPromotion({
    ...(input.toolProfileId ? { profileId: input.toolProfileId } : {}),
    objective: input.objective,
    query: input.query,
    toolNames: uniqueSorted([
      "agent_context_prepare",
      "mission_route",
      "tool_search",
      "tool_promote",
      ...route.stages.flatMap((stage) => stage.toolCalls.map((call) => call.toolName)),
      ...finalNextToolCalls.map((call) => call.toolName),
    ]),
    maxPromotedTools: 24,
    allowOutOfProfile: true,
    overrideReason: "Prepared context wraps route-scoped tool guidance without hiding tools outside the selected profile.",
    registry: TOOL_REGISTRY,
  });
  if (toolProfile) {
    instructionParts.push(`Selected tool profile: ${toolProfile.profileId}.`);
  }
  return {
    repoRoot: input.repoRoot,
    objective: input.objective,
    snapshot,
    route,
    contextPack: effectiveContextPack,
    indexHealth: effectiveIndexHealth,
    recommendedDiscovery: createDiscoveryToolCalls(),
    stateMaintenance: createStateMaintenanceAdvice(),
    ...(input.durableRetrieval ? { durableRetrieval: input.durableRetrieval } : {}),
    ...(toolProfile ? { toolProfile } : {}),
    toolPromotion,
    nextToolCalls: [...finalNextToolCalls, runtimeAuditToolCall],
    agentInstructions: instructionParts.join(" "),
  };
}

function createDiscoveryToolCalls(): AgentToolCall[] {
  return [
    toolCall("tool_layer_map", 100, "Inspect the layered tool map before scanning the full MCP surface.", {}),
    toolCall(
      "tool_catalog_query",
      95,
      "Query the registry by structured filters once the route identifies a plane, phase, pack, risk, or exact tool.",
      {
        pack: "core",
      },
    ),
  ];
}

function createStateMaintenanceAdvice(): StateMaintenanceAdvice {
  return {
    coordinator: {
      toolName: "state_maintenance_run",
      purpose: "Run graph, context, evidence, route, and shared-workspace maintenance as one audited tool call.",
      useWhen: [
        "repo changes need graph and context refresh together",
        "watch scans detect changed files",
        "parallel workers need shared maintenance state",
      ],
    },
    discovery: {
      firstTools: ["tool_layer_map", "tool_catalog_query", "next_best_tool"],
      purpose: "Use the registry layer to choose a narrow tool pack before lower-level MCP calls.",
    },
    graph: {
      ownerTools: ["durable_repo_index_refresh", "repo_graph_refresh_incremental", "durable_index_status"],
      refreshWhen: ["repo changes are known", "watch sessions detect changed files", "index status is stale or degraded"],
    },
    context: {
      ownerTools: ["ctx_pack_budget_review", "ctx_pack_refresh", "context_pack_generate"],
      refreshWhen: ["context pack exceeds budget", "pinned or stale records change", "changed files shift the task scope"],
    },
    workspace: {
      ownerTools: ["agent_workspace_create", "agent_workspace_write", "agent_workspace_read", "agent_workspace_merge"],
      useWhen: ["multiple agents share findings", "parallel workers can conflict", "handoffs need attributed state"],
    },
  };
}

function createRuntimeBehaviorAuditToolCall(
  route: MissionRouteRecommendation,
  nextToolCalls: AgentToolCall[],
): AgentToolCall {
  const input: AgentToolCall["input"] = {
    recommendedTools: createRuntimeRecommendedTools(route, nextToolCalls),
    requiredTools: [...RUNTIME_BEHAVIOR_REQUIRED_TOOLS],
    ignoredToolNames: [...RUNTIME_BEHAVIOR_IGNORED_TOOL_NAMES],
    knownToolNames: TOOL_REGISTRY.map((tool) => tool.name),
    scope: "wormhole",
  };
  return toolCall(
    "runtime_behavior_audit",
    70,
    "Compare the recommended Wormhole route against observed tool calls before final claims.",
    input,
    ["observedToolCalls"],
  );
}

function createRuntimeRecommendedTools(
  route: MissionRouteRecommendation,
  nextToolCalls: AgentToolCall[],
): RuntimeRecommendedTool[] {
  const recommendationsByName = new Map<string, RuntimeRecommendedTool>();
  const addRecommendation = (call: AgentToolCall, phase: MissionRouteStage["name"] | "gate") => {
    if (call.toolName === "runtime_behavior_audit") {
      return;
    }
    const existing = recommendationsByName.get(call.toolName);
    const required = RUNTIME_BEHAVIOR_REQUIRED_TOOLS.includes(
      call.toolName as (typeof RUNTIME_BEHAVIOR_REQUIRED_TOOLS)[number],
    );
    const recommendation: RuntimeRecommendedTool = {
      ...(existing ?? {}),
      toolName: call.toolName,
      phase: existing?.phase ?? phase,
      priority: Math.max(existing?.priority ?? 0, call.priority),
      required: existing?.required === true || required,
      reason: existing?.reason ?? call.reason,
      ...(call.toolName === "gate_request" ? { after: ["record_evidence", "verification_run"] } : {}),
    };
    recommendationsByName.set(call.toolName, recommendation);
  };

  for (const stage of route.stages) {
    for (const call of stage.toolCalls) {
      addRecommendation(call, stage.name);
    }
  }
  for (const call of nextToolCalls) {
    addRecommendation(call, call.toolName === "gate_request" ? "gate" : "verify");
  }
  return [...recommendationsByName.values()];
}

function selectPreparedIndexHealth(
  contextHealth: IndexHealthSnapshot,
  durableHealth: IndexHealthSnapshot | undefined,
): IndexHealthSnapshot {
  if (!durableHealth) {
    return contextHealth;
  }
  const durableFileCount = durableHealth.fileCount ?? 0;
  const contextFileCount = contextHealth.fileCount ?? 0;
  if (durableHealth.status === "fresh" && durableFileCount >= contextFileCount) {
    return durableHealth;
  }
  if (contextHealth.status === "degraded" && durableFileCount > contextFileCount) {
    return durableHealth;
  }
  return contextHealth;
}

function createDefaultToolSequence(input: {
  repoRoot: string;
  objective: string;
  query: string;
  changedFiles: string[];
  maxChars: number;
}): AgentToolCall[] {
  return [
    toolCall("project_onboard", 100, "Collect initial project intelligence and safety signals.", {
      repoRoot: input.repoRoot,
      changedFiles: input.changedFiles,
    }),
    toolCall("architecture_map", 95, "Map modules, owners, and dependencies before reading widely.", {
      repoRoot: input.repoRoot,
    }),
    toolCall("entrypoint_flow_discover", 90, "Find API, CLI, worker, and script entrypoints.", {
      repoRoot: input.repoRoot,
    }),
    ...(isReachabilityObjective(input.objective)
      ? [
          toolCall(
            "repo_reachability_analyze",
            89,
            "Run read-only reachability review before stale-code or deletion recommendations.",
            {
              repoRoot: input.repoRoot,
            },
          ),
        ]
      : []),
    ...(input.changedFiles.length > 0
      ? [
          toolCall("blast_radius_analyze", 88, "Analyze affected files, modules, entrypoints, and likely tests.", {
            repoRoot: input.repoRoot,
            changedFiles: input.changedFiles,
          }),
        ]
      : []),
    toolCall("context_pack_generate", 82, "Create a bounded context pack for the task.", {
      repoRoot: input.repoRoot,
      objective: input.objective,
      query: input.query,
      changedFiles: input.changedFiles,
      maxChars: input.maxChars,
    }),
    toolCall("test_plan_select", 70, "Choose focused verification commands.", {
      repoRoot: input.repoRoot,
      changedFiles: input.changedFiles,
    }),
    toolCall("verification_run", 65, "Run selected checks and preserve evidence hashes.", {}, [
      "commands from test_plan_select",
    ]),
    toolCall("gate_request", 50, "Ask the evidence gate before the final response.", { enforceResume: true }, [
      "missionId",
    ]),
  ];
}

function alternativesFor(recommended: AgentToolCall, input: AgentRoutingInput): AgentToolCall[] {
  const changedFiles = normalizeChangedFiles(input.changedFiles);
  if (recommended.toolName === "blast_radius_analyze") {
    return [
      toolCall("test_impact_analyze_v2", 80, "Use lower-level diff-to-test mapping when symbol detail matters.", {
        repoRoot: input.repoRoot,
        changedFiles,
        diffText: input.diffText,
      }),
      toolCall("repo_index_explain", 70, "Explain the changed file or symbol directly from the repo graph.", {
        repoRoot: input.repoRoot,
        target: changedFiles[0] ?? input.objective ?? "",
      }),
    ];
  }
  if (recommended.toolName === "context_pack_generate") {
    return [
      toolCall("test_impact_analyze_v2", 75, "Refresh focused test recommendations before rendering context.", {
        repoRoot: input.repoRoot,
        changedFiles,
        diffText: input.diffText,
      }),
      toolCall("repo_index_query", 70, "Query the native repo index for extra task terms.", {
        repoRoot: input.repoRoot,
        query: input.query ?? input.objective ?? "",
      }),
    ];
  }
  return [
    toolCall("repo_index_query", 60, "Use native graph search when the recommended tool is unavailable.", {
      repoRoot: input.repoRoot,
      query: input.query ?? input.objective ?? "project",
    }),
  ];
}

function rankModules(architecture: ArchitectureMap): ArchitectureMap["modules"] {
  return [...architecture.modules].sort((left, right) => {
    const leftScore = left.entrypointCount * 4 + left.dependents.length * 2 + left.fileCount;
    const rightScore = right.entrypointCount * 4 + right.dependents.length * 2 + right.fileCount;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return left.rootPath.localeCompare(right.rootPath);
  });
}

function routeFor(input: {
  moduleCount: number;
  changedFileCount: number;
  riskLevel: "low" | "medium" | "high";
}): AgentRoute {
  if (input.riskLevel === "high" || input.moduleCount > 20 || input.changedFileCount > 5) {
    return "deep";
  }
  if (input.changedFileCount > 0 || input.moduleCount > 5) {
    return "balanced";
  }
  return "fast";
}

function isReachabilityObjective(objective: string): boolean {
  return /\b(dead[- ]?code|unused|unreachable|stale files?|delete|deletion|remove stale|prune|cleanup|clean up)\b/i.test(
    objective,
  );
}

function toolCall(
  toolName: string,
  priority: number,
  reason: string,
  input: AgentToolCall["input"],
  missingInput?: string[],
): AgentToolCall {
  return { toolName, priority, reason, input, missingInput };
}

function normalizeChangedFiles(changedFiles: string[] | undefined): string[] {
  return [...new Set((changedFiles ?? []).map((file) => file.replace(/\\/g, "/").replace(/^\.\//, "")))]
    .sort((left, right) => left.localeCompare(right));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}
