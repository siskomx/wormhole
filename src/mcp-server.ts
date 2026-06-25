import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WormholeKernel } from "./kernel.js";
import { createToolHandlers, type ToolHandlerOptions } from "./tools.js";

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
    version: "0.1.0",
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
  const optimizationAdapterSchema = z.object({
    adapterId: z.string(),
    transport: z.enum(["native", "cli", "http"]),
    capabilities: z.array(optimizationKindSchema),
    installation: z.enum(["installed", "available", "disabled"]),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    endpoint: z.string().optional(),
  });

  server.registerTool(
    "mission_start",
    {
      description: "Start an existing-repo planning mission.",
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
      description: "Evaluate whether the mission can emit its final plan.",
      inputSchema: {
        missionId: z.string(),
      },
    },
    async (input) => jsonResult(tools.gateRequest(input)),
  );

  server.registerTool(
    "emit_plan",
    {
      description: "Emit the final evidence-cited Markdown plan after the gate opens.",
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
      description: "Probe the optional Python sidecar runtime and report availability.",
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
      description: "Run optional Python graph metrics over caller-supplied Wormhole graph nodes and edges.",
      inputSchema: pythonGraphPayloadSchema,
    },
    async (input) => jsonResult(await tools.pythonGraphMetrics(input)),
  );

  server.registerTool(
    "python_graph_communities",
    {
      description: "Run optional Python community analysis over caller-supplied Wormhole graph nodes and edges.",
      inputSchema: pythonGraphPayloadSchema,
    },
    async (input) => jsonResult(await tools.pythonGraphCommunities(input)),
  );

  server.registerTool(
    "python_trace_summary",
    {
      description: "Run optional Python analysis over model-profile route traces and outcomes.",
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
      description: "Report optional Python media extraction dependency availability.",
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
        diagnostics: z.array(
          z.object({
            range: z.object({
              start: z.object({ line: z.number(), character: z.number() }),
              end: z.object({ line: z.number(), character: z.number() }).optional(),
            }),
            severity: z.number().optional(),
            code: z.union([z.string(), z.number()]).optional(),
            source: z.string().optional(),
            message: z.string(),
          }),
        ),
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
    "durable_repo_index_refresh",
    {
      description: "Refresh and persist the repo index under .wormhole/indexes.",
      inputSchema: {
        repoRoot: z.string(),
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
      description: "Return durable repo and semantic index cache status.",
      inputSchema: {
        repoRoot: z.string(),
      },
    },
    async (input) => jsonResult(tools.durableIndexStatus(input)),
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
      description: "Create a deterministic Fugu-near planner/worker/verifier conductor scaffold.",
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
      description: "Train a deterministic offline orchestration policy through the optional Python sidecar.",
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
