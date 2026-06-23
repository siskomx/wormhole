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

  return server;
}
