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
        status: z.enum([
          "registered",
          "running",
          "blocked",
          "needs_input",
          "paused",
          "interrupted",
          "completed",
          "failed",
        ]),
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

  return server;
}
