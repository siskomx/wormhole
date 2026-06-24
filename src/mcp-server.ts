import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WormholeKernel } from "./kernel.js";
import { createToolHandlers } from "./tools.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

function jsonResult(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function createWormholeMcpServer(kernel: WormholeKernel): McpServer {
  const server = new McpServer({
    name: "wormhole",
    version: "0.1.0",
  });
  const tools = createToolHandlers(kernel);
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

  return server;
}
