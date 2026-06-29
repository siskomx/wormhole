import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WormholeKernel } from "./kernel.js";
import { createToolHandlers, type ToolHandlerOptions } from "./tools.js";
import {
  TOOL_EXPOSURE_MODES,
  TOOL_PACKS,
  TOOL_PHASES,
  TOOL_PLANES,
  TOOL_RISKS,
} from "./tool-registry.js";
import { PROJECT_LANES } from "./project-lanes.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

function jsonResult(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function createWormholeMcpServer(
  kernel: WormholeKernel,
  options: ToolHandlerOptions = {},
): McpServer {
  const server = new McpServer({
    name: "wormhole",
    version: "0.11.0",
  });
  const tools = createToolHandlers(kernel, options);
  const taskStatusSchema = z.enum([
    "registered",
    "running",
    "blocked",
    "needs_input",
    "paused",
    "interrupted",
    "completed",
    "failed",
  ]);
  const artifactTypeSchema = z.enum([
    "plan",
    "json_report",
    "html_workbench",
    "patch_plan",
    "benchmark_report",
  ]);
  const agentDescriptorSchema = {
    agentId: z.string(),
    displayName: z.string(),
    target: z.string(),
    transport: z.enum(["mcp-stdio", "mcp-http", "http", "cli", "sdk", "provider-api"]),
    capabilities: z.array(z.string()),
    installation: z.enum(["available", "installed", "disabled"]),
    authentication: z.enum(["on_install", "on_use", "none"]),
    maxConcurrentTasks: z.number(),
    supportsInterrupt: z.boolean(),
    runtime: z
      .object({
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        endpoint: z.string().optional(),
        method: z.enum(["POST", "PUT", "PATCH"]).optional(),
        timeoutMs: z.number().optional(),
      })
      .optional(),
  };
  const printingPressCliSchema = {
    cliId: z.string(),
    displayName: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    capabilities: z.array(z.string()),
    installation: z.enum(["available", "installed", "disabled"]),
    authentication: z.enum(["on_install", "on_use", "none"]),
    evidenceMode: z.enum(["compact", "raw", "sqlite"]),
    providesMcpServer: z.boolean(),
    supportsInterrupt: z.boolean(),
    maxConcurrentTasks: z.number(),
    skillName: z.string().optional(),
    category: z.string().optional(),
  };
  const modelProfileSchema = {
    profileId: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    strengths: z.array(z.string()),
    modes: z.array(z.enum(["fast", "balanced", "deep", "ultra"])),
    costTier: z.enum(["low", "medium", "high"]),
    latencyTier: z.enum(["low", "medium", "high"]),
    privacy: z.enum(["local", "external"]),
    contextWindow: z.number(),
  };
  const optimizationKindSchema = z.enum([
    "command_output_compaction",
    "context_compression",
    "dense_summary",
    "minimality_review",
    "json_compaction",
  ]);
  const diagnosticSeveritySchema = z.enum(["error", "warning", "info", "hint"]);
  const diagnosticRecordSchema = z.object({
    diagnosticId: z.string(),
    source: z.string(),
    severity: diagnosticSeveritySchema,
    message: z.string(),
    file: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
    code: z.string().optional(),
    recordedAt: z.string(),
  });
  const verificationCommandSchema = z.object({
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    timeoutMs: z.number().optional(),
    stdin: z.string().optional(),
    reason: z.string().optional(),
    tier: z.enum(["smoke", "focused", "standard", "full"]).optional(),
    lanes: z.array(z.enum(["runtime", "tests", "fixtures", "benchmarks", "docs", "generated"])).optional(),
    source: z.enum(["contract", "impact", "fallback"]).optional(),
  });
  const diffScopeEvidenceSchema = z.object({
    evidenceId: z.string().optional(),
    sourcePath: z.string().optional(),
    summary: z.string(),
  });
  const patchScopeReviewSchema = z.object({
    objective: z.string(),
    evidence: z.array(diffScopeEvidenceSchema).optional(),
    approvedPaths: z.array(z.string()).optional(),
    strict: z.boolean().optional(),
  });
  const coverageSummarySchema = z.object({
    lines: z.number().optional(),
    branches: z.number().optional(),
    functions: z.number().optional(),
    statements: z.number().optional(),
  });
  const semanticRecordSchema = z.object({
    id: z.string(),
    path: z.string().optional(),
    text: z.string(),
  });
  const semanticIndexSchema = z.object({
    indexId: z.string(),
    provider: z.literal("deterministic-token-overlap"),
    records: z.array(
      semanticRecordSchema.extend({
        tokens: z.array(z.string()),
      }),
    ),
  });
  const lspLocationSchema = z.object({
    uri: z.string(),
    range: z.object({
      start: z.object({
        line: z.number(),
        character: z.number(),
      }),
      end: z.object({
        line: z.number(),
        character: z.number(),
      }),
    }),
  });
  const actionPolicyOperationSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("command"),
      command: z.string(),
      args: z.array(z.string()).optional(),
    }),
    z.object({
      kind: z.literal("file_write"),
      path: z.string(),
    }),
    z.object({
      kind: z.literal("file_delete"),
      path: z.string(),
    }),
    z.object({
      kind: z.literal("tool_write"),
      targetDir: z.string(),
    }),
    z.object({
      kind: z.literal("network"),
      url: z.string(),
      method: z.string().optional(),
    }),
  ]);
  const patchVerificationCommandSchema = z.object({
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    reason: z.string().optional(),
  });
  const optimizationAdapterSchema = z.object({
    adapterId: z.string(),
    transport: z.enum(["native", "cli", "http"]),
    capabilities: z.array(optimizationKindSchema),
    installation: z.enum(["installed", "available", "disabled"]),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    endpoint: z.string().optional(),
  });
  const agentKnownGoodBaselineSchema = z.object({
    typicalToolInventory: z.array(z.string()).optional(),
    typicalChannelsUsed: z.array(z.string()).optional(),
    typicalOutboundDestinations: z.array(z.string()).optional(),
    typicalFilePathsAccessed: z.array(z.string()).optional(),
  });
  const agentRemitSchema = z.object({
    workerName: z.string(),
    mission: z.string(),
    owner: z.string().optional(),
    version: z.string().optional(),
    updatedBy: z.string().optional(),
    allowedCapabilities: z.array(z.string()).optional(),
    restrictedCapabilities: z.array(z.string()).optional(),
    forbiddenCapabilities: z.array(z.string()).optional(),
    approvedChannels: z.array(z.string()).optional(),
    authorizedCounterparties: z.array(z.string()).optional(),
    allowedDataSources: z.array(z.string()).optional(),
    allowedOutboundDestinations: z.array(z.string()).optional(),
    approvalRequiredActions: z.array(z.string()).optional(),
    neverAllowedActions: z.array(z.string()).optional(),
    escalationRules: z
      .object({
        halt: z.array(z.string()).optional(),
        alert: z.array(z.string()).optional(),
        logOnly: z.array(z.string()).optional(),
      })
      .optional(),
    knownGoodBaseline: agentKnownGoodBaselineSchema.optional(),
  });
  const agentActionObservationSchema = z.object({
    action: z.string(),
    approvalObserved: z.boolean().optional(),
    source: z.string().optional(),
    line: z.number().optional(),
    summary: z.string().optional(),
  });
  const agentPromptObservationSchema = z.object({
    path: z.string(),
    sessionLoaded: z.boolean().optional(),
    writable: z.boolean().optional(),
    grantsCapabilities: z.array(z.string()).optional(),
  });
  const agentLogObservationSchema = z.object({
    path: z.string(),
    kind: z.string(),
  });
  const agentCapabilityInventorySchema = z.object({
    agentId: z.string(),
    repoRoot: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    channels: z.array(z.string()).optional(),
    counterparties: z.array(z.string()).optional(),
    dataSources: z.array(z.string()).optional(),
    outboundDestinations: z.array(z.string()).optional(),
    mcpServers: z.array(z.string()).optional(),
    actions: z.array(agentActionObservationSchema).optional(),
    prompts: z.array(agentPromptObservationSchema).optional(),
    logs: z.array(agentLogObservationSchema).optional(),
  });
  const missionDeltaEvidenceSchema = z.object({
    evidenceId: z.string(),
    sourceType: z.enum(["file", "command_output", "user_input", "derived_note"]),
    sourcePath: z.string().optional(),
    summary: z.string(),
    recordedAt: z.string().optional(),
  });
  const contextPackBudgetReviewSchema = {
    objective: z.string(),
    query: z.string(),
    maxChars: z.number(),
    recordIds: z.array(z.string()).optional(),
    pinnedRecordIds: z.array(z.string()).optional(),
    staleRecordIds: z.array(z.string()).optional(),
    changedFiles: z.array(z.string()).optional(),
  };
  const lspDiagnosticSchema = z.object({
    range: z.object({
      start: z.object({ line: z.number(), character: z.number() }),
      end: z.object({ line: z.number(), character: z.number() }).optional(),
    }),
    severity: z.number().optional(),
    code: z.union([z.string(), z.number()]).optional(),
    source: z.string().optional(),
    message: z.string(),
  });
  const agentWorkspaceProvenanceSchema = z.object({
    sourceTool: z.string().optional(),
    evidenceIds: z.array(z.string()).optional(),
    artifactIds: z.array(z.string()).optional(),
  });
  const repoWatchOptionsSchema = {
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    autoRecord: z.boolean().optional(),
    autoRefreshGraph: z.boolean().optional(),
  };
  const repoActivityKindSchema = z.enum([
    "watch_started",
    "file_changed",
    "git_diff_detected",
    "command_run",
    "verification",
    "graph_refreshed",
    "note",
  ]);
  const toolPlaneSchema = z.enum(TOOL_PLANES);
  const toolPhaseSchema = z.enum(TOOL_PHASES);
  const toolPackSchema = z.enum(TOOL_PACKS);
  const toolRiskSchema = z.enum(TOOL_RISKS);
  const toolExposureModeSchema = z.enum(TOOL_EXPOSURE_MODES);
  const projectLaneSchema = z.enum(PROJECT_LANES);
  const repoIndexPresetSchema = z.enum(["default", "large_repo"]);
  const domainCoverageGapKindSchema = z.enum([
    "manifest-missing",
    "feature-without-manifest",
    "feature-without-api",
    "route-without-openapi",
    "api-without-feature",
    "table-without-owner",
    "feature-table-without-migration",
    "openapi-path-missing",
    "migration-path-missing",
    "convention-path-missing",
    "memory-path-missing",
    "source-conflict",
  ]);
  const workflowKindSchema = z.enum([
    "workflow_start_feature",
    "workflow_fix_bug",
    "workflow_review_pr",
    "workflow_onboard_repo",
  ]);
  const workflowInputSchema = {
    repoRoot: z.string(),
    objective: z.string(),
    query: z.string().optional(),
    missionId: z.string().optional(),
    changedFiles: z.array(z.string()).optional(),
    diffText: z.string().optional(),
    diagnosticSource: z.string().optional(),
  };
  const repoNativePackInputSchema = {
    repoRoot: z.string(),
    objective: z.string().optional(),
    query: z.string().optional(),
    changedFiles: z.array(z.string()).optional(),
    diffText: z.string().optional(),
    limit: z.number().optional(),
  };

  server.registerTool(
    "mission_start",
    {
      description: "Start an evidence-gated coding, review, onboarding, or planning mission.",
      inputSchema: {
        objective: z.string(),
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.missionStart(input)),
  );

  server.registerTool(
    "round_start",
    {
      description: "Start a gather/reason round for a mission.",
      inputSchema: {
        missionId: z.string(),
      },
    },
    async (input) => jsonResult(tools.roundStart(input)),
  );

  server.registerTool(
    "record_evidence",
    {
      description: "Record sourced evidence for a mission.",
      inputSchema: {
        missionId: z.string(),
        sourceType: z.enum(["file", "command_output", "user_input", "derived_note"]),
        sourcePath: z.string().optional(),
        lineStart: z.number().optional(),
        lineEnd: z.number().optional(),
        retrievalMethod: z.string(),
        summary: z.string(),
        rawContent: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.recordEvidence(input)),
  );

  server.registerTool(
    "record_question",
    {
      description: "Record an open question or assumption gap.",
      inputSchema: {
        missionId: z.string(),
        question: z.string(),
        blocking: z.boolean(),
        rationale: z.string(),
        assumptionFallback: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.recordQuestion(input)),
  );

  server.registerTool(
    "update_question",
    {
      description: "Update an open question status or assumption fallback.",
      inputSchema: {
        missionId: z.string(),
        questionId: z.string(),
        blocking: z.boolean().optional(),
        rationale: z.string().optional(),
        assumptionFallback: z.string().optional(),
        status: z.enum(["open", "answered", "accepted_as_assumption", "deferred"]).optional(),
      },
    },
    async (input) => jsonResult(tools.updateQuestion(input)),
  );

  server.registerTool(
    "task_register",
    {
      description: "Register an active sub-orchestrator or worker task.",
      inputSchema: {
        missionId: z.string(),
        parentTaskId: z.string().optional(),
        layer: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        name: z.string(),
        objective: z.string(),
        assignedTo: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.taskRegister(input)),
  );

  server.registerTool(
    "task_status_report",
    {
      description: "Report heartbeat, status, current flow, and touched paths for an active task.",
      inputSchema: {
        missionId: z.string(),
        taskId: z.string(),
        status: taskStatusSchema,
        currentFlow: z.string().optional(),
        summary: z.string(),
        touchedPaths: z.array(z.string()).optional(),
      },
    },
    async (input) => jsonResult(tools.taskStatusReport(input)),
  );

  server.registerTool(
    "control_message",
    {
      description: "Send a query, advisory note, direction change, or interrupt to an active task.",
      inputSchema: {
        missionId: z.string(),
        targetTaskId: z.string(),
        mode: z.enum(["query", "advisory", "direction_change", "interrupt"]),
        content: z.string(),
        sender: z.string(),
        ackRequired: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.controlMessage(input)),
  );

  server.registerTool(
    "control_ack",
    {
      description: "Acknowledge a control message and optionally include the revised local plan.",
      inputSchema: {
        missionId: z.string(),
        taskId: z.string(),
        messageId: z.string(),
        acknowledgedBy: z.string(),
        response: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.controlAck(input)),
  );

  server.registerTool(
    "task_inbox",
    {
      description: "List pending or acknowledged control messages for a task.",
      inputSchema: {
        missionId: z.string(),
        taskId: z.string(),
        includeAcknowledged: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.taskInbox(input)),
  );

  server.registerTool(
    "task_status",
    {
      description: "Return current task status and mailbox counts.",
      inputSchema: {
        missionId: z.string(),
        taskId: z.string(),
      },
    },
    async (input) => jsonResult(tools.taskStatus(input)),
  );

  server.registerTool(
    "gate_request",
    {
      description: "Evaluate whether the mission can produce its final response or requested artifact.",
      inputSchema: {
        missionId: z.string(),
        sourceConflicts: z.any().optional(),
        freshness: z.any().optional(),
        runtimeBehavior: z.any().optional(),
        loopHealth: z.any().optional(),
      },
    },
    async (input) => jsonResult(tools.gateRequest(input)),
  );

  server.registerTool(
    "emit_plan",
    {
      description: "Emit an evidence-cited Markdown plan only when the requested artifact is a plan, spec, or design.",
      inputSchema: {
        missionId: z.string(),
        recommendedApproach: z.string(),
        implementationSteps: z.array(z.string()),
        risks: z.array(z.string()),
        verificationPlan: z.array(z.string()),
      },
    },
    async (input) => jsonResult(tools.emitPlan(input)),
  );

  server.registerTool(
    "mission_status",
    {
      description: "Return projected mission status.",
      inputSchema: {
        missionId: z.string(),
      },
    },
    async (input) => jsonResult(tools.missionStatus(input)),
  );

  server.registerTool(
    "optimize_text",
    {
      description: "Run a Wormhole-native deterministic optimization primitive directly.",
      inputSchema: {
        kind: z.enum([
          "command_output_compaction",
          "context_compression",
          "dense_summary",
          "minimality_review",
        ]),
        content: z.string(),
      },
    },
    async (input) => jsonResult(tools.optimizeText(input)),
  );

  server.registerTool(
    "optimization_apply",
    {
      description: "Apply a reversible Wormhole-native optimization and store the original behind a retrieval handle.",
      inputSchema: {
        kind: z.enum([
          "auto",
          "command_output_compaction",
          "context_compression",
          "dense_summary",
          "minimality_review",
          "json_compaction",
        ]),
        content: z.string(),
        sourceId: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.optimizationApply(input)),
  );

  server.registerTool(
    "optimization_retrieve",
    {
      description: "Retrieve the original content for a reversible optimization handle.",
      inputSchema: {
        retrievalId: z.string(),
      },
    },
    async (input) => jsonResult(tools.optimizationRetrieve(input)),
  );

  server.registerTool(
    "ctx_record",
    {
      description: "Record source-backed context in the native Wormhole context store.",
      inputSchema: {
        source: z.string(),
        sourceType: z.enum(["file", "doc", "command", "user", "derived"]),
        text: z.string(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (input) => jsonResult(tools.ctxRecord(input)),
  );

  server.registerTool(
    "ctx_pack_query",
    {
      description: "Query native Wormhole context records before building an agent context pack.",
      inputSchema: {
        query: z.string(),
        limit: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.ctxPackQuery(input)),
  );

  server.registerTool(
    "ctx_pack_create",
    {
      description: "Create a budgeted native context pack with source provenance.",
      inputSchema: {
        objective: z.string(),
        query: z.string(),
        maxChars: z.number(),
        recordIds: z.array(z.string()).optional(),
      },
    },
    async (input) => jsonResult(tools.ctxPackCreate(input)),
  );

  server.registerTool(
    "ctx_pack_budget_review",
    {
      description: "Review context-pack budget pressure and return deterministic retain/evict decisions.",
      inputSchema: contextPackBudgetReviewSchema,
    },
    async (input) => jsonResult(tools.ctxPackBudgetReview(input)),
  );

  server.registerTool(
    "ctx_pack_refresh",
    {
      description: "Refresh a context pack using pinned, stale, changed-file, and budget eviction rules.",
      inputSchema: contextPackBudgetReviewSchema,
    },
    async (input) => jsonResult(tools.ctxPackRefresh(input)),
  );

  server.registerTool(
    "ctx_pack_render",
    {
      description: "Render a previously created native context pack.",
      inputSchema: {
        packId: z.string(),
      },
    },
    async (input) => jsonResult(tools.ctxPackRender(input)),
  );

  const scheduledTaskSchema = z.object({
    taskId: z.string(),
    objective: z.string(),
    layer: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    dependencies: z.array(z.string()),
    readSet: z.array(z.string()),
    writeSet: z.array(z.string()),
  });

  server.registerTool(
    "cache_evidence",
    {
      description: "Store raw evidence content in the content-addressed evidence cache.",
      inputSchema: {
        cacheRoot: z.string(),
        repoRoot: z.string().optional(),
        content: z.string(),
        mediaType: z.string(),
        source: z.string(),
      },
    },
    async (input) => jsonResult(tools.cacheEvidence(input)),
  );

  server.registerTool(
    "schedule_tasks",
    {
      description: "Create DAG execution waves while respecting dependencies and read/write locks.",
      inputSchema: {
        tasks: z.array(scheduledTaskSchema),
      },
    },
    async (input) => jsonResult(tools.scheduleTasks(input)),
  );

  const localTaskOutcomeSchema = z.object({
    taskId: z.string(),
    status: z.enum(["completed", "failed"]),
    output: z.unknown().optional(),
    error: z.string().optional(),
    spawnedTasks: z.array(scheduledTaskSchema).optional(),
  });

  server.registerTool(
    "orchestration_plan_local",
    {
      description: "Plan a local adapter-free orchestration run with depth and task-budget guardrails.",
      inputSchema: {
        missionId: z.string(),
        tasks: z.array(scheduledTaskSchema),
        maxDepth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        maxTasks: z.number(),
      },
    },
    async (input) => jsonResult(tools.orchestrationPlanLocal(input)),
  );

  server.registerTool(
    "orchestration_run_local",
    {
      description: "Execute a local adapter-free orchestration run from deterministic caller-supplied task outcomes.",
      inputSchema: {
        missionId: z.string(),
        tasks: z.array(scheduledTaskSchema),
        maxDepth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        maxTasks: z.number(),
        outcomes: z.array(localTaskOutcomeSchema),
      },
    },
    async (input) => jsonResult(await tools.orchestrationRunLocal(input)),
  );

  server.registerTool(
    "reconcile_artifacts",
    {
      description: "Merge child artifacts and surface read/write-set conflicts for parent review.",
      inputSchema: {
        proposals: z.array(
          z.object({
            artifactId: z.string(),
            taskId: z.string(),
            summary: z.string(),
            evidenceIds: z.array(z.string()),
            readSet: z.array(z.string()),
            writeSet: z.array(z.string()),
            risks: z.array(z.string()),
          }),
        ),
      },
    },
    async (input) => jsonResult(tools.reconcileArtifacts(input)),
  );

  server.registerTool(
    "route_mission",
    {
      description: "Select fast, balanced, or deep orchestration and a model from declared capabilities.",
      inputSchema: {
        taskCategory: z.string(),
        ambiguity: z.enum(["low", "medium", "high"]),
        risk: z.enum(["low", "medium", "high"]),
        repoSize: z.enum(["small", "medium", "large"]),
        requiresPrivacy: z.boolean(),
        models: z.array(
          z.object({
            providerId: z.string(),
            modelId: z.string(),
            strengths: z.array(z.string()),
            maxDepth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
            costTier: z.enum(["low", "medium", "high"]),
            privacy: z.enum(["local", "external"]),
          }),
        ),
      },
    },
    async (input) => jsonResult(tools.routeMission(input)),
  );

  server.registerTool(
    "codex_adapter_config",
    {
      description: "Generate the Codex plugin/runtime adapter config for a Wormhole repo.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.codexAdapterConfig(input)),
  );

  server.registerTool(
    "select_connector",
    {
      description: "Select a connector by target and required capabilities from a declared connector registry.",
      inputSchema: {
        connectors: z.array(
          z.object({
            connectorId: z.string(),
            target: z.string(),
            transport: z.enum([
              "mcp-stdio",
              "mcp-http",
              "plugin-manifest",
              "mcpb",
              "printing-press-cli",
              "graph-index",
              "http",
              "cli",
              "sdk",
              "agent-adapter",
              "provider-api",
              "connector-contract",
            ]),
            capabilities: z.array(z.string()),
            installation: z.enum(["available", "installed", "disabled"]),
            authentication: z.enum(["on_install", "on_use", "none"]),
          }),
        ),
        target: z.string(),
        requiredCapabilities: z.array(z.string()),
      },
    },
    async (input) => jsonResult(tools.selectConnector(input)),
  );

  server.registerTool(
    "create_artifact",
    {
      description: "Create a typed Wormhole artifact record with evidence and task provenance.",
      inputSchema: {
        missionId: z.string(),
        type: artifactTypeSchema,
        title: z.string(),
        content: z.string(),
        evidenceIds: z.array(z.string()),
        taskIds: z.array(z.string()),
      },
    },
    async (input) => jsonResult(tools.createArtifact(input)),
  );

  server.registerTool(
    "render_workbench",
    {
      description: "Render a static HTML workbench from mission, task, gate, and artifact state.",
      inputSchema: {
        mission: z.object({
          missionId: z.string(),
          objective: z.string(),
          repoRoot: z.string(),
        }),
        tasks: z.array(
          z.object({
            taskId: z.string(),
            name: z.string(),
            status: taskStatusSchema,
            currentFlow: z.string().optional(),
          }),
        ),
        gate: z
          .object({
            open: z.boolean(),
            reasons: z.array(z.string()),
          })
          .optional(),
        artifacts: z.array(
          z.object({
            artifactId: z.string(),
            type: artifactTypeSchema,
            title: z.string(),
          }),
        ),
      },
    },
    async (input) => jsonResult(tools.renderWorkbench(input)),
  );

  server.registerTool(
    "repo_index_build",
    {
      description: "Build a deterministic local repo graph for graph-first codebase search.",
      inputSchema: {
        repoRoot: z.string(),
        preset: repoIndexPresetSchema.optional(),
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        maxFiles: z.number().optional(),
        maxFileBytes: z.number().optional(),
        maxTotalBytes: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.repoIndexBuild(input)),
  );

  server.registerTool(
    "repo_index_query",
    {
      description: "Query the local repo graph before falling back to raw grep or broad file reads.",
      inputSchema: {
        repoRoot: z.string(),
        query: z.string(),
        limit: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.repoIndexQuery(input)),
  );

  server.registerTool(
    "repo_index_explain",
    {
      description: "Explain a file or symbol using indexed symbols plus inbound and outbound graph edges.",
      inputSchema: {
        repoRoot: z.string(),
        target: z.string(),
        limit: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.repoIndexExplain(input)),
  );

  server.registerTool(
    "repo_index_path",
    {
      description: "Find a dependency path between two files or symbols in the local repo graph.",
      inputSchema: {
        repoRoot: z.string(),
        from: z.string(),
        to: z.string(),
        maxDepth: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.repoIndexPath(input)),
  );

  server.registerTool(
    "repo_index_report",
    {
      description: "Render a deterministic native repo graph report from indexed files, symbols, and edges.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.repoIndexReport(input)),
  );

  server.registerTool(
    "repo_graph_analyze",
    {
      description: "Analyze the native repo graph for hubs, bridges, cycles, parser coverage, orphan symbols, disconnected files, and changed-file impact flows.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()).optional(),
        limit: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.repoGraphAnalyze(input)),
  );

  server.registerTool(
    "agent_register",
    {
      description: "Register an external AI agent or model provider as a Wormhole worker.",
      inputSchema: agentDescriptorSchema,
    },
    async (input) => jsonResult(tools.agentRegister(input)),
  );

  server.registerTool(
    "agent_list",
    {
      description: "List external AI agents and model providers registered with this Wormhole runtime.",
      inputSchema: {},
    },
    async () => jsonResult(tools.agentList()),
  );

  server.registerTool(
    "agent_dispatch",
    {
      description: "Dispatch a Wormhole task to a registered external agent by required capability.",
      inputSchema: {
        missionId: z.string(),
        taskId: z.string(),
        objective: z.string(),
        requiredCapabilities: z.array(z.string()),
        preferredTargets: z.array(z.string()).optional(),
        payload: z.unknown().optional(),
      },
    },
    async (input) => jsonResult(tools.agentDispatch(input)),
  );

  server.registerTool(
    "agent_dispatch_execute",
    {
      description: "Dispatch a Wormhole task to a CLI or HTTP external agent and execute its transport.",
      inputSchema: {
        missionId: z.string(),
        taskId: z.string(),
        objective: z.string(),
        requiredCapabilities: z.array(z.string()),
        preferredTargets: z.array(z.string()).optional(),
        payload: z.unknown().optional(),
      },
    },
    async (input) => jsonResult(await tools.agentDispatchExecute(input)),
  );

  server.registerTool(
    "agent_status",
    {
      description: "Return the current status for a dispatched external agent run.",
      inputSchema: {
        runId: z.string(),
      },
    },
    async (input) => jsonResult(tools.agentStatus(input)),
  );

  server.registerTool(
    "agent_complete",
    {
      description: "Record a completed or failed external agent run with provenance.",
      inputSchema: {
        runId: z.string(),
        status: z.enum(["completed", "failed"]),
        summary: z.string(),
        evidenceIds: z.array(z.string()).optional(),
        artifactIds: z.array(z.string()).optional(),
        output: z.unknown().optional(),
      },
    },
    async (input) => jsonResult(tools.agentComplete(input)),
  );

  server.registerTool(
    "agent_interrupt",
    {
      description: "Interrupt a dispatched external agent run when the target agent supports interrupts.",
      inputSchema: {
        runId: z.string(),
        reason: z.string(),
      },
    },
    async (input) => jsonResult(tools.agentInterrupt(input)),
  );

  server.registerTool(
    "printing_press_register",
    {
      description: "Register a Printing Press generated CLI or MCP server as an available Wormhole capability.",
      inputSchema: printingPressCliSchema,
    },
    async (input) => jsonResult(tools.printingPressRegister(input)),
  );

  server.registerTool(
    "printing_press_list",
    {
      description: "List Printing Press generated CLIs registered with this Wormhole runtime.",
      inputSchema: {},
    },
    async () => jsonResult(tools.printingPressList()),
  );

  server.registerTool(
    "printing_press_select",
    {
      description: "Select a Printing Press CLI by required capabilities.",
      inputSchema: {
        requiredCapabilities: z.array(z.string()),
        preferredCliIds: z.array(z.string()).optional(),
      },
    },
    async (input) => jsonResult(tools.printingPressSelect(input)),
  );

  server.registerTool(
    "printing_press_register_agent",
    {
      description: "Convert a registered Printing Press CLI into a Wormhole external agent worker.",
      inputSchema: {
        cliId: z.string(),
      },
    },
    async (input) => jsonResult(tools.printingPressRegisterAgent(input)),
  );

  server.registerTool(
    "printing_press_verify",
    {
      description: "Verify a registered printed CLI structurally before execution.",
      inputSchema: {
        cliId: z.string(),
      },
    },
    async (input) => jsonResult(tools.printingPressVerify(input)),
  );

  server.registerTool(
    "printing_press_run",
    {
      description: "Run a registered printed CLI and capture stdout, stderr, exit code, timeout, and evidence hash.",
      inputSchema: {
        cliId: z.string(),
        args: z.array(z.string()).optional(),
        stdin: z.string().optional(),
        timeoutMs: z.number().optional(),
      },
    },
    async (input) => jsonResult(await tools.printingPressRun(input)),
  );

  server.registerTool(
    "model_profile_register",
    {
      description: "Register a native small-model profile for deterministic routing and learning traces.",
      inputSchema: modelProfileSchema,
    },
    async (input) => jsonResult(tools.modelProfileRegister(input)),
  );

  server.registerTool(
    "model_profile_select",
    {
      description: "Select a native model profile deterministically and emit a replayable route trace.",
      inputSchema: {
        taskType: z.string(),
        mode: z.enum(["fast", "balanced", "deep", "ultra"]),
        requiredStrengths: z.array(z.string()),
        requiresPrivacy: z.boolean().optional(),
        deniedProviders: z.array(z.string()).optional(),
      },
    },
    async (input) => jsonResult(tools.modelProfileSelect(input)),
  );

  server.registerTool(
    "model_profile_record_outcome",
    {
      description: "Record an outcome for a native model-profile route trace.",
      inputSchema: {
        traceId: z.string(),
        status: z.enum(["succeeded", "failed", "partial"]),
        latencyMs: z.number(),
        outputQuality: z.number(),
        notes: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.modelProfileRecordOutcome(input)),
  );

  server.registerTool(
    "model_profile_export_traces",
    {
      description: "Export replayable native model-profile route traces.",
      inputSchema: {},
    },
    async () => jsonResult(tools.modelProfileExportTraces()),
  );

  server.registerTool(
    "python_sidecar_probe",
    {
      description: "Probe the required Python runtime and report startup readiness.",
      inputSchema: {},
    },
    async () => jsonResult(await tools.pythonSidecarProbe()),
  );

  const pythonGraphPayloadSchema = {
    nodes: z.array(
      z.object({
        id: z.string(),
        kind: z.string().optional(),
      }),
    ),
    edges: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        kind: z.string().optional(),
      }),
    ),
  };

  server.registerTool(
    "python_graph_metrics",
    {
      description: "Run required-runtime Python graph metrics over caller-supplied Wormhole graph nodes and edges.",
      inputSchema: pythonGraphPayloadSchema,
    },
    async (input) => jsonResult(await tools.pythonGraphMetrics(input)),
  );

  server.registerTool(
    "python_graph_communities",
    {
      description: "Run required-runtime Python community analysis over caller-supplied Wormhole graph nodes and edges.",
      inputSchema: pythonGraphPayloadSchema,
    },
    async (input) => jsonResult(await tools.pythonGraphCommunities(input)),
  );

  server.registerTool(
    "python_trace_summary",
    {
      description: "Run required-runtime Python analysis over model-profile route traces and outcomes.",
      inputSchema: {
        traces: z.array(
          z.object({
            profileId: z.string().optional(),
            profile: z
              .object({
                profileId: z.string().optional(),
              })
              .optional(),
            status: z.string().optional(),
            latencyMs: z.number().optional(),
            outputQuality: z.number().optional(),
          }),
        ),
      },
    },
    async (input) => jsonResult(await tools.pythonTraceSummary(input)),
  );

  const mediaInputSchema = {
    repoRoot: z.string(),
    sourcePath: z.string(),
    missionId: z.string().optional(),
    recordEvidence: z.boolean().optional(),
    maxBytes: z.number().int().min(1).max(25 * 1024 * 1024).optional(),
  };

  server.registerTool(
    "media_dependency_report",
    {
      description: "Report Python media package availability for PDF, image, and OCR extraction.",
      inputSchema: {},
    },
    async () => jsonResult(await tools.mediaDependencyReport()),
  );

  server.registerTool(
    "media_ingest_pdf",
    {
      description: "Ingest a repo-local PDF into an evidence-ready media record.",
      inputSchema: {
        ...mediaInputSchema,
        maxPages: z.number().int().min(1).max(500).optional(),
      },
    },
    async (input) => jsonResult(await tools.mediaIngestPdf(input)),
  );

  server.registerTool(
    "media_ingest_image",
    {
      description: "Ingest a repo-local image into an evidence-ready media record.",
      inputSchema: {
        ...mediaInputSchema,
        ocrMode: z.enum(["off", "auto", "required"]).optional(),
      },
    },
    async (input) => jsonResult(await tools.mediaIngestImage(input)),
  );

  const shellKindSchema = z.enum([
    "powershell",
    "windows-powershell",
    "bash",
    "zsh",
    "fish",
    "nushell",
    "cmd",
  ]);
  const shellHookInputSchema = {
    shells: z.array(shellKindSchema),
    allowRegistry: z.boolean().optional(),
    repoRoot: z.string().optional(),
  };

  server.registerTool(
    "shell_hook_discover",
    {
      description: "Discover supported shell hook targets without editing profiles.",
      inputSchema: {
        repoRoot: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.shellHookDiscover(input)),
  );

  server.registerTool(
    "shell_hook_plan",
    {
      description: "Plan marker-based Wormhole shell hook installation without editing profiles.",
      inputSchema: {
        ...shellHookInputSchema,
        dryRun: z.boolean().optional(),
        action: z.enum(["install", "uninstall"]).optional(),
      },
    },
    async (input) => jsonResult(tools.shellHookPlan(input)),
  );

  server.registerTool(
    "shell_hook_install",
    {
      description: "Install marker-based Wormhole shell hooks after explicit apply confirmation.",
      inputSchema: {
        shells: z.array(shellKindSchema),
        allowRegistry: z.boolean().optional(),
        planToken: z.string(),
        apply: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.shellHookInstall(input)),
  );

  server.registerTool(
    "shell_hook_uninstall",
    {
      description: "Uninstall marker-based Wormhole shell hooks after explicit apply confirmation.",
      inputSchema: {
        shells: z.array(shellKindSchema),
        allowRegistry: z.boolean().optional(),
        planToken: z.string(),
        apply: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.shellHookUninstall(input)),
  );

  server.registerTool(
    "shell_hook_verify",
    {
      description: "Verify marker-based Wormhole shell hook presence.",
      inputSchema: shellHookInputSchema,
    },
    async (input) => jsonResult(tools.shellHookVerify(input)),
  );

  const endpointObservationSchema = z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    origin: z.string(),
    pathTemplate: z.string(),
    queryKeys: z.array(z.string()),
    requestContentType: z.string().optional(),
    responseContentType: z.string().optional(),
    statusClass: z.enum(["2xx", "3xx", "4xx", "5xx"]).optional(),
    sampleHash: z.string().optional(),
    source: z.enum(["har", "openapi", "http-crawl", "browser-capture"]),
    operationId: z.string().optional(),
  });

  server.registerTool(
    "discovery_har_import",
    {
      description: "Import HAR 1.2 entries as redacted API endpoint observations.",
      inputSchema: {
        harJson: z.any(),
        maxEntries: z.number().int().min(1).max(1000).optional(),
      },
    },
    async (input) => jsonResult(tools.discoveryHarImport(input)),
  );

  server.registerTool(
    "discovery_openapi_import",
    {
      description: "Import OpenAPI JSON or constrained YAML into endpoint observations and tool specs.",
      inputSchema: {
        specText: z.string(),
        sourceName: z.string(),
      },
    },
    async (input) => jsonResult(tools.discoveryOpenApiImport(input)),
  );

  server.registerTool(
    "discovery_http_crawl",
    {
      description: "Run a bounded same-origin HTTP crawl and return endpoint observations.",
      inputSchema: {
        startUrl: z.string(),
        maxPages: z.number().int().min(1).max(25).optional(),
        maxDepth: z.number().int().min(0).max(3).optional(),
        allowOrigins: z.array(z.string()).optional(),
        userAgent: z.string().optional(),
        timeoutMs: z.number().int().min(100).max(5000).optional(),
        allowPrivateNetwork: z.boolean().optional(),
        maxResponseBytes: z.number().int().min(1024).max(1_000_000).optional(),
      },
    },
    async (input) => jsonResult(await tools.discoveryHttpCrawl(input)),
  );

  server.registerTool(
    "discovery_browser_capture",
    {
      description: "Capture browser network observations when optional browser dependencies are available.",
      inputSchema: {
        url: z.string(),
        maxRequests: z.number().int().min(1).max(100).optional(),
        browserEndpoint: z.string().optional(),
        timeoutMs: z.number().int().min(100).max(10_000).optional(),
        allowPrivateNetwork: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(await tools.discoveryBrowserCapture(input)),
  );

  server.registerTool(
    "discovery_tool_spec_generate",
    {
      description: "Generate deterministic API tool specs from endpoint observations.",
      inputSchema: {
        observations: z.array(endpointObservationSchema),
        baseCommand: z.string().optional(),
        authMode: z.enum(["none", "bearer-env", "api-key-env"]).optional(),
      },
    },
    async (input) => jsonResult(tools.discoveryToolSpecGenerate(input)),
  );

  server.registerTool(
    "repo_graph_export",
    {
      description: "Export the native repo graph as graph.json, GRAPH_REPORT.md, and graph.html content.",
      inputSchema: {
        repoRoot: z.string(),
        communities: z
          .array(
            z.object({
              id: z.string(),
              members: z.array(z.string()),
            }),
          )
          .optional(),
      },
    },
    async (input) => jsonResult(tools.repoGraphExport(input)),
  );

  server.registerTool(
    "graph_communities_refresh",
    {
      description: "Compute and persist repo graph communities from the current native repo graph.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(await tools.graphCommunitiesRefresh(input)),
  );

  server.registerTool(
    "list_communities",
    {
      description: "List persisted repo graph communities for the current repo index.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.listCommunities(input)),
  );

  server.registerTool(
    "get_community",
    {
      description: "Return files, symbols, and edge evidence for one persisted repo graph community.",
      inputSchema: {
        repoRoot: z.string(),
        id: z.string(),
      },
    },
    async (input) => jsonResult(tools.getCommunity(input)),
  );

  server.registerTool(
    "get_surprising_connections",
    {
      description: "Rank cross-community repo graph connections with path and edge evidence.",
      inputSchema: {
        repoRoot: z.string(),
        limit: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.getSurprisingConnections(input)),
  );

  server.registerTool(
    "graph_wiki_generate",
    {
      description: "Render or write wiki-style Markdown pages from repo graph communities and execution flows.",
      inputSchema: {
        repoRoot: z.string(),
        scope: z.enum(["all", "overview", "communities", "flows"]).optional(),
        communityId: z.string().optional(),
        flowId: z.string().optional(),
        write: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.graphWikiGenerate(input)),
  );

  const graphNodeKindSchema = z.enum(["file", "symbol", "community", "flow"]);
  server.registerTool(
    "graph_node_semantic_index_refresh",
    {
      description: "Persist a semantic fallback index scoped to repo graph files, symbols, communities, and flows.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.graphNodeSemanticIndexRefresh(input)),
  );

  server.registerTool(
    "graph_node_semantic_search",
    {
      description: "Search the persisted semantic fallback index for graph nodes only.",
      inputSchema: {
        repoRoot: z.string(),
        query: z.string(),
        limit: z.number().optional(),
        kinds: z.array(graphNodeKindSchema).optional(),
      },
    },
    async (input) => jsonResult(tools.graphNodeSemanticSearch(input)),
  );

  const executionFlowKindSchema = z.enum(["api", "cli", "worker", "script"]);
  server.registerTool(
    "flows_refresh",
    {
      description: "Persist named execution flows from discovered API, CLI, worker, and script entrypoints.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.flowsRefresh(input)),
  );

  server.registerTool(
    "list_flows",
    {
      description: "List persisted named execution flows with optional kind and text filtering.",
      inputSchema: {
        repoRoot: z.string(),
        kind: executionFlowKindSchema.optional(),
        query: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.listFlows(input)),
  );

  server.registerTool(
    "get_flow",
    {
      description: "Return one persisted named execution flow by id or name.",
      inputSchema: {
        repoRoot: z.string(),
        idOrName: z.string(),
      },
    },
    async (input) => jsonResult(tools.getFlow(input)),
  );

  server.registerTool(
    "repo_watch_start",
    {
      description: "Start an opt-in repo watch session with a baseline file snapshot.",
      inputSchema: {
        repoRoot: z.string(),
        missionId: z.string().optional(),
        ...repoWatchOptionsSchema,
      },
    },
    async (input) => jsonResult(tools.repoWatchStart(input)),
  );

  server.registerTool(
    "repo_watch_scan",
    {
      description: "Scan a repo watch session for file changes, git diffs, activity events, evidence recording, and graph refresh.",
      inputSchema: {
        watchId: z.string(),
      },
    },
    async (input) => jsonResult(tools.repoWatchScan(input)),
  );

  server.registerTool(
    "repo_watch_status",
    {
      description: "Return active repo watch sessions and recorded repo activity events.",
      inputSchema: {
        repoRoot: z.string().optional(),
        watchId: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.repoWatchStatus(input)),
  );

  server.registerTool(
    "repo_watch_stop",
    {
      description: "Stop an active repo watch session.",
      inputSchema: {
        watchId: z.string(),
      },
    },
    async (input) => jsonResult(tools.repoWatchStop(input)),
  );

  server.registerTool(
    "repo_change_scan",
    {
      description: "Run a one-shot repo change scan with git diff detection.",
      inputSchema: {
        repoRoot: z.string(),
        ...repoWatchOptionsSchema,
      },
    },
    async (input) => jsonResult(tools.repoChangeScan(input)),
  );

  server.registerTool(
    "repo_activity_record",
    {
      description: "Record a structured repo activity event such as a command, verification, or note.",
      inputSchema: {
        repoRoot: z.string(),
        kind: repoActivityKindSchema,
        summary: z.string(),
        paths: z.array(z.string()).optional(),
        missionId: z.string().optional(),
        watchId: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (input) => jsonResult(tools.repoActivityRecord(input)),
  );

  server.registerTool(
    "repo_graph_refresh_incremental",
    {
      description: "Refresh the durable repo graph after changed files and return impact-aware graph context.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()),
        diffText: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.repoGraphRefreshIncremental(input)),
  );

  server.registerTool(
    "repo_graph_refresh_full",
    {
      description: "Run the explicit full durable repo graph rebuild and return impact-aware graph context.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()),
        diffText: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.repoGraphRefreshFull(input)),
  );

  server.registerTool(
    "project_contract_detect",
    {
      description: "Detect package manager, scripts, dependencies, env hints, lockfiles, and ports for a repo.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.projectContractDetect(input)),
  );

  server.registerTool(
    "source_conflicts_analyze",
    {
      description: "Compare documentation and generated artifacts against current repo, package, and schema facts.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.sourceConflictsAnalyze(input)),
  );

  server.registerTool(
    "capability_relation_audit",
    {
      description: "Audit capability-to-tool/workflow/test relations and report missing wiring.",
      inputSchema: {
        allowlist: z.array(z.string()).optional(),
      },
    },
    async (input) => jsonResult(tools.capabilityRelationAudit(input)),
  );

  server.registerTool(
    "dependency_inventory",
    {
      description: "Return dependency inventory from the detected project contract.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.dependencyInventory(input)),
  );

  server.registerTool(
    "project_command_map",
    {
      description: "Return package scripts and package-manager command context for a repo.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.projectCommandMap(input)),
  );

  server.registerTool(
    "diagnostics_from_command",
    {
      description: "Normalize compiler, test, and command output into structured diagnostics.",
      inputSchema: {
        source: z.string(),
        output: z.string(),
      },
    },
    async (input) => jsonResult(tools.diagnosticsFromCommand(input)),
  );

  server.registerTool(
    "diagnostics_from_lsp",
    {
      description: "Normalize LSP diagnostics into Wormhole's structured diagnostic records.",
      inputSchema: {
        uri: z.string(),
        diagnostics: z.array(lspDiagnosticSchema),
      },
    },
    async (input) => jsonResult(tools.diagnosticsFromLsp(input)),
  );

  server.registerTool(
    "diagnostics_record",
    {
      description: "Persist structured diagnostics in handler runtime state.",
      inputSchema: {
        diagnostics: z.array(diagnosticRecordSchema),
      },
    },
    async (input) => jsonResult(tools.diagnosticsRecord(input)),
  );

  server.registerTool(
    "diagnostics_query",
    {
      description: "Query persisted diagnostics by severity, source, or file suffix.",
      inputSchema: {
        severity: diagnosticSeveritySchema.optional(),
        source: z.string().optional(),
        file: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.diagnosticsQuery(input)),
  );

  server.registerTool(
    "lsp_feedback_replan",
    {
      description: "Record LSP diagnostics and re-scope the mission through mission-delta replanning.",
      inputSchema: {
        missionId: z.string().optional(),
        repoRoot: z.string().optional(),
        objective: z.string().optional(),
        uri: z.string(),
        diagnostics: z.array(lspDiagnosticSchema),
        changedFiles: z.array(z.string()).optional(),
        diffText: z.string().optional(),
        evidenceRecords: z.array(missionDeltaEvidenceSchema).optional(),
        maxContextChars: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.lspFeedbackReplan(input)),
  );

  server.registerTool(
    "impact_analyze",
    {
      description: "Analyze impacted files and likely tests from changed files using the native repo graph.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()),
      },
    },
    async (input) => jsonResult(tools.impactAnalyze(input)),
  );

  server.registerTool(
    "test_plan_select",
    {
      description: "Select a focused verification plan from project contract and impact analysis.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()),
        tier: z.enum(["smoke", "focused", "standard", "full"]).optional(),
      },
    },
    async (input) => jsonResult(tools.testPlanSelect(input)),
  );

  server.registerTool(
    "verification_run",
    {
      description: "Run selected verification commands through the optimized command runner.",
      inputSchema: {
        commands: z.array(verificationCommandSchema),
      },
    },
    async (input) => jsonResult(await tools.verificationRun(input)),
  );

  server.registerTool(
    "secret_scan",
    {
      description: "Scan repo files or supplied text for likely secrets with redacted findings.",
      inputSchema: {
        repoRoot: z.string().optional(),
        source: z.string().optional(),
        text: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.secretScan(input)),
  );

  server.registerTool(
    "operation_risk_review",
    {
      description: "Review a command for destructive or approval-worthy operation risk.",
      inputSchema: {
        command: z.string(),
        args: z.array(z.string()).optional(),
      },
    },
    async (input) => jsonResult(tools.operationRiskReview(input)),
  );

  server.registerTool(
    "semantic_index_build",
    {
      description: "Build a deterministic local semantic fallback index from caller-supplied records.",
      inputSchema: {
        records: z.array(semanticRecordSchema),
      },
    },
    async (input) => jsonResult(tools.semanticIndexBuild(input)),
  );

  server.registerTool(
    "semantic_search",
    {
      description: "Search a deterministic semantic fallback index by token-overlap relevance.",
      inputSchema: {
        index: semanticIndexSchema,
        query: z.string(),
        limit: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.semanticSearch(input)),
  );

  server.registerTool(
    "lsp_probe",
    {
      description: "Detect safe language-server startup config without spawning long-lived servers.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.lspProbe(input)),
  );

  server.registerTool(
    "lsp_server_configs",
    {
      description: "Return detected language-server command configs for a repo.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.lspServerConfigs(input)),
  );

  server.registerTool(
    "lsp_normalize_location",
    {
      description: "Normalize an LSP file location into one-based editor coordinates.",
      inputSchema: lspLocationSchema.shape,
    },
    async (input) => jsonResult(tools.lspNormalizeLocation(input)),
  );

  server.registerTool(
    "project_onboard",
    {
      description: "Run one-shot project onboarding across contract, indexes, LSP probe, safety, impact, verification, dependency, and policy signals.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()).optional(),
        diffText: z.string().optional(),
        semanticRecords: z.array(semanticRecordSchema).optional(),
        semanticQuery: z.string().optional(),
        action: z.object({ operations: z.array(actionPolicyOperationSchema) }).optional(),
      },
    },
    async (input) => jsonResult(tools.projectOnboard(input)),
  );

  server.registerTool(
    "repo_native_pack_build",
    {
      description: "Build a read-only repo-native coverage pack from existing project intelligence, feature slices, schema evidence, conventions, scripts, verification gates, and coverage gaps.",
      inputSchema: repoNativePackInputSchema,
    },
    async (input) => jsonResult(tools.repoNativePackBuild(input)),
  );

  server.registerTool(
    "feature_slice_query",
    {
      description: "Query repo-native feature slices derived from the existing feature index, source conflicts, schema evidence, and changed files.",
      inputSchema: repoNativePackInputSchema,
    },
    async (input) => jsonResult(tools.featureSliceQuery(input)),
  );

  server.registerTool(
    "blueprint_compile_repo",
    {
      description: "Compile native Wormhole project intelligence into existing-repo blueprint, constraints, and agent context artifacts.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string(),
        progressive: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.blueprintCompileRepo(input)),
  );

  server.registerTool(
    "blueprint_write_artifacts",
    {
      description: "Write .wormhole/blueprint.json, .wormhole/constraints.json, and .wormhole/agent-context.md for a repo.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string(),
        progressive: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.blueprintWriteArtifacts(input)),
  );

  server.registerTool(
    "blueprint_gate_check",
    {
      description: "Check planned commands and completion claims against a Wormhole constraints manifest.",
      inputSchema: {
        constraints: z.any(),
        sourceConflicts: z.any().optional(),
        freshness: z.any().optional(),
        action: z.object({
          plannedCommands: z
            .array(
              z.object({
                command: z.string(),
                args: z.array(z.string()).optional(),
              }),
            )
            .optional(),
          completionClaim: z.boolean().optional(),
          reportedVerification: z
            .array(
              z.object({
                command: z.string(),
                args: z.array(z.string()).optional(),
                status: z.enum(["passed", "failed", "skipped"]),
              }),
            )
            .optional(),
        }),
      },
    },
    async (input) => jsonResult(tools.blueprintGateCheck(input)),
  );

  server.registerTool(
    "app_process_compile",
    {
      description: "Compile a full-app process bootstrap from objective, repo blueprint, and local project signals.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string(),
      },
    },
    async (input) => jsonResult(tools.appProcessCompile(input)),
  );

  server.registerTool(
    "app_process_write_artifacts",
    {
      description: "Write .wormhole app-process, product, roadmap, backlog, and phase artifacts for coding agents.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string(),
      },
    },
    async (input) => jsonResult(tools.appProcessWriteArtifacts(input)),
  );

  server.registerTool(
    "app_process_validate",
    {
      description: "Validate a Wormhole app-process artifact before roadmap or implementation claims.",
      inputSchema: {
        appProcess: z.any(),
      },
    },
    async (input) => jsonResult(tools.appProcessValidate(input)),
  );

  server.registerTool(
    "app_process_gate_check",
    {
      description: "Block implementation or completion claims until app-process drafts are accepted and verification is reported.",
      inputSchema: {
        appProcess: z.any(),
        sourceConflicts: z.any().optional(),
        freshness: z.any().optional(),
        artifactFreshness: z.array(z.any()).optional(),
        action: z.object({
          implementationClaim: z.boolean().optional(),
          completionClaim: z.boolean().optional(),
          acceptedDraftSections: z
            .array(z.enum(["productDefinition", "roadmap", "backlog", "ux", "security"]))
            .optional(),
          reportedVerification: z
            .array(
              z.object({
                command: z.string(),
                args: z.array(z.string()).optional(),
                status: z.enum(["passed", "failed", "skipped"]),
              }),
            )
            .optional(),
        }),
      },
    },
    async (input) => jsonResult(tools.appProcessGateCheck(input)),
  );

  server.registerTool(
    "app_process_status",
    {
      description: "Read durable app-process run state, blocked gates, next action, verification records, and missing artifacts.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.appProcessStatus(input)),
  );

  server.registerTool(
    "app_process_accept_section",
    {
      description: "Record acceptance of one AI-drafted app-process section without modifying source code.",
      inputSchema: {
        repoRoot: z.string(),
        section: z.enum(["productDefinition", "roadmap", "backlog", "ux", "security"]),
        acceptedBy: z.string().optional(),
        note: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.appProcessAcceptSection(input)),
  );

  server.registerTool(
    "app_process_continue",
    {
      description: "Advance one bounded app-process continuation step and persist the prepared story state.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.appProcessContinue(input)),
  );

  server.registerTool(
    "app_process_record_verification",
    {
      description: "Record app-process verification evidence so completion gates can use durable run state.",
      inputSchema: {
        repoRoot: z.string(),
        command: z.string(),
        args: z.array(z.string()).optional(),
        status: z.enum(["passed", "failed", "skipped"]),
        evidencePath: z.string().optional(),
        summary: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.appProcessRecordVerification(input)),
  );

  server.registerTool(
    "architecture_map",
    {
      description: "Create a native architecture map with modules, owners, dependencies, entrypoint counts, and source-backed evidence.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.architectureMap(input)),
  );

  server.registerTool(
    "entrypoint_flow_discover",
    {
      description: "Discover native API, CLI, worker, and package-script entrypoints with downstream repo files.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.entrypointFlowDiscover(input)),
  );

  server.registerTool(
    "blast_radius_analyze",
    {
      description: "Analyze changed files and diff hunks against the native project model to find impacted files, modules, entrypoints, and likely tests.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()),
        diffText: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.blastRadiusAnalyze(input)),
  );

  server.registerTool(
    "context_pack_generate",
    {
      description: "Generate a task-scoped native project context pack from architecture, entrypoints, blast radius, and relevant source files.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string(),
        query: z.string(),
        changedFiles: z.array(z.string()).optional(),
        maxChars: z.number(),
      },
    },
    async (input) => jsonResult(tools.contextPackGenerate(input)),
  );

  server.registerTool(
    "project_intelligence_snapshot",
    {
      description: "Return a compact native project-intelligence snapshot plus the recommended default tool sequence for an agent.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string().optional(),
        query: z.string().optional(),
        changedFiles: z.array(z.string()).optional(),
        diffText: z.string().optional(),
        completedTools: z.array(z.string()).optional(),
        maxChars: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.projectIntelligenceSnapshot(input)),
  );

  server.registerTool(
    "tool_layer_map",
    {
      description: "Return the read-only layered Wormhole tool map with planes, phases, packs, and entry tools.",
      inputSchema: {},
    },
    async () => jsonResult(tools.toolLayerMap()),
  );

  server.registerTool(
    "tool_exposure_profile",
    {
      description: "Describe full, guided, or layered tool exposure without changing the registered MCP tool surface.",
      inputSchema: {
        mode: toolExposureModeSchema.optional(),
      },
    },
    async (input) => jsonResult(tools.toolExposureProfile(input)),
  );

  server.registerTool(
    "tool_catalog_query",
    {
      description: "Query Wormhole tool metadata by structured plane, phase, pack, risk, or tool-name filters.",
      inputSchema: {
        plane: toolPlaneSchema.optional(),
        phase: toolPhaseSchema.optional(),
        pack: toolPackSchema.optional(),
        risk: toolRiskSchema.optional(),
        toolNames: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (input) => jsonResult(tools.toolCatalogQuery(input)),
  );

  server.registerTool(
    "tool_admission_review",
    {
      description: "Review selected tools for advisory approval and preflight requirements before write or execute work.",
      inputSchema: {
        toolNames: z.array(z.string()),
      },
    },
    async (input) => jsonResult(tools.toolAdmissionReview(input)),
  );

  server.registerTool(
    "workflow_start_feature",
    {
      description: "Return the golden-path sequence for implementing a feature with context, policy, patch, verification, and gate steps.",
      inputSchema: workflowInputSchema,
    },
    async (input) => jsonResult(tools.workflowStartFeature(input)),
  );

  server.registerTool(
    "workflow_fix_bug",
    {
      description: "Return the repro-first golden-path sequence for fixing a bug with diagnostics, impact, context, patch, verification, and gate steps.",
      inputSchema: workflowInputSchema,
    },
    async (input) => jsonResult(tools.workflowFixBug(input)),
  );

  server.registerTool(
    "workflow_review_pr",
    {
      description: "Return the read-only golden-path sequence for reviewing a PR or local diff with impact, security, verification, evidence, and gate steps.",
      inputSchema: workflowInputSchema,
    },
    async (input) => jsonResult(tools.workflowReviewPr(input)),
  );

  server.registerTool(
    "workflow_onboard_repo",
    {
      description: "Return the golden-path sequence for onboarding a repo through project intelligence, tool exposure, context, evidence, and gate steps.",
      inputSchema: workflowInputSchema,
    },
    async (input) => jsonResult(tools.workflowOnboardRepo(input)),
  );

  server.registerTool(
    "workflow_write_artifacts",
    {
      description: "Write durable .wormhole workflow run state, resume, and latest pointer for an existing workflow kind.",
      inputSchema: {
        workflow: workflowKindSchema,
        ...workflowInputSchema,
      },
    },
    async (input) => jsonResult(tools.workflowWriteArtifacts(input)),
  );

  server.registerTool(
    "next_best_tool",
    {
      description: "Recommend the next Wormhole tool call from the agent's completed tools, task objective, and changed files.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string().optional(),
        query: z.string().optional(),
        changedFiles: z.array(z.string()).optional(),
        diffText: z.string().optional(),
        completedTools: z.array(z.string()).optional(),
        maxChars: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.nextBestTool(input)),
  );

  server.registerTool(
    "mission_route",
    {
      description: "Create an ordered, curated Wormhole route so an agent does not have to choose from the entire tool surface.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string().optional(),
        query: z.string().optional(),
        changedFiles: z.array(z.string()).optional(),
        diffText: z.string().optional(),
        completedTools: z.array(z.string()).optional(),
        maxChars: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.missionRoute(input)),
  );

  server.registerTool(
    "agent_context_prepare",
    {
      description: "Prepare a task-scoped context pack, route, snapshot, and immediate next calls for an AI coding agent.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string(),
        query: z.string(),
        changedFiles: z.array(z.string()).optional(),
        diffText: z.string().optional(),
        completedTools: z.array(z.string()).optional(),
        maxChars: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.agentContextPrepare(input)),
  );

  server.registerTool(
    "state_maintenance_run",
    {
      description:
        "Coordinate graph refresh, context-pack refresh, evidence recording, route refresh, and shared workspace updates in one audited maintenance call.",
      inputSchema: {
        repoRoot: z.string(),
        missionId: z.string().optional(),
        objective: z.string(),
        query: z.string().optional(),
        changedFiles: z.array(z.string()).optional(),
        diffText: z.string().optional(),
        watchId: z.string().optional(),
        scanWatch: z.boolean().optional(),
        refreshGraph: z.boolean().optional(),
        sourceConflicts: z.boolean().optional(),
        freshness: z.boolean().optional(),
        recordEvidence: z.boolean().optional(),
        context: z
          .object({
            maxChars: z.number(),
            recordIds: z.array(z.string()).optional(),
            pinnedRecordIds: z.array(z.string()).optional(),
            staleRecordIds: z.array(z.string()).optional(),
          })
          .optional(),
        workspace: z
          .object({
            workspaceId: z.string(),
            runId: z.string().optional(),
            key: z.string().optional(),
            value: z.unknown().optional(),
            visibility: z.enum(["shared", "private"]).optional(),
            merge: z.boolean().optional(),
            runIds: z.array(z.string()).optional(),
          })
          .optional(),
      },
    },
    async (input) => jsonResult(tools.stateMaintenanceRun(input)),
  );

  server.registerTool(
    "state_maintenance_status",
    {
      description: "Read durable state-maintenance run records, including completed and partial failed runs.",
      inputSchema: {
        runId: z.string().optional(),
        status: z.enum(["running", "completed", "failed"]).optional(),
      },
    },
    async (input) => jsonResult(tools.stateMaintenanceStatus(input)),
  );

  server.registerTool(
    "state_maintenance_retry",
    {
      description: "Retry a prior state-maintenance run from durable input with optional corrected overrides.",
      inputSchema: {
        runId: z.string(),
        overrides: z
          .object({
            repoRoot: z.string().optional(),
            missionId: z.string().optional(),
            objective: z.string().optional(),
            query: z.string().optional(),
            changedFiles: z.array(z.string()).optional(),
            diffText: z.string().optional(),
            watchId: z.string().optional(),
            scanWatch: z.boolean().optional(),
            refreshGraph: z.boolean().optional(),
            recordEvidence: z.boolean().optional(),
            context: z
              .object({
                maxChars: z.number(),
                recordIds: z.array(z.string()).optional(),
                pinnedRecordIds: z.array(z.string()).optional(),
                staleRecordIds: z.array(z.string()).optional(),
              })
              .optional(),
            workspace: z
              .object({
                workspaceId: z.string(),
                runId: z.string().optional(),
                key: z.string().optional(),
                value: z.unknown().optional(),
                visibility: z.enum(["shared", "private"]).optional(),
                merge: z.boolean().optional(),
                runIds: z.array(z.string()).optional(),
              })
              .optional(),
          })
          .optional(),
      },
    },
    async (input) => jsonResult(tools.stateMaintenanceRetry(input)),
  );

  server.registerTool(
    "mission_delta_replan",
    {
      description: "Re-scope a mission after file diffs or diagnostics by refreshing blast radius, focused tests, stale evidence warnings, context, and gate guidance.",
      inputSchema: {
        missionId: z.string().optional(),
        repoRoot: z.string().optional(),
        objective: z.string().optional(),
        changedFiles: z.array(z.string()),
        diffText: z.string().optional(),
        diagnostics: z.array(diagnosticRecordSchema).optional(),
        evidenceRecords: z.array(missionDeltaEvidenceSchema).optional(),
        maxContextChars: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.missionDeltaReplan(input)),
  );

  server.registerTool(
    "durable_repo_index_refresh",
    {
      description: "Refresh and persist the SQLite-backed repo index and JSON compatibility export under .wormhole/indexes.",
      inputSchema: {
        repoRoot: z.string(),
        preset: repoIndexPresetSchema.optional(),
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        maxFiles: z.number().optional(),
        maxFileBytes: z.number().optional(),
        maxTotalBytes: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.durableRepoIndexRefresh(input)),
  );

  server.registerTool(
    "durable_index_status",
    {
      description: "Return durable JSON repo index, SQLite repo index, and semantic index cache status.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.durableIndexStatus(input)),
  );

  server.registerTool(
    "durable_index_manifest_refresh",
    {
      description: "Refresh the durable SQLite repo index, JSON export, manifest, and lane/root shard indexes.",
      inputSchema: {
        repoRoot: z.string(),
        preset: repoIndexPresetSchema.optional(),
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        maxFiles: z.number().optional(),
        maxFileBytes: z.number().optional(),
        maxTotalBytes: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.durableIndexManifestRefresh(input)),
  );

  server.registerTool(
    "durable_index_manifest_status",
    {
      description: "Return durable repo index manifest and shard freshness status.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.durableIndexManifestStatus(input)),
  );

  server.registerTool(
    "durable_repo_index_query",
    {
      description: "Query the durable SQLite repo index by lane, falling back to manifest shards or the full JSON index when needed.",
      inputSchema: {
        repoRoot: z.string(),
        query: z.string(),
        lanes: z.array(projectLaneSchema).optional(),
        limit: z.number().optional(),
        requireFresh: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.durableRepoIndexQuery(input)),
  );

  server.registerTool(
    "domain_index_refresh",
    {
      description: "Refresh the SQLite-backed domain index for manifest-declared features, APIs, schema, conventions, memory, and verification gates.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.domainIndexRefresh(input)),
  );

  server.registerTool(
    "domain_index_status",
    {
      description: "Return domain index freshness, summary, warnings, and health without reading stale results blindly.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.domainIndexStatus(input)),
  );

  server.registerTool(
    "domain_manifest_generate",
    {
      description: "Generate a reviewable .wormhole/domain-index.json candidate from generic repo evidence while preserving manual aliases, portals, and gates.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.domainManifestGenerate(input)),
  );

  server.registerTool(
    "domain_manifest_diff",
    {
      description: "Compare the current domain manifest with the generated candidate and return semantic operations plus base and candidate hashes.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.domainManifestDiff(input)),
  );

  server.registerTool(
    "domain_manifest_status",
    {
      description: "Report domain manifest validity, pending generated changes, operation counts, warnings, and blockers without writing files.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.domainManifestStatus(input)),
  );

  server.registerTool(
    "domain_manifest_apply",
    {
      description: "Apply an approved generated domain manifest candidate with stale-hash protection, backup, atomic write, and optional index refresh.",
      inputSchema: {
        repoRoot: z.string(),
        baseHash: z.string(),
        refreshAfterApply: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.domainManifestApply(input)),
  );

  server.registerTool(
    "domain_slice_query",
    {
      description: "Query a domain feature slice with files, API endpoints, tables, coverage gaps, and gate plans; falls back to repo-native slices when stale or missing.",
      inputSchema: {
        repoRoot: z.string(),
        feature: z.string(),
        requireFresh: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.domainSliceQuery(input)),
  );

  server.registerTool(
    "domain_api_query",
    {
      description: "Query indexed domain API endpoints by feature, method, path template, or text.",
      inputSchema: {
        repoRoot: z.string(),
        feature: z.string().optional(),
        method: z.string().optional(),
        pathTemplate: z.string().optional(),
        query: z.string().optional(),
        requireFresh: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.domainApiQuery(input)),
  );

  server.registerTool(
    "domain_table_query",
    {
      description: "Query folded domain schema tables, columns, indexes, foreign keys, and migration provenance.",
      inputSchema: {
        repoRoot: z.string(),
        table: z.string().optional(),
        feature: z.string().optional(),
        requireFresh: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.domainTableQuery(input)),
  );

  server.registerTool(
    "domain_index_coverage",
    {
      description: "List domain index coverage gaps such as undocumented routes, unowned APIs, unowned tables, and source conflicts.",
      inputSchema: {
        repoRoot: z.string(),
        severity: z.enum(["warning", "blocker"]).optional(),
        kind: domainCoverageGapKindSchema.optional(),
        requireFresh: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.domainIndexCoverage(input)),
  );

  server.registerTool(
    "domain_index_drift",
    {
      description: "Compare the stored domain index with the current repository and report added, removed, changed files and current coverage gaps.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.domainIndexDrift(input)),
  );

  server.registerTool(
    "domain_verification_gate_plan",
    {
      description: "Return domain-specific verification gate scripts and commands matched to a feature or gate id.",
      inputSchema: {
        repoRoot: z.string(),
        gateId: z.string().optional(),
        feature: z.string().optional(),
        requireFresh: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.domainVerificationGatePlan(input)),
  );

  server.registerTool(
    "durable_semantic_index_refresh",
    {
      description: "Refresh and persist a deterministic semantic fallback index.",
      inputSchema: {
        repoRoot: z.string(),
        records: z.array(semanticRecordSchema),
      },
    },
    async (input) => jsonResult(tools.durableSemanticIndexRefresh(input)),
  );

  server.registerTool(
    "durable_semantic_search",
    {
      description: "Search the persisted deterministic semantic fallback index.",
      inputSchema: {
        repoRoot: z.string(),
        query: z.string(),
        limit: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.durableSemanticSearch(input)),
  );

  server.registerTool(
    "test_impact_analyze_v2",
    {
      description: "Analyze diff hunks, changed symbols, and confidence-scored likely tests.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()),
        diffText: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.testImpactAnalyzeV2(input)),
  );

  server.registerTool(
    "dependency_security_report",
    {
      description: "Create a local dependency, lockfile, license, and provider-availability security report.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.dependencySecurityReport(input)),
  );

  server.registerTool(
    "git_lifecycle_status",
    {
      description: "Summarize git branch, HEAD, ahead/behind, staged, unstaged, and untracked lifecycle state.",
      inputSchema: {
        repoRoot: z.string(),
        baseRef: z.string().optional(),
        timeoutMs: z.number().int().positive().max(30000).optional(),
      },
    },
    async (input) => jsonResult(tools.gitLifecycleStatus(input)),
  );

  server.registerTool(
    "git_branch_prepare",
    {
      description: "Prepare a safe branch name from an objective without changing git state.",
      inputSchema: {
        objective: z.string(),
        prefix: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.gitBranchPrepare(input)),
  );

  server.registerTool(
    "git_branch_create",
    {
      description: "Create a git branch with ref validation and privileged action gating.",
      inputSchema: {
        repoRoot: z.string(),
        branchName: z.string(),
        checkout: z.boolean().optional(),
        timeoutMs: z.number().int().positive().max(30000).optional(),
      },
    },
    async (input) => jsonResult(tools.gitBranchCreate(input)),
  );

  server.registerTool(
    "git_commit_prepare",
    {
      description: "Prepare an advisory conventional commit message from changed files and objective evidence.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string(),
        evidence: z
          .array(
            z.object({
              sourcePath: z.string().optional(),
              summary: z.string(),
            }),
          )
          .optional(),
      },
    },
    async (input) => jsonResult(tools.gitCommitPrepare(input)),
  );

  server.registerTool(
    "git_commit_create",
    {
      description: "Create a git commit for explicit repo-relative files with path validation and no hook execution.",
      inputSchema: {
        repoRoot: z.string(),
        files: z.array(z.string()),
        message: z.string(),
        timeoutMs: z.number().int().positive().max(30000).optional(),
      },
    },
    async (input) => jsonResult(tools.gitCommitCreate(input)),
  );

  server.registerTool(
    "git_pr_prepare",
    {
      description: "Prepare provider-neutral pull request title, body, checklist, and command hints without network calls.",
      inputSchema: {
        repoRoot: z.string(),
        baseRef: z.string().optional(),
        objective: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.gitPrPrepare(input)),
  );

  server.registerTool(
    "git_conflict_analyze",
    {
      description: "Analyze unmerged git files and bounded conflict markers.",
      inputSchema: {
        repoRoot: z.string(),
        timeoutMs: z.number().int().positive().max(30000).optional(),
        maxFileBytes: z.number().int().positive().optional(),
        maxTotalBytes: z.number().int().positive().optional(),
      },
    },
    async (input) => jsonResult(tools.gitConflictAnalyze(input)),
  );

  server.registerTool(
    "dependency_risk_report",
    {
      description: "Combine local dependency license metadata with npm audit and outdated JSON risk signals.",
      inputSchema: {
        repoRoot: z.string(),
        auditJson: z.string().optional(),
        outdatedJson: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.dependencyRiskReport(input)),
  );

  server.registerTool(
    "dependency_audit_live",
    {
      description: "Run bounded npm audit/outdated commands and parse dependency risk output.",
      inputSchema: {
        repoRoot: z.string(),
        includeOutdated: z.boolean().optional(),
        timeoutMs: z.number().int().positive().max(120000).optional(),
      },
    },
    async (input) => jsonResult(tools.dependencyAuditLive(input)),
  );

  server.registerTool(
    "docs_sync_check",
    {
      description: "Gate documentation freshness against source conflicts and public-surface file changes.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()).optional(),
        diffText: z.string().optional(),
        requireDocsForPublicChanges: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.docsSyncCheck(input)),
  );

  server.registerTool(
    "workspace_graph_analyze",
    {
      description: "Analyze npm, pnpm, Cargo, and multi-root workspace package graphs.",
      inputSchema: {
        repoRoot: z.string(),
        additionalRepoRoots: z.array(z.string()).optional(),
      },
    },
    async (input) => jsonResult(tools.workspaceGraphAnalyze(input)),
  );

  server.registerTool(
    "code_smell_scan",
    {
      description: "Scan changed code for potential dead code, complexity, duplicate blocks, and needless dependencies.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()).optional(),
        diffText: z.string().optional(),
        maxComplexity: z.number().optional(),
        duplicateMinLines: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.codeSmellScan(input)),
  );

  server.registerTool(
    "diff_scope_review",
    {
      description: "Review whether changed files and hunks trace to an objective, evidence paths, or approved paths.",
      inputSchema: {
        repoRoot: z.string(),
        objective: z.string(),
        diffText: z.string().optional(),
        changedFiles: z.array(z.string()).optional(),
        evidence: z.array(diffScopeEvidenceSchema).optional(),
        approvedPaths: z.array(z.string()).optional(),
        strict: z.boolean().optional(),
      },
    },
    async (input) => jsonResult(tools.diffScopeReview(input)),
  );

  server.registerTool(
    "test_quality_review",
    {
      description: "Review changed tests for skipped tests, missing assertions, snapshot-only assertions, and missing test changes.",
      inputSchema: {
        repoRoot: z.string(),
        changedFiles: z.array(z.string()),
      },
    },
    async (input) => jsonResult(tools.testQualityReview(input)),
  );

  server.registerTool(
    "coverage_delta_analyze",
    {
      description: "Compare before/after coverage summaries and report coverage drops.",
      inputSchema: {
        before: z.union([z.string(), coverageSummarySchema]).optional(),
        after: z.union([z.string(), coverageSummarySchema]).optional(),
        failBelowDelta: z.number().optional(),
      },
    },
    async (input) => jsonResult(tools.coverageDeltaAnalyze(input)),
  );

  server.registerTool(
    "action_policy_review",
    {
      description: "Review commands, file edits, tool writes, deletes, and network operations for admission risk.",
      inputSchema: {
        operations: z.array(actionPolicyOperationSchema),
      },
    },
    async (input) => jsonResult(tools.actionPolicyReview(input)),
  );

  server.registerTool(
    "patch_checkpoint",
    {
      description: "Create a repo-confined patch checkpoint with before-content snapshots for rollback.",
      inputSchema: {
        repoRoot: z.string(),
        label: z.string().optional(),
        files: z.array(z.string()),
      },
    },
    async (input) => jsonResult(tools.patchCheckpoint(input)),
  );

  server.registerTool(
    "patch_apply",
    {
      description: "Apply a git-style unified diff against a checkpoint and record rollback plus verification metadata.",
      inputSchema: {
        repoRoot: z.string(),
        checkpointId: z.string(),
        unifiedDiff: z.string(),
        verificationCommands: z.array(patchVerificationCommandSchema).optional(),
        scopeReview: patchScopeReviewSchema.optional(),
      },
    },
    async (input) => jsonResult(tools.patchApply(input)),
  );

  server.registerTool(
    "patch_status",
    {
      description: "List patch checkpoints and transactions without returning captured file contents.",
      inputSchema: {
        repoRoot: z.string().optional(),
        checkpointId: z.string().optional(),
        transactionId: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.patchStatus(input)),
  );

  server.registerTool(
    "patch_rollback",
    {
      description: "Rollback an applied patch transaction to its captured before-content snapshots.",
      inputSchema: {
        repoRoot: z.string(),
        transactionId: z.string(),
      },
    },
    async (input) => jsonResult(tools.patchRollback(input)),
  );

  server.registerTool(
    "agent_remit_create",
    {
      description: "Create a native Wormhole agent remit: declared mission, capabilities, channels, data boundaries, approvals, and known-good baseline.",
      inputSchema: agentRemitSchema.shape,
    },
    async (input) => jsonResult(tools.agentRemitCreate(input)),
  );

  server.registerTool(
    "agent_capability_inventory",
    {
      description: "Normalize an observed agent capability inventory from tools, channels, actions, prompts, logs, MCP servers, and outbound destinations.",
      inputSchema: agentCapabilityInventorySchema.shape,
    },
    async (input) => jsonResult(tools.agentCapabilityInventory(input)),
  );

  server.registerTool(
    "agent_behavior_verify",
    {
      description: "Compare an agent remit against observed capability and behavior inventory, producing coverage, findings, positives, and risk summary.",
      inputSchema: {
        remit: z.any(),
        inventory: z.any(),
      },
    },
    async (input) => jsonResult(tools.agentBehaviorVerify(input)),
  );

  server.registerTool(
    "remit_coverage_report",
    {
      description: "Render rule-by-rule remit coverage from an agent behavior verification report.",
      inputSchema: {
        report: z.any(),
      },
    },
    async (input) => jsonResult(tools.remitCoverageReport(input)),
  );

  server.registerTool(
    "agent_drift_analyze",
    {
      description: "Compare current observed agent inventory against the remit known-good baseline.",
      inputSchema: {
        remit: z.any(),
        currentInventory: z.any(),
      },
    },
    async (input) => jsonResult(tools.agentDriftAnalyze(input)),
  );

  server.registerTool(
    "behavior_findings_render",
    {
      description: "Render a deterministic Markdown report from an agent behavior verification report.",
      inputSchema: {
        report: z.any(),
      },
    },
    async (input) => jsonResult(tools.behaviorFindingsRender(input)),
  );

  server.registerTool(
    "agent_workspace_create",
    {
      description: "Create shared mission workspace memory for concurrent agent runs.",
      inputSchema: {
        missionId: z.string(),
        objective: z.string().optional(),
      },
    },
    async (input) => jsonResult(tools.agentWorkspaceCreate(input)),
  );

  server.registerTool(
    "agent_workspace_write",
    {
      description: "Write an attributed shared-memory record for an agent run.",
      inputSchema: {
        workspaceId: z.string(),
        runId: z.string().optional(),
        key: z.string(),
        value: z.unknown(),
        visibility: z.enum(["shared", "private"]).optional(),
        provenance: agentWorkspaceProvenanceSchema.optional(),
      },
    },
    async (input) => jsonResult(tools.agentWorkspaceWrite(input)),
  );

  server.registerTool(
    "agent_workspace_read",
    {
      description: "Read shared mission workspace records by workspace, key, run, or visibility.",
      inputSchema: {
        workspaceId: z.string(),
        key: z.string().optional(),
        runId: z.string().optional(),
        visibility: z.enum(["shared", "private"]).optional(),
      },
    },
    async (input) => jsonResult(tools.agentWorkspaceRead(input)),
  );

  server.registerTool(
    "agent_workspace_merge",
    {
      description: "Merge shared workspace records and report concurrent-write conflicts by key.",
      inputSchema: {
        workspaceId: z.string(),
        runIds: z.array(z.string()).optional(),
      },
    },
    async (input) => jsonResult(tools.agentWorkspaceMerge(input)),
  );

  server.registerTool(
    "lsp_session_start",
    {
      description: "Start a bounded process-local LSP JSON-RPC session.",
      inputSchema: {
        repoRoot: z.string(),
        language: z.string(),
        command: z.string(),
        args: z.array(z.string()).optional(),
        startupTimeoutMs: z.number().optional(),
      },
    },
    async (input) => jsonResult(await tools.lspSessionStart(input)),
  );

  server.registerTool(
    "lsp_session_list",
    {
      description: "List running process-local LSP sessions.",
      inputSchema: {},
    },
    async () => jsonResult(tools.lspSessionList()),
  );

  server.registerTool(
    "lsp_session_status",
    {
      description: "Return one process-local LSP session status.",
      inputSchema: {
        sessionId: z.string(),
      },
    },
    async (input) => jsonResult(tools.lspSessionStatus(input)),
  );

  server.registerTool(
    "lsp_session_request",
    {
      description: "Send one JSON-RPC request to a running LSP session.",
      inputSchema: {
        sessionId: z.string(),
        method: z.string(),
        params: z.unknown().optional(),
        timeoutMs: z.number().optional(),
      },
    },
    async (input) => jsonResult(await tools.lspSessionRequest(input)),
  );

  server.registerTool(
    "lsp_session_stop",
    {
      description: "Stop a process-local LSP session.",
      inputSchema: {
        sessionId: z.string(),
      },
    },
    async (input) => jsonResult(await tools.lspSessionStop(input)),
  );

  server.registerTool(
    "optimization_adapter_register",
    {
      description: "Register a native, CLI, or HTTP optimization adapter.",
      inputSchema: optimizationAdapterSchema.shape,
    },
    async (input) => jsonResult(tools.optimizationAdapterRegister(input)),
  );

  server.registerTool(
    "optimization_adapter_list",
    {
      description: "List registered optimization adapters.",
      inputSchema: {},
    },
    async () => jsonResult(tools.optimizationAdapterList()),
  );

  server.registerTool(
    "optimization_adapter_select",
    {
      description: "Select an installed optimization adapter by capability.",
      inputSchema: {
        capability: optimizationKindSchema,
      },
    },
    async (input) => jsonResult(tools.optimizationAdapterSelect(input)),
  );

  server.registerTool(
    "optimization_adapter_run",
    {
      description: "Run a registered optimization adapter.",
      inputSchema: {
        adapterId: z.string(),
        kind: z.union([optimizationKindSchema, z.literal("auto")]),
        content: z.string(),
        timeoutMs: z.number().optional(),
      },
    },
    async (input) => jsonResult(await tools.optimizationAdapterRun(input)),
  );

  server.registerTool(
    "optimized_command_run",
    {
      description: "Run a command through Wormhole's no-shell optimized command runner with reversible output compaction.",
      inputSchema: {
        command: z.string(),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        timeoutMs: z.number().optional(),
        stdin: z.string().optional(),
      },
    },
    async (input) => jsonResult(await tools.optimizedCommandRun(input)),
  );

  server.registerTool(
    "optimization_stats",
    {
      description: "Return aggregate Wormhole optimization and command-output savings stats.",
      inputSchema: {},
    },
    async () => jsonResult(tools.optimizationStats()),
  );

  const toolFactoryInputSchema = {
    toolId: z.string(),
    displayName: z.string(),
    description: z.string(),
    commandName: z.string(),
    capabilities: z.array(z.string()),
    inputs: z.array(
      z.object({
        name: z.string(),
        type: z.enum(["string", "number", "boolean"]),
        required: z.boolean(),
        description: z.string().optional(),
      }),
    ),
  };

  server.registerTool(
    "tool_factory_generate",
    {
      description: "Generate deterministic CLI/MCP scaffold files from a constrained tool specification.",
      inputSchema: toolFactoryInputSchema,
    },
    async (input) => jsonResult(tools.toolFactoryGenerate(input)),
  );

  const toolScaffoldSchema = {
    toolId: z.string(),
    files: z.record(z.string(), z.string()),
  };

  server.registerTool(
    "tool_factory_validate",
    {
      description: "Validate a generated CLI/MCP scaffold before writing or running it.",
      inputSchema: toolScaffoldSchema,
    },
    async (input) => jsonResult(tools.toolFactoryValidate(input)),
  );

  server.registerTool(
    "tool_factory_write",
    {
      description: "Write a generated CLI/MCP scaffold to a safe target directory.",
      inputSchema: {
        scaffold: z.object(toolScaffoldSchema),
        targetDir: z.string(),
      },
    },
    async (input) => jsonResult(tools.toolFactoryWrite(input)),
  );

  const conductorInputSchema = {
    objective: z.string(),
    risk: z.enum(["low", "medium", "high"]),
    complexity: z.enum(["low", "medium", "high"]),
    requiredStrengths: z.array(z.string()),
    modelProfileIds: z.array(z.string()),
  };

  server.registerTool(
    "conductor_plan",
    {
      description: "Create a deterministic planner/worker/verifier conductor scaffold.",
      inputSchema: conductorInputSchema,
    },
    async (input) => jsonResult(tools.conductorPlan(input)),
  );

  server.registerTool(
    "conductor_replay",
    {
      description: "Replay a deterministic conductor plan from a prior trace.",
      inputSchema: {
        traceId: z.string(),
        input: z.object(conductorInputSchema),
        scaffoldId: z.enum(["single-pass", "plan-execute-verify", "iterative-repair"]),
        reasonCodes: z.array(z.string()),
      },
    },
    async (input) => jsonResult(tools.conductorReplay(input)),
  );

  server.registerTool(
    "behavior_mode_set",
    {
      description: "Set durable Wormhole brevity and minimality policy modes.",
      inputSchema: {
        brevity: z.enum(["normal", "dense", "ultra"]).optional(),
        minimality: z.enum(["off", "review", "strict"]).optional(),
      },
    },
    async (input) => jsonResult(tools.behaviorModeSet(input)),
  );

  server.registerTool(
    "behavior_mode_get",
    {
      description: "Return current Wormhole brevity and minimality policy modes.",
      inputSchema: {},
    },
    async () => jsonResult(tools.behaviorModeGet()),
  );

  server.registerTool(
    "behavior_apply",
    {
      description: "Apply the current Wormhole brevity policy to text while preserving literals.",
      inputSchema: {
        text: z.string(),
      },
    },
    async (input) => jsonResult(tools.behaviorApply(input)),
  );

  server.registerTool(
    "behavior_minimality_review",
    {
      description: "Review a plan with the current Wormhole minimality policy.",
      inputSchema: {
        objective: z.string(),
        planSteps: z.array(z.string()),
      },
    },
    async (input) => jsonResult(tools.behaviorMinimalityReview(input)),
  );

  server.registerTool(
    "runtime_behavior_audit",
    {
      description:
        "Compare recommended Wormhole tool usage against observed runtime calls and report missing, failed, skipped, or out-of-order guidance.",
      inputSchema: {
        recommendedTools: z.array(
          z.object({
            toolName: z.string(),
            recommendationId: z.string().optional(),
            phase: z.string().optional(),
            priority: z.number().optional(),
            required: z.boolean().optional(),
            minCalls: z.number().optional(),
            after: z.array(z.string()).optional(),
            reason: z.string().optional(),
          }),
        ),
        observedToolCalls: z.array(
          z.object({
            toolName: z.string(),
            recommendationId: z.string().optional(),
            calledAt: z.string().optional(),
            status: z.enum(["ran", "skipped", "failed"]).optional(),
            reason: z.string().optional(),
          }),
        ),
        requiredTools: z.array(z.string()).optional(),
        knownToolNames: z.array(z.string()).optional(),
        ignoredToolNames: z.array(z.string()).optional(),
        scope: z.enum(["wormhole", "all"]).optional(),
      },
    },
    async (input) => jsonResult(tools.runtimeBehaviorAudit(input)),
  );

  const policyOutcomeSchema = z.object({
    testsPassed: z.boolean(),
    evidenceCount: z.number(),
    openQuestions: z.number(),
    durationMs: z.number(),
    tokenEstimate: z.number(),
    userCorrectionCount: z.number(),
    reasoningScore: z.number().min(0).max(1).optional(),
  });
  const policyActionSchema = z.object({
    workerCount: z.number(),
    verifierCount: z.number(),
    maxDepth: z.number(),
    modelProfile: z.string(),
    splitStrategy: z.enum(["single", "parallel", "sequential"]).optional(),
    contextBudget: z.enum(["small", "medium", "large"]).optional(),
    evidenceMode: z.enum(["minimal", "standard", "strict"]).optional(),
    stopRule: z.enum(["continue", "verify", "escalate"]).optional(),
  });
  const policyActivationSchema = {
    evaluationId: z.string(),
  };

  server.registerTool(
    "orchestration_trace_record",
    {
      description: "Record an orchestration trace for offline policy learning.",
      inputSchema: {
        traceId: z.string(),
        taskKind: z.string(),
        graphNodeCount: z.number(),
        evidenceCount: z.number(),
        openQuestions: z.number(),
        action: policyActionSchema,
        outcome: policyOutcomeSchema,
      },
    },
    async (input) => jsonResult(tools.orchestrationTraceRecord(input)),
  );

  server.registerTool(
    "orchestration_dataset_export",
    {
      description: "Export recorded orchestration traces as JSONL for offline learning.",
      inputSchema: {},
    },
    async () => jsonResult(tools.orchestrationDatasetExport()),
  );

  server.registerTool(
    "orchestration_policy_train",
    {
      description: "Train a deterministic offline orchestration policy through the required Python runtime.",
      inputSchema: {
        traceJsonl: z.string().max(1_000_000),
        learningRate: z.number().min(0).max(1).optional(),
        discount: z.number().optional(),
        epochs: z.number().int().min(1).max(100).optional(),
      },
    },
    async (input) => jsonResult(await tools.orchestrationPolicyTrain(input)),
  );

  server.registerTool(
    "orchestration_policy_evaluate",
    {
      description: "Evaluate candidate orchestration policy metrics and safety violations.",
      inputSchema: {
        policyJson: z.any(),
      },
    },
    async (input) => jsonResult(tools.orchestrationPolicyEvaluate(input)),
  );

  server.registerTool(
    "orchestration_policy_compare_baselines",
    {
      description: "Compare a candidate orchestration policy against deterministic safe baselines.",
      inputSchema: {
        policyJson: z.any(),
      },
    },
    async (input) => jsonResult(tools.orchestrationPolicyCompareBaselines(input)),
  );

  server.registerTool(
    "orchestration_policy_activate",
    {
      description: "Activate an orchestration policy only after replay thresholds pass.",
      inputSchema: policyActivationSchema,
    },
    async (input) => jsonResult(tools.orchestrationPolicyActivate(input)),
  );

  server.registerTool(
    "orchestration_policy_get",
    {
      description: "Return the active learned orchestration policy metadata.",
      inputSchema: {},
    },
    async () => jsonResult(tools.orchestrationPolicyGet()),
  );

  server.registerTool(
    "orchestration_policy_live_feedback",
    {
      description: "Record live orchestration feedback and return bounded advisory hints without activating policies.",
      inputSchema: {
        traceId: z.string(),
        taskKind: z.string(),
        graphNodeCount: z.number(),
        evidenceCount: z.number(),
        openQuestions: z.number(),
        action: policyActionSchema,
        outcome: policyOutcomeSchema,
      },
    },
    async (input) => jsonResult(tools.orchestrationPolicyLiveFeedback(input)),
  );

  const reasoningTraceSchema = {
    traceId: z.string(),
    strategy: z.enum(["plan-first", "critique-revise", "verify-repair"]),
    taskKind: z.string(),
    planSummary: z.string(),
    critiqueSummary: z.string().optional(),
    revisionSummary: z.string().optional(),
    verifierSummary: z.string().optional(),
    evidenceReferenced: z.number().int().min(0),
    evidenceAvailable: z.number().int().min(0),
    openQuestionsResolved: z.number().int().min(0),
    openQuestionsRemaining: z.number().int().min(0),
    outcome: z.enum(["succeeded", "partial", "failed"]),
    userCorrections: z.number().int().min(0),
  };

  server.registerTool(
    "reasoning_trace_record",
    {
      description: "Record a scored reasoning trace for plan, critique, revision, and verifier research.",
      inputSchema: reasoningTraceSchema,
    },
    async (input) => jsonResult(tools.reasoningTraceRecord(input)),
  );

  server.registerTool(
    "reasoning_dataset_export",
    {
      description: "Export scored reasoning traces as JSONL.",
      inputSchema: {},
    },
    async () => jsonResult(tools.reasoningDatasetExport()),
  );

  server.registerTool(
    "reasoning_strategy_evaluate",
    {
      description: "Evaluate reasoning strategies and recommend supported winners from observed traces.",
      inputSchema: {},
    },
    async () => jsonResult(tools.reasoningStrategyEvaluate()),
  );

  return server;
}
