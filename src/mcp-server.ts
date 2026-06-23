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
            transport: z.enum(["mcp-stdio", "plugin-manifest", "http", "connector-contract"]),
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

  return server;
}
