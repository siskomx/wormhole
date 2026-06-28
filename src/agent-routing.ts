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
  projectModelCache?: ProjectModelCache;
  projectIntelligenceSnapshot?: ProjectIntelligenceSnapshot;
};

const DEFAULT_CONTEXT_CHARS = 6_000;

export function createProjectIntelligenceSnapshot(
  input: AgentRoutingInput,
): ProjectIntelligenceSnapshot {
  const changedFiles = normalizeChangedFiles(input.changedFiles);
  const architecture = createArchitectureMap({
    repoRoot: input.repoRoot,
    projectModelCache: input.projectModelCache,
  });
  const entrypoints = discoverEntrypointFlows({
    repoRoot: input.repoRoot,
    projectModelCache: input.projectModelCache,
  });
  const blastRadius =
    changedFiles.length > 0
      ? analyzeBlastRadius({
          repoRoot: input.repoRoot,
          changedFiles,
          diffText: input.diffText,
          projectModelCache: input.projectModelCache,
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
  const contextPack = generateProjectContextPack({
    repoRoot: input.repoRoot,
    objective: input.objective,
    query: input.query,
    changedFiles,
    maxChars: input.maxChars ?? DEFAULT_CONTEXT_CHARS,
    projectModelCache,
  });
  return {
    repoRoot: input.repoRoot,
    objective: input.objective,
    snapshot,
    route,
    contextPack,
    indexHealth: contextPack.indexHealth,
    recommendedDiscovery: createDiscoveryToolCalls(),
    stateMaintenance: createStateMaintenanceAdvice(),
    nextToolCalls: [
      toolCall("record_evidence", 90, "Record the context pack and key source files as evidence.", {}, [
        "missionId",
        "source evidence fields",
      ]),
      toolCall("test_plan_select", 85, "Select focused verification for the changed files.", {
        repoRoot: input.repoRoot,
        changedFiles,
      }),
      toolCall("gate_request", 80, "Request the Wormhole gate before the final response.", {}, [
        "missionId",
      ]),
    ],
    agentInstructions: [
      "Start with tool_layer_map before browsing the full MCP surface.",
      "Use this context pack before broad file reads.",
      "Use tool_catalog_query when the route recommends a plane, phase, pack, risk, or exact tool name.",
      "Prefer the recommended route over browsing the full MCP tool surface.",
      "Refresh graph and context state only through the stateMaintenance owner tools.",
      "Use durable_repo_index_query, ctx_pack_refresh, and workflow_write_artifacts for durable handoff and resume paths.",
      "Refresh index state before trusting degraded or stale context.",
      "Continue into implementation and verification for coding tasks.",
      "Record source-backed evidence before making implementation claims.",
      "Run focused verification before requesting the gate.",
      "Call emit_plan only when the user explicitly asks for a plan, spec, design, or planning-only artifact.",
    ].join(" "),
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
    toolCall("gate_request", 50, "Ask the evidence gate before the final response.", {}, [
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
