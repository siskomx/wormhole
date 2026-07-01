import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDefaultKernel, createDefaultToolHandlerOptions } from "../src/runtime.js";
import { createToolHandlers } from "../src/tools.js";
import { createPrivilegedActionGate } from "../src/privileged-action-gate.js";
import { TOOL_REGISTRY } from "../src/tool-registry.js";
import { classifyDogfoodResult } from "./dogfood-result.js";

type HandlerMap = Map<string, string>;
type ToolHandlers = Record<string, (input?: unknown) => unknown>;
type DogfoodStatus = "called" | "guarded" | "failed";

type DogfoodDisposition = {
  status: "called" | "guarded";
  detail?: unknown;
};

type DogfoodResult = {
  toolName: string;
  handlerName?: string;
  status: DogfoodStatus;
  durationMs: number;
  detail?: unknown;
  error?: string;
};

type DogfoodContext = {
  repoRoot: string;
  scratchRoot: string;
  reportRoot: string;
  tools: ToolHandlers;
  handlerMap: HandlerMap;
  state: Record<string, unknown>;
};

type DogfoodCase = {
  toolName: string;
  run: (context: DogfoodContext) => Promise<DogfoodDisposition | unknown> | DogfoodDisposition | unknown;
};

const actualRepoRoot = path.resolve(process.cwd());
const reportRoot = path.join(actualRepoRoot, ".wormhole", "dogfood");
const scratchRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-self-dogfood-"));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const progressPath = path.join(reportRoot, "latest-progress.json");

const APPROVED_DOGFOOD_TOOLS = [
  "agent_dispatch_execute",
  "app_process_accept_section",
  "app_process_continue",
  "app_process_record_verification",
  "app_process_write_artifacts",
  "blueprint_write_artifacts",
  "domain_manifest_apply",
  "graph_communities_refresh",
  "graph_node_semantic_index_refresh",
  "graph_wiki_generate",
  "flows_refresh",
  "optimized_command_run",
  "optimization_adapter_run",
  "patch_apply",
  "patch_rollback",
  "printing_press_run",
  "resume_checkpoint",
  "repo_graph_refresh_full",
  "repo_graph_refresh_incremental",
  "shell_hook_plan",
  "state_maintenance_run",
  "tool_factory_write",
  "verification_run",
  "workflow_write_artifacts",
] as const;

const GUARDED_REASONS: Record<string, string> = {
  dependency_audit_live:
    "Runs live npm audit/outdated and can depend on network and registry availability; offline dependency_risk_report is called instead.",
  discovery_http_crawl:
    "Performs live HTTP crawling; deterministic HAR/OpenAPI import and browser unavailable handling are called instead.",
  git_branch_create:
    "Creates or checks out git branches; git_branch_prepare and git_lifecycle_status cover the safe path in this dogfood run.",
  git_commit_create:
    "Creates commits in the active repository; git_commit_prepare covers the safe path in this dogfood run.",
  lsp_session_request:
    "Requires a live LSP session. lsp_probe, lsp_server_configs, lsp_normalize_location, and graph-only symbol_context are called instead.",
  lsp_session_start:
    "Starts a host language-server process. This dogfood run avoids persistent host child processes.",
  lsp_session_status:
    "Requires a live LSP session id from lsp_session_start, which is guarded in this run.",
  lsp_session_stop:
    "Requires a live LSP session id from lsp_session_start, which is guarded in this run.",
  media_ingest_pdf:
    "Requires a real PDF fixture and optional media dependencies. media_dependency_report and media_ingest_image are called instead.",
  shell_hook_install:
    "Writes shell profile files; shell_hook_plan and shell_hook_verify cover the safe host path.",
  shell_hook_uninstall:
    "Writes shell profile files; shell_hook_plan and shell_hook_verify cover the safe host path.",
};

function called(detail?: unknown): DogfoodDisposition {
  return { status: "called", detail };
}

function guarded(detail: unknown): DogfoodDisposition {
  return { status: "guarded", detail };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stableHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function loadHandlerMap(repoRoot: string): HandlerMap {
  const source = readFileSync(path.join(repoRoot, "src", "mcp-server.ts"), "utf8");
  const regex =
    /server\.registerTool\(\s*["']([^"']+)["'][\s\S]*?jsonResult\((?:await\s+)?tools\.([A-Za-z0-9_]+)\(/g;
  const map: HandlerMap = new Map();
  for (const match of source.matchAll(regex)) {
    map.set(match[1] ?? "", match[2] ?? "");
  }
  return map;
}

async function invoke(context: DogfoodContext, toolName: string, input?: unknown): Promise<unknown> {
  const handlerName = context.handlerMap.get(toolName);
  if (!handlerName) {
    throw new Error(`No MCP handler mapping found for ${toolName}`);
  }
  const handler = context.tools[handlerName];
  if (typeof handler !== "function") {
    throw new Error(`Handler ${handlerName} for ${toolName} is not available`);
  }
  return input === undefined ? await handler() : await handler(input);
}

function buildScheduledTasks() {
  return [
    {
      taskId: "inspect",
      objective: "Inspect Wormhole self-test scope",
      layer: 2 as const,
      dependencies: [],
      readSet: ["src/tools.ts"],
      writeSet: [],
    },
    {
      taskId: "verify",
      objective: "Verify Wormhole self-test scope",
      layer: 3 as const,
      dependencies: ["inspect"],
      readSet: ["tests/tools.test.ts"],
      writeSet: [],
    },
  ];
}

function createTinyImage(root: string): string {
  const imagePath = path.join(root, "tiny.png");
  writeFileSync(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGNgYPgPAAEDAQDq1X4bAAAAAElFTkSuQmCC",
      "base64",
    ),
  );
  return imagePath;
}

function commandTrace() {
  return {
    traceId: "dogfood-trace-1",
    taskKind: "feature",
    graphNodeCount: 250,
    evidenceCount: 4,
    openQuestions: 0,
    action: {
      workerCount: 2,
      verifierCount: 1,
      maxDepth: 3,
      modelProfile: "balanced",
      splitStrategy: "parallel" as const,
      contextBudget: "large" as const,
      evidenceMode: "strict" as const,
      stopRule: "verify" as const,
    },
    outcome: {
      testsPassed: true,
      evidenceCount: 4,
      openQuestions: 0,
      durationMs: 1_000,
      tokenEstimate: 2_000,
      userCorrectionCount: 0,
      reasoningScore: 0.9,
    },
  };
}

function orchestrationTrace(index: number) {
  return {
    ...commandTrace(),
    traceId: `dogfood-trace-${index}`,
  };
}

function passingPolicyJson() {
  return {
    policyId: "dogfood-policy",
    qTable: {
      "feature|graph:medium|evidence:medium|risk:low": {
        "workers=2|verifiers=1|depth=3|model=balanced|split=parallel|context=large|evidence=strict|stop=verify": 1,
      },
    },
  };
}

async function seedOrchestrationPolicyTraces(context: DogfoodContext): Promise<void> {
  if (context.state.policyTracesSeeded) {
    return;
  }
  for (let index = 0; index < 60; index += 1) {
    await invoke(context, "orchestration_trace_record", orchestrationTrace(index));
  }
  context.state.policyTracesSeeded = true;
}

const cases: DogfoodCase[] = [
  {
    toolName: "mission_start",
    run: async (context) => {
      const mission = asObject(
        await invoke(context, "mission_start", {
          objective: "Clean-state Wormhole dogfood self-test",
          repoRoot: context.repoRoot,
        }),
      );
      context.state.missionId = mission.missionId;
      return called({ missionId: mission.missionId });
    },
  },
  {
    toolName: "round_start",
    run: async (context) => invoke(context, "round_start", { missionId: context.state.missionId }),
  },
  {
    toolName: "record_evidence",
    run: async (context) => {
      const evidence = asObject(
        await invoke(context, "record_evidence", {
          missionId: context.state.missionId,
          sourceType: "file",
          sourcePath: "package.json",
          retrievalMethod: "readFileSync",
          summary: "package.json declares the Wormhole package metadata and scripts.",
        }),
      );
      context.state.evidenceId = evidence.evidenceId;
      return called({ evidenceId: evidence.evidenceId });
    },
  },
  {
    toolName: "record_question",
    run: async (context) => {
      const question = asObject(
        await invoke(context, "record_question", {
          missionId: context.state.missionId,
          question: "Which Wormhole capabilities need clean-state dogfood coverage?",
          blocking: false,
          rationale: "The self-test should report coverage gaps without blocking basic verification.",
        }),
      );
      context.state.questionId = question.questionId;
      return called({ questionId: question.questionId });
    },
  },
  {
    toolName: "update_question",
    run: async (context) =>
      invoke(context, "update_question", {
        missionId: context.state.missionId,
        questionId: context.state.questionId,
        status: "accepted_as_assumption",
        assumptionFallback: "Exercise all registered tools through called or guarded dispositions.",
      }),
  },
  {
    toolName: "task_register",
    run: async (context) => {
      const task = asObject(
        await invoke(context, "task_register", {
          missionId: context.state.missionId,
          layer: 2,
          name: "Dogfood Harness",
          objective: "Exercise the Wormhole tool surface on Wormhole.",
          assignedTo: "codex",
        }),
      );
      context.state.taskId = task.taskId;
      return called({ taskId: task.taskId });
    },
  },
  {
    toolName: "task_status_report",
    run: async (context) =>
      invoke(context, "task_status_report", {
        missionId: context.state.missionId,
        taskId: context.state.taskId,
        status: "running",
        summary: "Dogfood harness is running clean-state capability checks.",
        touchedPaths: ["scripts/dogfood-selftest.ts"],
      }),
  },
  {
    toolName: "control_message",
    run: async (context) => {
      const message = asObject(
        await invoke(context, "control_message", {
          missionId: context.state.missionId,
          targetTaskId: context.state.taskId,
          mode: "advisory",
          content: "Keep host-mutating actions guarded unless isolated.",
          sender: "dogfood",
          ackRequired: true,
        }),
      );
      context.state.messageId = message.messageId;
      return called({ messageId: message.messageId });
    },
  },
  {
    toolName: "control_ack",
    run: async (context) =>
      invoke(context, "control_ack", {
        missionId: context.state.missionId,
        taskId: context.state.taskId,
        messageId: context.state.messageId,
        acknowledgedBy: "dogfood",
        response: "Acknowledged.",
      }),
  },
  {
    toolName: "task_inbox",
    run: async (context) =>
      invoke(context, "task_inbox", {
        missionId: context.state.missionId,
        taskId: context.state.taskId,
        includeAcknowledged: true,
      }),
  },
  {
    toolName: "task_status",
    run: async (context) =>
      invoke(context, "task_status", {
        missionId: context.state.missionId,
        taskId: context.state.taskId,
      }),
  },
  {
    toolName: "claim_record",
    run: async (context) => {
      const claim = asObject(
        await invoke(context, "claim_record", {
          kind: "script_exists",
          subject: "package.json",
          predicate: "declares",
          object: "test",
          claimText: "Wormhole package.json declares an npm test script.",
          producer: { toolName: "dogfood_selftest", missionId: String(context.state.missionId) },
          evidenceIds: [String(context.state.evidenceId)],
          evidenceAnchors: [{ sourcePath: "package.json", toolName: "record_evidence" }],
          invalidationKeys: [{ kind: "file", value: "package.json" }],
          status: "unverified",
        }),
      );
      context.state.claimId = claim.claimId;
      return called({ claimId: claim.claimId });
    },
  },
  {
    toolName: "claim_search",
    run: async (context) =>
      invoke(context, "claim_search", {
        claimIds: [context.state.claimId],
        limit: 5,
      }),
  },
  {
    toolName: "claim_verify",
    run: async (context) =>
      invoke(context, "claim_verify", {
        claimId: context.state.claimId,
        status: "supported",
        evidenceIds: [context.state.evidenceId],
      }),
  },
  {
    toolName: "claim_invalidate",
    run: async (context) =>
      invoke(context, "claim_invalidate", {
        changedFiles: ["package.json"],
        reason: "Dogfood invalidation check after package metadata evidence.",
      }),
  },
  {
    toolName: "gate_request",
    run: async (context) =>
      invoke(context, "gate_request", {
        missionId: context.state.missionId,
        claimChecks: { claimIds: [context.state.claimId], enforce: false },
      }),
  },
  {
    toolName: "emit_plan",
    run: async (context) =>
      invoke(context, "emit_plan", {
        missionId: context.state.missionId,
        recommendedApproach: "Run clean-state repo intelligence before trusting stale artifacts.",
        implementationSteps: ["Archive old .wormhole", "Run dogfood harness", "Review guarded tools"],
        risks: ["Host-mutating capabilities must remain guarded"],
        verificationPlan: ["npm test", "npm run dogfood:selftest"],
      }),
  },
  {
    toolName: "mission_status",
    run: async (context) => invoke(context, "mission_status", { missionId: context.state.missionId }),
  },
  {
    toolName: "optimize_text",
    run: async (context) =>
      invoke(context, "optimize_text", {
        kind: "dense_summary",
        content: "Dogfood self-test keeps raw evidence separate from compact summaries.",
      }),
  },
  {
    toolName: "optimization_apply",
    run: async (context) => {
      const result = asObject(
        await invoke(context, "optimization_apply", {
          kind: "auto",
          content: JSON.stringify({ dogfood: true, output: "compact this content" }),
          sourceId: "dogfood",
        }),
      );
      context.state.retrievalId = result.retrievalId;
      return called({ retrievalId: result.retrievalId });
    },
  },
  {
    toolName: "optimization_retrieve",
    run: async (context) =>
      invoke(context, "optimization_retrieve", {
        retrievalId: context.state.retrievalId,
      }),
  },
  {
    toolName: "ctx_record",
    run: async (context) => {
      const record = asObject(
        await invoke(context, "ctx_record", {
          source: "src/tools.ts",
          sourceType: "file",
          text: "createToolHandlers exposes Wormhole tool handlers for the MCP server.",
          tags: ["dogfood", "tools"],
        }),
      );
      context.state.contextId = record.contextId;
      return called({ contextId: record.contextId });
    },
  },
  {
    toolName: "ctx_pack_query",
    run: async (context) => invoke(context, "ctx_pack_query", { query: "tool handlers", limit: 3 }),
  },
  {
    toolName: "ctx_pack_create",
    run: async (context) => {
      const pack = asObject(
        await invoke(context, "ctx_pack_create", {
          objective: "Dogfood Wormhole",
          query: "tool handlers",
          maxChars: 800,
        }),
      );
      context.state.packId = pack.packId;
      return called({ packId: pack.packId });
    },
  },
  {
    toolName: "ctx_pack_budget_review",
    run: async (context) =>
      invoke(context, "ctx_pack_budget_review", {
        objective: "Dogfood Wormhole",
        query: "tool handlers",
        maxChars: 800,
        recordIds: [context.state.contextId],
      }),
  },
  {
    toolName: "ctx_pack_refresh",
    run: async (context) =>
      invoke(context, "ctx_pack_refresh", {
        packId: context.state.packId,
        query: "Wormhole MCP handlers",
        maxChars: 800,
      }),
  },
  {
    toolName: "ctx_pack_render",
    run: async (context) => invoke(context, "ctx_pack_render", { packId: context.state.packId }),
  },
  {
    toolName: "resume_record",
    run: async (context) =>
      invoke(context, "resume_record", {
        repoRoot: context.repoRoot,
        objective: "Clean-state Wormhole dogfood self-test",
        kind: "exact_next_action",
        summary: "Run and inspect dogfood self-test report.",
        missionId: context.state.missionId,
        trust: "canonical",
        evidenceIds: [context.state.evidenceId],
        contextPackIds: [context.state.packId],
      }),
  },
  {
    toolName: "resume_checkpoint",
    run: async (context) =>
      invoke(context, "resume_checkpoint", {
        repoRoot: context.repoRoot,
        objective: "Clean-state Wormhole dogfood self-test",
        missionId: context.state.missionId,
        reason: "Dogfood checkpoint",
        maxRecords: 5,
        includeTrust: ["scratch", "handoff", "canonical"],
      }),
  },
  {
    toolName: "resume_validate",
    run: async (context) => invoke(context, "resume_validate", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "resume_load",
    run: async (context) => invoke(context, "resume_load", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "cache_evidence",
    run: async (context) =>
      invoke(context, "cache_evidence", {
        cacheRoot: path.join(context.repoRoot, ".wormhole", "dogfood", "evidence-cache"),
        repoRoot: context.repoRoot,
        content: "Dogfood cached evidence content.",
        mediaType: "text/plain",
        source: "dogfood-selftest",
      }),
  },
  {
    toolName: "schedule_tasks",
    run: async (context) => invoke(context, "schedule_tasks", { tasks: buildScheduledTasks() }),
  },
  {
    toolName: "orchestration_plan_local",
    run: async (context) =>
      invoke(context, "orchestration_plan_local", {
        missionId: context.state.missionId,
        tasks: buildScheduledTasks(),
        maxDepth: 3,
        maxTasks: 4,
      }),
  },
  {
    toolName: "orchestration_run_local",
    run: async (context) =>
      invoke(context, "orchestration_run_local", {
        missionId: context.state.missionId,
        tasks: buildScheduledTasks(),
        maxDepth: 3,
        maxTasks: 4,
        outcomes: [
          { taskId: "inspect", status: "completed", output: "inspected" },
          { taskId: "verify", status: "completed", output: "verified" },
        ],
      }),
  },
  {
    toolName: "reconcile_artifacts",
    run: async (context) =>
      invoke(context, "reconcile_artifacts", {
        proposals: [
          {
            artifactId: "dogfood-plan",
            taskId: "inspect",
            summary: "Dogfood plan artifact.",
            evidenceIds: [String(context.state.evidenceId)],
            readSet: ["src/tools.ts"],
            writeSet: [".wormhole/dogfood"],
            risks: [],
          },
        ],
      }),
  },
  {
    toolName: "route_mission",
    run: async (context) =>
      invoke(context, "route_mission", {
        taskCategory: "large-repo self-test",
        ambiguity: "medium",
        risk: "medium",
        repoSize: "large",
        requiresPrivacy: true,
        models: [
          {
            providerId: "local",
            modelId: "local-coder",
            strengths: ["coding", "analysis"],
            maxDepth: 3,
            costTier: "low",
            privacy: "local",
          },
        ],
      }),
  },
  {
    toolName: "codex_adapter_config",
    run: async (context) => invoke(context, "codex_adapter_config", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "select_connector",
    run: async (context) =>
      invoke(context, "select_connector", {
        connectors: [
          {
            connectorId: "codex",
            target: "local",
            transport: "plugin-manifest",
            capabilities: ["coding", "evidence"],
            installation: "installed",
            authentication: "none",
          },
        ],
        target: "local",
        requiredCapabilities: ["coding"],
      }),
  },
  {
    toolName: "create_artifact",
    run: async (context) => {
      const artifact = asObject(
        await invoke(context, "create_artifact", {
          missionId: context.state.missionId,
          type: "html_workbench",
          title: "Dogfood Workbench",
          content: "<main>dogfood</main>",
          evidenceIds: [context.state.evidenceId],
          taskIds: [context.state.taskId],
        }),
      );
      context.state.artifactId = artifact.artifactId;
      return called({ artifactId: artifact.artifactId });
    },
  },
  {
    toolName: "render_workbench",
    run: async (context) =>
      invoke(context, "render_workbench", {
        mission: {
          missionId: context.state.missionId,
          objective: "Clean-state Wormhole dogfood self-test",
          repoRoot: context.repoRoot,
        },
        tasks: [
          {
            taskId: context.state.taskId,
            name: "Dogfood Harness",
            status: "running",
            currentFlow: "Exercising tool surface",
          },
        ],
        gate: { open: false, reasons: [] },
        artifacts: [
          {
            artifactId: context.state.artifactId,
            type: "html_workbench",
            title: "Dogfood Workbench",
          },
        ],
      }),
  },
  {
    toolName: "repo_index_build",
    run: async (context) =>
      invoke(context, "repo_index_build", {
        repoRoot: context.repoRoot,
        preset: "large_repo",
        exclude: ["node_modules", "dist"],
      }),
  },
  {
    toolName: "repo_index_query",
    run: async (context) =>
      invoke(context, "repo_index_query", {
        repoRoot: context.repoRoot,
        query: "createToolHandlers",
        limit: 5,
      }),
  },
  {
    toolName: "repo_index_explain",
    run: async (context) =>
      invoke(context, "repo_index_explain", {
        repoRoot: context.repoRoot,
        target: "src/tools.ts",
      }),
  },
  {
    toolName: "repo_index_path",
    run: async (context) =>
      invoke(context, "repo_index_path", {
        repoRoot: context.repoRoot,
        from: "src/mcp-server.ts",
        to: "src/tools.ts",
      }),
  },
  {
    toolName: "repo_index_report",
    run: async (context) => invoke(context, "repo_index_report", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "repo_graph_analyze",
    run: async (context) =>
      invoke(context, "repo_graph_analyze", {
        repoRoot: context.repoRoot,
        changedFiles: ["src/tools.ts"],
      }),
  },
  {
    toolName: "repo_graph_export",
    run: async (context) =>
      invoke(context, "repo_graph_export", {
        repoRoot: context.repoRoot,
        communities: [{ id: "dogfood-core", members: ["src/tools.ts", "src/mcp-server.ts"] }],
      }),
  },
  {
    toolName: "graph_communities_refresh",
    run: async (context) => invoke(context, "graph_communities_refresh", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "list_communities",
    run: async (context) => invoke(context, "list_communities", { repoRoot: context.repoRoot, limit: 5 }),
  },
  {
    toolName: "get_community",
    run: async (context) => {
      const listed = asObject(await invoke(context, "list_communities", { repoRoot: context.repoRoot, limit: 1 }));
      const communities = Array.isArray(listed.communities) ? listed.communities : [];
      const first = asObject(communities[0]);
      const id = stringValue(first.id, "");
      if (!id) {
        return guarded("No graph community was available after refresh.");
      }
      return invoke(context, "get_community", { repoRoot: context.repoRoot, id });
    },
  },
  {
    toolName: "get_surprising_connections",
    run: async (context) => invoke(context, "get_surprising_connections", { repoRoot: context.repoRoot, limit: 5 }),
  },
  {
    toolName: "graph_wiki_generate",
    run: async (context) => invoke(context, "graph_wiki_generate", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "graph_node_semantic_index_refresh",
    run: async (context) => invoke(context, "graph_node_semantic_index_refresh", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "graph_node_semantic_search",
    run: async (context) =>
      invoke(context, "graph_node_semantic_search", {
        repoRoot: context.repoRoot,
        query: "tool registry",
        kinds: ["file", "symbol"],
        limit: 5,
      }),
  },
  {
    toolName: "flows_refresh",
    run: async (context) => invoke(context, "flows_refresh", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "list_flows",
    run: async (context) => invoke(context, "list_flows", { repoRoot: context.repoRoot, query: "tools", limit: 5 }),
  },
  {
    toolName: "get_flow",
    run: async (context) => {
      const listed = asObject(await invoke(context, "list_flows", { repoRoot: context.repoRoot, limit: 1 }));
      const flows = Array.isArray(listed.flows) ? listed.flows : [];
      const first = asObject(flows[0]);
      const idOrName = stringValue(first.id, stringValue(first.name, ""));
      if (!idOrName) {
        return guarded("No execution flow was available after refresh.");
      }
      return invoke(context, "get_flow", { repoRoot: context.repoRoot, idOrName });
    },
  },
  {
    toolName: "repo_watch_start",
    run: async (context) => {
      const watch = asObject(
        await invoke(context, "repo_watch_start", {
          repoRoot: context.repoRoot,
          include: ["src/**/*.ts", "tests/**/*.ts"],
          autoRecord: false,
          autoRefreshGraph: false,
        }),
      );
      context.state.watchId = watch.watchId;
      return called({ watchId: watch.watchId });
    },
  },
  {
    toolName: "repo_watch_scan",
    run: async (context) => invoke(context, "repo_watch_scan", { watchId: context.state.watchId }),
  },
  {
    toolName: "repo_watch_status",
    run: async (context) => invoke(context, "repo_watch_status", { watchId: context.state.watchId }),
  },
  {
    toolName: "repo_watch_stop",
    run: async (context) => invoke(context, "repo_watch_stop", { watchId: context.state.watchId }),
  },
  {
    toolName: "repo_change_scan",
    run: async (context) => invoke(context, "repo_change_scan", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "repo_activity_record",
    run: async (context) =>
      invoke(context, "repo_activity_record", {
        repoRoot: context.repoRoot,
        kind: "note",
        summary: "Dogfood self-test recorded repo activity.",
      }),
  },
  {
    toolName: "repo_graph_refresh_incremental",
    run: async (context) =>
      invoke(context, "repo_graph_refresh_incremental", {
        repoRoot: context.repoRoot,
        changedFiles: ["src/tools.ts"],
      }),
  },
  {
    toolName: "repo_graph_refresh_full",
    run: async (context) =>
      invoke(context, "repo_graph_refresh_full", {
        repoRoot: context.repoRoot,
        changedFiles: ["src/tools.ts"],
      }),
  },
  {
    toolName: "repo_relation_query",
    run: async (context) =>
      invoke(context, "repo_relation_query", {
        repoRoot: context.repoRoot,
        from: "src/mcp-server.ts",
        to: "src/tools.ts",
        maxDepth: 3,
      }),
  },
  {
    toolName: "repo_intelligence_search",
    run: async (context) =>
      invoke(context, "repo_intelligence_search", {
        repoRoot: context.repoRoot,
        query: "claim ledger tool handlers",
        limit: 5,
        requireFresh: false,
      }),
  },
  {
    toolName: "project_contract_detect",
    run: async (context) => invoke(context, "project_contract_detect", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "source_conflicts_analyze",
    run: async (context) =>
      invoke(context, "source_conflicts_analyze", {
        repoRoot: context.repoRoot,
        changedFiles: ["src/tools.ts"],
      }),
  },
  {
    toolName: "capability_relation_audit",
    run: async (context) => invoke(context, "capability_relation_audit", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "dependency_inventory",
    run: async (context) => invoke(context, "dependency_inventory", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "project_command_map",
    run: async (context) => invoke(context, "project_command_map", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "diagnostics_from_command",
    run: async (context) =>
      invoke(context, "diagnostics_from_command", {
        source: "dogfood",
        output: "src/tools.ts(1,1): error TS1000: dogfood diagnostic",
      }),
  },
  {
    toolName: "diagnostics_from_lsp",
    run: async (context) =>
      invoke(context, "diagnostics_from_lsp", {
        uri: `file://${path.join(context.repoRoot, "src", "tools.ts").replace(/\\/g, "/")}`,
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 } },
            severity: 2,
            source: "dogfood",
            message: "Dogfood warning.",
          },
        ],
      }),
  },
  {
    toolName: "diagnostics_record",
    run: async (context) =>
      invoke(context, "diagnostics_record", {
        diagnostics: [
          {
            diagnosticId: "dogfood-diagnostic-1",
            source: "dogfood",
            severity: "warning",
            message: "Dogfood diagnostic record.",
            file: "src/tools.ts",
            recordedAt: new Date().toISOString(),
          },
        ],
      }),
  },
  {
    toolName: "diagnostics_query",
    run: async (context) => invoke(context, "diagnostics_query", { file: "src/tools.ts" }),
  },
  {
    toolName: "lsp_feedback_replan",
    run: async (context) =>
      invoke(context, "lsp_feedback_replan", {
        missionId: context.state.missionId,
        uri: `file://${path.join(context.repoRoot, "src", "tools.ts").replace(/\\/g, "/")}`,
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 } },
            severity: 2,
            source: "dogfood",
            message: "Dogfood LSP feedback.",
          },
        ],
        maxContextChars: 1_000,
      }),
  },
  {
    toolName: "impact_analyze",
    run: async (context) =>
      invoke(context, "impact_analyze", {
        repoRoot: context.repoRoot,
        changedFiles: ["src/tools.ts"],
      }),
  },
  {
    toolName: "change_impact_analyze",
    run: async (context) =>
      invoke(context, "change_impact_analyze", {
        repoRoot: context.repoRoot,
        changedFiles: ["src/tools.ts"],
        maxDepth: 2,
      }),
  },
  {
    toolName: "test_plan_select",
    run: async (context) =>
      invoke(context, "test_plan_select", {
        repoRoot: context.repoRoot,
        changedFiles: ["src/tools.ts"],
        tier: "focused",
      }),
  },
  {
    toolName: "verification_run",
    run: async (context) =>
      invoke(context, "verification_run", {
        commands: [
          {
            name: "node-smoke",
            command: process.execPath,
            args: ["-e", "console.log('wormhole dogfood verification')"],
            cwd: context.repoRoot,
            timeoutMs: 10_000,
            tier: "smoke",
          },
        ],
      }),
  },
  {
    toolName: "secret_scan",
    run: async (context) =>
      invoke(context, "secret_scan", {
        source: "inline",
        text: "DOGFOOD_TOKEN=not-a-real-secret",
      }),
  },
  {
    toolName: "operation_risk_review",
    run: async (context) =>
      invoke(context, "operation_risk_review", {
        command: "npm",
        args: ["test"],
      }),
  },
  {
    toolName: "semantic_index_build",
    run: async (context) => {
      const index = await invoke(context, "semantic_index_build", {
        records: [
          {
            id: "tools",
            path: "src/tools.ts",
            text: "createToolHandlers connects Wormhole runtime tools.",
          },
        ],
      });
      context.state.semanticIndex = index;
      return called();
    },
  },
  {
    toolName: "semantic_search",
    run: async (context) =>
      invoke(context, "semantic_search", {
        index: context.state.semanticIndex,
        query: "runtime tools",
        limit: 3,
      }),
  },
  {
    toolName: "lsp_probe",
    run: async (context) => invoke(context, "lsp_probe", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "lsp_server_configs",
    run: async (context) => invoke(context, "lsp_server_configs", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "lsp_normalize_location",
    run: async (context) =>
      invoke(context, "lsp_normalize_location", {
        uri: `file://${path.join(context.repoRoot, "src", "tools.ts").replace(/\\/g, "/")}`,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
      }),
  },
  {
    toolName: "symbol_context",
    run: async (context) =>
      invoke(context, "symbol_context", {
        repoRoot: context.repoRoot,
        file: "src/tools.ts",
        symbol: "createToolHandlers",
        aspects: [],
        includeReferences: false,
      }),
  },
  {
    toolName: "project_onboard",
    run: async (context) =>
      invoke(context, "project_onboard", {
        repoRoot: context.repoRoot,
        changedFiles: ["src/tools.ts"],
        diffText: "@@ -1,1 +1,1 @@\n-import path from \"node:path\";\n+import path from \"node:path\";\n",
        maxChangedSymbols: 50,
        semanticRecords: [
          {
            id: "dogfood-tools",
            path: "src/tools.ts",
            text: "Wormhole tool handlers are the primary runtime surface.",
          },
        ],
        semanticQuery: "tool handlers",
      }),
  },
  {
    toolName: "repo_native_pack_build",
    run: async (context) =>
      invoke(context, "repo_native_pack_build", {
        repoRoot: context.repoRoot,
        objective: "Dogfood Wormhole",
        query: "claim ledger",
        changedFiles: ["src/tools.ts"],
        diffText: "@@ -1,1 +1,1 @@\n-import path from \"node:path\";\n+import path from \"node:path\";\n",
        maxChangedSymbols: 50,
        limit: 5,
      }),
  },
  {
    toolName: "feature_slice_query",
    run: async (context) =>
      invoke(context, "feature_slice_query", {
        repoRoot: context.repoRoot,
        query: "claim ledger",
        limit: 5,
      }),
  },
  {
    toolName: "blueprint_compile_repo",
    run: async (context) => {
      const compiled = asObject(
        await invoke(context, "blueprint_compile_repo", {
          repoRoot: context.repoRoot,
          objective: "Dogfood Wormhole clean-state support system.",
        }),
      );
      context.state.blueprintConstraints = compiled.constraints;
      return compiled;
    },
  },
  {
    toolName: "blueprint_write_artifacts",
    run: async (context) =>
      invoke(context, "blueprint_write_artifacts", {
        repoRoot: context.repoRoot,
        objective: "Dogfood Wormhole clean-state support system.",
      }),
  },
  {
    toolName: "blueprint_gate_check",
    run: async (context) => {
      const constraints =
        context.state.blueprintConstraints ??
        asObject(
          await invoke(context, "blueprint_compile_repo", {
            repoRoot: context.repoRoot,
            objective: "Dogfood Wormhole clean-state support system.",
          }),
        ).constraints;
      return invoke(context, "blueprint_gate_check", {
        constraints,
        action: {
          plannedCommands: [{ command: "npm", args: ["test"] }],
          completionClaim: true,
          reportedVerification: [{ command: "npm", args: ["test"], status: "passed" }],
        },
      });
    },
  },
  {
    toolName: "app_process_compile",
    run: async (context) => {
      const compiled = asObject(
        await invoke(context, "app_process_compile", {
          repoRoot: context.repoRoot,
          objective: "Build Wormhole as an AI coding-agent support system.",
        }),
      );
      context.state.appProcess = compiled.appProcess;
      return compiled;
    },
  },
  {
    toolName: "app_process_write_artifacts",
    run: async (context) =>
      invoke(context, "app_process_write_artifacts", {
        repoRoot: context.repoRoot,
        objective: "Build Wormhole as an AI coding-agent support system.",
      }),
  },
  {
    toolName: "app_process_validate",
    run: async (context) => {
      const compiled = asObject(
        await invoke(context, "app_process_compile", {
          repoRoot: context.repoRoot,
          objective: "Build Wormhole as an AI coding-agent support system.",
        }),
      );
      return invoke(context, "app_process_validate", { appProcess: compiled.appProcess });
    },
  },
  {
    toolName: "app_process_gate_check",
    run: async (context) => {
      const appProcess =
        context.state.appProcess ??
        asObject(
          await invoke(context, "app_process_compile", {
            repoRoot: context.repoRoot,
            objective: "Build Wormhole as an AI coding-agent support system.",
          }),
        ).appProcess;
      return invoke(context, "app_process_gate_check", {
        appProcess,
        action: {
          implementationClaim: true,
          acceptedDraftSections: [],
          reportedVerification: [],
        },
      });
    },
  },
  {
    toolName: "app_process_status",
    run: async (context) => invoke(context, "app_process_status", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "app_process_accept_section",
    run: async (context) => {
      for (const section of ["productDefinition", "roadmap", "backlog", "ux", "security"]) {
        await invoke(context, "app_process_accept_section", {
          repoRoot: context.repoRoot,
          section,
          acceptedBy: "dogfood",
        });
      }
      return called("Accepted required app-process sections.");
    },
  },
  {
    toolName: "app_process_continue",
    run: async (context) => invoke(context, "app_process_continue", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "app_process_record_verification",
    run: async (context) =>
      invoke(context, "app_process_record_verification", {
        repoRoot: context.repoRoot,
        command: "npm",
        args: ["test"],
        status: "passed",
        summary: "Dogfood recorded npm test baseline.",
      }),
  },
  {
    toolName: "architecture_map",
    run: async (context) => invoke(context, "architecture_map", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "entrypoint_flow_discover",
    run: async (context) => invoke(context, "entrypoint_flow_discover", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "blast_radius_analyze",
    run: async (context) =>
      invoke(context, "blast_radius_analyze", {
        repoRoot: context.repoRoot,
        changedFiles: ["src/tools.ts"],
        diffText: "@@ -1,1 +1,1 @@\n-import path from \"node:path\";\n+import path from \"node:path\";\n",
        maxChangedSymbols: 50,
      }),
  },
  {
    toolName: "context_pack_generate",
    run: async (context) =>
      invoke(context, "context_pack_generate", {
        repoRoot: context.repoRoot,
        objective: "Dogfood Wormhole",
        query: "tool handlers",
        changedFiles: ["src/tools.ts"],
        maxChars: 2_000,
        maxChangedSymbols: 50,
      }),
  },
  {
    toolName: "project_intelligence_snapshot",
    run: async (context) =>
      invoke(context, "project_intelligence_snapshot", {
        repoRoot: context.repoRoot,
        objective: "Dogfood Wormhole",
      }),
  },
  {
    toolName: "tool_layer_map",
    run: async (context) => invoke(context, "tool_layer_map"),
  },
  {
    toolName: "tool_exposure_profile",
    run: async (context) => invoke(context, "tool_exposure_profile", { mode: "layered" }),
  },
  {
    toolName: "tool_surface_audit",
    run: async (context) => invoke(context, "tool_surface_audit"),
  },
  {
    toolName: "tool_catalog_query",
    run: async (context) => invoke(context, "tool_catalog_query", { pack: "large-repo", limit: 10 }),
  },
  {
    toolName: "tool_admission_review",
    run: async (context) =>
      invoke(context, "tool_admission_review", {
        toolNames: TOOL_REGISTRY.map((tool) => tool.name),
      }),
  },
  {
    toolName: "tool_profile_list",
    run: async (context) => invoke(context, "tool_profile_list"),
  },
  {
    toolName: "tool_profile_get",
    run: async (context) => invoke(context, "tool_profile_get", { profileId: "feature-implementation" }),
  },
  {
    toolName: "tool_search",
    run: async (context) =>
      invoke(context, "tool_search", {
        query: "large repo claim evidence",
        profileId: "feature-implementation",
        limit: 10,
      }),
  },
  {
    toolName: "tool_promote",
    run: async (context) => {
      const promotion = asObject(
        await invoke(context, "tool_promote", {
          missionId: context.state.missionId,
          sessionId: "dogfood-session",
          query: "clean-state repo intelligence",
          objective: "Dogfood Wormhole",
          profileId: "feature-implementation",
          toolNames: ["repo_intelligence_search", "change_impact_analyze", "gate_request"],
        }),
      );
      context.state.promotionId = promotion.promotionId;
      return called({ promotionId: promotion.promotionId });
    },
  },
  {
    toolName: "tool_promotion_status",
    run: async (context) =>
      invoke(context, "tool_promotion_status", {
        promotionId: context.state.promotionId,
      }),
  },
  {
    toolName: "workflow_start_feature",
    run: async (context) =>
      invoke(context, "workflow_start_feature", {
        repoRoot: context.repoRoot,
        objective: "Add dogfood support",
        missionId: context.state.missionId,
        changedFiles: ["scripts/dogfood-selftest.ts"],
      }),
  },
  {
    toolName: "workflow_fix_bug",
    run: async (context) =>
      invoke(context, "workflow_fix_bug", {
        repoRoot: context.repoRoot,
        objective: "Fix dogfood failure",
        changedFiles: ["scripts/dogfood-selftest.ts"],
        diagnosticSource: "dogfood",
      }),
  },
  {
    toolName: "workflow_review_pr",
    run: async (context) =>
      invoke(context, "workflow_review_pr", {
        repoRoot: context.repoRoot,
        objective: "Review dogfood self-test",
        changedFiles: ["scripts/dogfood-selftest.ts"],
      }),
  },
  {
    toolName: "workflow_onboard_repo",
    run: async (context) =>
      invoke(context, "workflow_onboard_repo", {
        repoRoot: context.repoRoot,
        objective: "Onboard Wormhole from clean state",
        query: "tool surface",
        missionId: context.state.missionId,
      }),
  },
  {
    toolName: "workflow_plan",
    run: async (context) =>
      invoke(context, "workflow_plan", {
        repoRoot: context.repoRoot,
        objective: "Dogfood Wormhole clean-state support",
        query: "large repo support",
        changedFiles: ["src/tools.ts"],
        intent: "large_repo_query",
      }),
  },
  {
    toolName: "workflow_write_artifacts",
    run: async (context) =>
      invoke(context, "workflow_write_artifacts", {
        workflow: "workflow_onboard_repo",
        repoRoot: context.repoRoot,
        objective: "Onboard Wormhole from clean state",
        query: "tool surface",
        missionId: context.state.missionId,
      }),
  },
  {
    toolName: "next_best_tool",
    run: async (context) =>
      invoke(context, "next_best_tool", {
        objective: "Dogfood Wormhole",
        repoRoot: context.repoRoot,
        currentPhase: "gather",
      }),
  },
  {
    toolName: "mission_route",
    run: async (context) =>
      invoke(context, "mission_route", {
        objective: "Dogfood Wormhole",
        repoRoot: context.repoRoot,
        changedFiles: ["src/tools.ts"],
      }),
  },
  {
    toolName: "agent_context_prepare",
    run: async (context) =>
      invoke(context, "agent_context_prepare", {
        objective: "Dogfood Wormhole",
        repoRoot: context.repoRoot,
        query: "tool handlers",
        maxChars: 2_000,
      }),
  },
  {
    toolName: "state_maintenance_run",
    run: async (context) => {
      const run = asObject(
        await invoke(context, "state_maintenance_run", {
          repoRoot: context.repoRoot,
          missionId: context.state.missionId,
          objective: "Dogfood Wormhole",
          query: "tool handlers",
          changedFiles: ["src/tools.ts"],
          refreshGraph: false,
          sourceConflicts: true,
          freshness: true,
          recordEvidence: true,
        }),
      );
      context.state.stateMaintenanceRunId = run.runId;
      return called({ runId: run.runId, status: run.status });
    },
  },
  {
    toolName: "state_maintenance_status",
    run: async (context) =>
      invoke(context, "state_maintenance_status", {
        runId: context.state.stateMaintenanceRunId,
      }),
  },
  {
    toolName: "state_maintenance_retry",
    run: async (context) =>
      invoke(context, "state_maintenance_retry", {
        runId: context.state.stateMaintenanceRunId,
        overrides: {
          refreshGraph: false,
          sourceConflicts: false,
          freshness: true,
          recordEvidence: false,
        },
      }),
  },
  {
    toolName: "mission_delta_replan",
    run: async (context) =>
      invoke(context, "mission_delta_replan", {
        missionId: context.state.missionId,
        changedFiles: ["src/tools.ts"],
        evidenceRecords: [
          {
            evidenceId: String(context.state.evidenceId),
            sourceType: "file",
            sourcePath: "package.json",
            summary: "Package metadata evidence.",
          },
        ],
        maxContextChars: 1_000,
      }),
  },
  {
    toolName: "durable_repo_index_refresh",
    run: async (context) =>
      invoke(context, "durable_repo_index_refresh", {
        repoRoot: context.repoRoot,
        preset: "large_repo",
        exclude: ["node_modules", "dist"],
      }),
  },
  {
    toolName: "durable_index_status",
    run: async (context) => invoke(context, "durable_index_status", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "durable_index_manifest_refresh",
    run: async (context) =>
      invoke(context, "durable_index_manifest_refresh", {
        repoRoot: context.repoRoot,
        preset: "large_repo",
        exclude: ["node_modules", "dist"],
      }),
  },
  {
    toolName: "durable_index_manifest_status",
    run: async (context) => invoke(context, "durable_index_manifest_status", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "durable_repo_index_query",
    run: async (context) =>
      invoke(context, "durable_repo_index_query", {
        repoRoot: context.repoRoot,
        query: "claim ledger",
        limit: 5,
        requireFresh: false,
      }),
  },
  {
    toolName: "domain_index_refresh",
    run: async (context) => invoke(context, "domain_index_refresh", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "domain_index_status",
    run: async (context) => invoke(context, "domain_index_status", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "domain_manifest_generate",
    run: async (context) => invoke(context, "domain_manifest_generate", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "domain_manifest_diff",
    run: async (context) => {
      const diff = asObject(await invoke(context, "domain_manifest_diff", { repoRoot: context.repoRoot }));
      context.state.domainManifestBaseHash = diff.baseHash;
      context.state.domainManifestBlockers = diff.blockers;
      return called({ baseHash: diff.baseHash, blockers: diff.blockers });
    },
  },
  {
    toolName: "domain_manifest_status",
    run: async (context) => invoke(context, "domain_manifest_status", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "domain_manifest_apply",
    run: async (context) => {
      const blockers = Array.isArray(context.state.domainManifestBlockers)
        ? context.state.domainManifestBlockers
        : [];
      if (blockers.length > 0 || typeof context.state.domainManifestBaseHash !== "string") {
        return guarded({ reason: "Domain manifest candidate is not safely applicable.", blockers });
      }
      return invoke(context, "domain_manifest_apply", {
        repoRoot: context.repoRoot,
        baseHash: context.state.domainManifestBaseHash,
        refreshAfterApply: true,
      });
    },
  },
  {
    toolName: "domain_slice_query",
    run: async (context) =>
      invoke(context, "domain_slice_query", {
        repoRoot: context.repoRoot,
        feature: "claim",
        requireFresh: false,
      }),
  },
  {
    toolName: "domain_api_query",
    run: async (context) =>
      invoke(context, "domain_api_query", {
        repoRoot: context.repoRoot,
        feature: "claim",
        requireFresh: false,
      }),
  },
  {
    toolName: "domain_table_query",
    run: async (context) =>
      invoke(context, "domain_table_query", {
        repoRoot: context.repoRoot,
        table: "claims",
        requireFresh: false,
      }),
  },
  {
    toolName: "domain_index_coverage",
    run: async (context) => invoke(context, "domain_index_coverage", { repoRoot: context.repoRoot, requireFresh: false }),
  },
  {
    toolName: "domain_index_drift",
    run: async (context) => invoke(context, "domain_index_drift", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "domain_verification_gate_plan",
    run: async (context) =>
      invoke(context, "domain_verification_gate_plan", {
        repoRoot: context.repoRoot,
        feature: "claim",
        requireFresh: false,
      }),
  },
  {
    toolName: "durable_semantic_index_refresh",
    run: async (context) =>
      invoke(context, "durable_semantic_index_refresh", {
        repoRoot: context.repoRoot,
        records: [
          {
            id: "dogfood-claim-ledger",
            path: "src/claim-ledger.ts",
            text: "Claim ledger stores evidence-backed claims for gate checks.",
          },
        ],
      }),
  },
  {
    toolName: "durable_semantic_search",
    run: async (context) =>
      invoke(context, "durable_semantic_search", {
        repoRoot: context.repoRoot,
        query: "evidence backed claims",
        limit: 5,
      }),
  },
  {
    toolName: "test_impact_analyze_v2",
    run: async (context) =>
      invoke(context, "test_impact_analyze_v2", {
        repoRoot: context.repoRoot,
        changedFiles: ["src/claim-ledger.ts"],
      }),
  },
  {
    toolName: "dependency_security_report",
    run: async (context) => invoke(context, "dependency_security_report", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "git_lifecycle_status",
    run: async (context) =>
      invoke(context, "git_lifecycle_status", {
        repoRoot: context.repoRoot,
        baseRef: "origin/main",
        timeoutMs: 2_000,
      }),
  },
  {
    toolName: "git_branch_prepare",
    run: async (context) =>
      invoke(context, "git_branch_prepare", {
        objective: "dogfood self-test",
        prefix: "IQx/",
      }),
  },
  {
    toolName: "git_commit_prepare",
    run: async (context) =>
      invoke(context, "git_commit_prepare", {
        repoRoot: context.repoRoot,
        objective: "Add clean-state dogfood self-test",
        evidence: [{ sourcePath: "scripts/dogfood-selftest.ts", summary: "Dogfood script added." }],
      }),
  },
  {
    toolName: "git_pr_prepare",
    run: async (context) =>
      invoke(context, "git_pr_prepare", {
        repoRoot: context.repoRoot,
        baseRef: "origin/main",
        objective: "Add clean-state dogfood self-test",
      }),
  },
  {
    toolName: "git_conflict_analyze",
    run: async (context) => invoke(context, "git_conflict_analyze", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "dependency_risk_report",
    run: async (context) =>
      invoke(context, "dependency_risk_report", {
        repoRoot: context.repoRoot,
        auditJson: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }),
        outdatedJson: JSON.stringify({}),
      }),
  },
  {
    toolName: "docs_sync_check",
    run: async (context) =>
      invoke(context, "docs_sync_check", {
        repoRoot: context.repoRoot,
        changedFiles: ["scripts/dogfood-selftest.ts"],
        requireDocsForPublicChanges: false,
      }),
  },
  {
    toolName: "workspace_graph_analyze",
    run: async (context) => invoke(context, "workspace_graph_analyze", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "repo_reachability_analyze",
    run: async (context) =>
      invoke(context, "repo_reachability_analyze", {
        repoRoot: context.repoRoot,
        paths: ["src/tools.ts", "src/mcp-server.ts"],
        limit: 10,
      }),
  },
  {
    toolName: "code_smell_scan",
    run: async (context) =>
      invoke(context, "code_smell_scan", {
        repoRoot: context.repoRoot,
        changedFiles: ["scripts/dogfood-selftest.ts"],
        maxComplexity: 40,
      }),
  },
  {
    toolName: "diff_scope_review",
    run: async (context) =>
      invoke(context, "diff_scope_review", {
        repoRoot: context.repoRoot,
        objective: "Add clean-state dogfood self-test",
        changedFiles: ["scripts/dogfood-selftest.ts"],
        evidence: [{ sourcePath: "scripts/dogfood-selftest.ts", summary: "Dogfood harness source." }],
      }),
  },
  {
    toolName: "test_quality_review",
    run: async (context) =>
      invoke(context, "test_quality_review", {
        repoRoot: context.repoRoot,
        changedFiles: ["scripts/dogfood-selftest.ts"],
      }),
  },
  {
    toolName: "coverage_delta_analyze",
    run: async (context) =>
      invoke(context, "coverage_delta_analyze", {
        before: { lines: 82, branches: 70, functions: 80, statements: 82 },
        after: { lines: 83, branches: 71, functions: 81, statements: 83 },
        failBelowDelta: -1,
      }),
  },
  {
    toolName: "action_policy_review",
    run: async (context) =>
      invoke(context, "action_policy_review", {
        operations: [{ kind: "command", command: "npm", args: ["test"] }],
      }),
  },
  {
    toolName: "patch_checkpoint",
    run: async (context) => {
      const filePath = path.join(context.scratchRoot, "patch-target.txt");
      writeFileSync(filePath, "old dogfood value\n");
      const checkpoint = asObject(
        await invoke(context, "patch_checkpoint", {
          repoRoot: context.scratchRoot,
          label: "dogfood",
          files: ["patch-target.txt"],
        }),
      );
      context.state.patchCheckpointId = checkpoint.checkpointId;
      return called({ checkpointId: checkpoint.checkpointId });
    },
  },
  {
    toolName: "patch_apply",
    run: async (context) => {
      const applied = asObject(
        await invoke(context, "patch_apply", {
          repoRoot: context.scratchRoot,
          checkpointId: context.state.patchCheckpointId,
          unifiedDiff: [
            "diff --git a/patch-target.txt b/patch-target.txt",
            "--- a/patch-target.txt",
            "+++ b/patch-target.txt",
            "@@ -1 +1 @@",
            "-old dogfood value",
            "+new dogfood value",
            "",
          ].join("\n"),
        }),
      );
      context.state.patchTransactionId = applied.transactionId;
      return called({ transactionId: applied.transactionId });
    },
  },
  {
    toolName: "patch_status",
    run: async (context) => invoke(context, "patch_status", { repoRoot: context.scratchRoot }),
  },
  {
    toolName: "patch_rollback",
    run: async (context) =>
      invoke(context, "patch_rollback", {
        repoRoot: context.scratchRoot,
        transactionId: context.state.patchTransactionId,
      }),
  },
  {
    toolName: "agent_register",
    run: async (context) =>
      invoke(context, "agent_register", {
        agentId: "dogfood-cli",
        displayName: "Dogfood CLI",
        target: "local",
        transport: "cli",
        capabilities: ["coding", "evidence"],
        installation: "installed",
        authentication: "none",
        maxConcurrentTasks: 2,
        supportsInterrupt: true,
        runtime: {
          command: process.execPath,
          args: [
            "-e",
            [
              "let data = '';",
              "let done = false;",
              "function finish() {",
              "  if (done) return;",
              "  done = true;",
              "  let input = {};",
              "  try { input = JSON.parse(data || '{}'); } catch {}",
              "  console.log(input.objective || 'dogfood agent');",
              "  process.exit(0);",
              "}",
              "process.stdin.setEncoding('utf8');",
              "process.stdin.on('data', chunk => { data += chunk; });",
              "process.stdin.on('end', finish);",
              "setTimeout(finish, 1000);",
            ].join(" "),
          ],
          timeoutMs: 60_000,
        },
      }),
  },
  {
    toolName: "agent_list",
    run: async (context) => invoke(context, "agent_list"),
  },
  {
    toolName: "agent_dispatch",
    run: async (context) => {
      const run = asObject(
        await invoke(context, "agent_dispatch", {
          missionId: context.state.missionId,
          taskId: "dogfood-agent-task",
          objective: "Run dogfood agent",
          requiredCapabilities: ["coding"],
        }),
      );
      context.state.agentRunId = run.runId;
      return called({ runId: run.runId });
    },
  },
  {
    toolName: "agent_dispatch_execute",
    run: async (context) =>
      invoke(context, "agent_dispatch_execute", {
        missionId: context.state.missionId,
        taskId: "dogfood-agent-execute",
        objective: "Execute dogfood CLI agent",
        requiredCapabilities: ["coding"],
        timeoutMs: 60_000,
      }),
  },
  {
    toolName: "agent_status",
    run: async (context) => invoke(context, "agent_status", { runId: context.state.agentRunId }),
  },
  {
    toolName: "agent_complete",
    run: async (context) =>
      invoke(context, "agent_complete", {
        runId: context.state.agentRunId,
        status: "completed",
        summary: "Dogfood agent completed.",
        evidenceIds: [context.state.evidenceId],
      }),
  },
  {
    toolName: "agent_interrupt",
    run: async (context) => {
      const run = asObject(
        await invoke(context, "agent_dispatch", {
          missionId: context.state.missionId,
          taskId: "dogfood-agent-interrupt",
          objective: "Interrupt dogfood agent",
          requiredCapabilities: ["coding"],
        }),
      );
      return invoke(context, "agent_interrupt", { runId: run.runId, reason: "Dogfood interrupt." });
    },
  },
  {
    toolName: "printing_press_register",
    run: async (context) =>
      invoke(context, "printing_press_register", {
        cliId: "dogfood-press",
        displayName: "Dogfood Press",
        command: process.execPath,
        args: ["-e", "console.log('dogfood printing press')"],
        capabilities: ["evidence"],
        installation: "installed",
        authentication: "none",
        evidenceMode: "compact",
        providesMcpServer: false,
        supportsInterrupt: false,
        maxConcurrentTasks: 1,
      }),
  },
  {
    toolName: "printing_press_list",
    run: async (context) => invoke(context, "printing_press_list"),
  },
  {
    toolName: "printing_press_select",
    run: async (context) =>
      invoke(context, "printing_press_select", {
        requiredCapabilities: ["evidence"],
      }),
  },
  {
    toolName: "printing_press_register_agent",
    run: async (context) => invoke(context, "printing_press_register_agent", { cliId: "dogfood-press" }),
  },
  {
    toolName: "printing_press_verify",
    run: async (context) => invoke(context, "printing_press_verify", { cliId: "dogfood-press" }),
  },
  {
    toolName: "printing_press_run",
    run: async (context) =>
      invoke(context, "printing_press_run", {
        cliId: "dogfood-press",
        timeoutMs: 2_000,
      }),
  },
  {
    toolName: "model_profile_register",
    run: async (context) =>
      invoke(context, "model_profile_register", {
        profileId: "dogfood-local",
        providerId: "local",
        modelId: "dogfood-coder",
        strengths: ["coding", "analysis"],
        modes: ["fast", "balanced"],
        costTier: "low",
        latencyTier: "low",
        privacy: "local",
        contextWindow: 16_000,
      }),
  },
  {
    toolName: "model_profile_select",
    run: async (context) => {
      const route = asObject(
        await invoke(context, "model_profile_select", {
          taskType: "coding",
          mode: "fast",
          requiredStrengths: ["coding"],
        }),
      );
      context.state.modelTraceId = route.traceId;
      return called({ traceId: route.traceId });
    },
  },
  {
    toolName: "model_profile_record_outcome",
    run: async (context) =>
      invoke(context, "model_profile_record_outcome", {
        traceId: context.state.modelTraceId,
        status: "succeeded",
        latencyMs: 50,
        outputQuality: 5,
      }),
  },
  {
    toolName: "model_profile_export_traces",
    run: async (context) => invoke(context, "model_profile_export_traces"),
  },
  {
    toolName: "python_sidecar_probe",
    run: async (context) => invoke(context, "python_sidecar_probe"),
  },
  {
    toolName: "python_graph_metrics",
    run: async (context) =>
      invoke(context, "python_graph_metrics", {
        nodes: [{ id: "src/tools.ts", kind: "file" }],
        edges: [],
      }),
  },
  {
    toolName: "python_graph_communities",
    run: async (context) =>
      invoke(context, "python_graph_communities", {
        nodes: [{ id: "src/tools.ts", kind: "file" }, { id: "src/mcp-server.ts", kind: "file" }],
        edges: [{ from: "src/mcp-server.ts", to: "src/tools.ts", kind: "imports" }],
      }),
  },
  {
    toolName: "python_trace_summary",
    run: async (context) =>
      invoke(context, "python_trace_summary", {
        events: [
          { type: "tool", name: "repo_index_build", durationMs: 10 },
          { type: "tool", name: "gate_request", durationMs: 2 },
        ],
      }),
  },
  {
    toolName: "media_dependency_report",
    run: async (context) => invoke(context, "media_dependency_report"),
  },
  {
    toolName: "media_ingest_image",
    run: async (context) =>
      invoke(context, "media_ingest_image", {
        repoRoot: context.scratchRoot,
        sourcePath: createTinyImage(context.scratchRoot),
        ocrMode: "auto",
      }),
  },
  {
    toolName: "shell_hook_discover",
    run: async (context) => invoke(context, "shell_hook_discover", { repoRoot: context.repoRoot }),
  },
  {
    toolName: "shell_hook_plan",
    run: async (context) =>
      invoke(context, "shell_hook_plan", {
        repoRoot: context.repoRoot,
        shells: ["bash"],
        dryRun: true,
      }),
  },
  {
    toolName: "shell_hook_verify",
    run: async (context) =>
      invoke(context, "shell_hook_verify", {
        repoRoot: context.repoRoot,
        shells: ["bash"],
      }),
  },
  {
    toolName: "discovery_har_import",
    run: async (context) => {
      const har = await invoke(context, "discovery_har_import", {
        harJson: {
          log: {
            version: "1.2",
            entries: [
              {
                request: {
                  method: "GET",
                  url: "https://api.example.test/users/123?expand=1",
                  headers: [{ name: "Authorization", value: "secret" }],
                },
                response: {
                  status: 200,
                  headers: [{ name: "Content-Type", value: "application/json" }],
                  content: { mimeType: "application/json", text: "{}" },
                },
              },
            ],
          },
        },
      });
      context.state.harObservations = asObject(har).observations;
      return called();
    },
  },
  {
    toolName: "discovery_openapi_import",
    run: async (context) => {
      const openapi = await invoke(context, "discovery_openapi_import", {
        specText: JSON.stringify({
          openapi: "3.0.0",
          servers: [{ url: "https://api.example.test" }],
          paths: {
            "/users/{id}": {
              get: {
                operationId: "getUser",
                responses: { "200": { content: { "application/json": {} } } },
              },
            },
          },
        }),
        sourceName: "users.json",
      });
      context.state.openapiObservations = asObject(openapi).observations;
      return called();
    },
  },
  {
    toolName: "discovery_browser_capture",
    run: async (context) =>
      invoke(context, "discovery_browser_capture", {
        url: "https://api.example.test",
        maxRequests: 1,
        timeoutMs: 10,
      }),
  },
  {
    toolName: "discovery_tool_spec_generate",
    run: async (context) =>
      invoke(context, "discovery_tool_spec_generate", {
        observations: [
          ...(Array.isArray(context.state.harObservations) ? context.state.harObservations : []),
          ...(Array.isArray(context.state.openapiObservations) ? context.state.openapiObservations : []),
        ],
        baseCommand: "api-call",
      }),
  },
  {
    toolName: "agent_remit_create",
    run: async (context) => {
      const remit = await invoke(context, "agent_remit_create", {
        workerName: "dogfood-agent",
        mission: "Exercise Wormhole safely.",
        allowedCapabilities: ["coding", "evidence"],
        approvedChannels: ["commentary", "final"],
        knownGoodBaseline: {
          typicalToolInventory: ["repo_index_build", "gate_request"],
        },
      });
      context.state.agentRemit = remit;
      return called();
    },
  },
  {
    toolName: "agent_capability_inventory",
    run: async (context) => {
      const inventory = await invoke(context, "agent_capability_inventory", {
        agentId: "dogfood-agent",
        repoRoot: context.repoRoot,
        capabilities: ["coding", "evidence"],
        channels: ["commentary", "final"],
        mcpServers: ["wormhole"],
        actions: [{ action: "repo_index_build", approvalObserved: true }],
      });
      context.state.agentInventory = inventory;
      return called();
    },
  },
  {
    toolName: "agent_behavior_verify",
    run: async (context) => {
      const report = await invoke(context, "agent_behavior_verify", {
        remit: context.state.agentRemit,
        inventory: context.state.agentInventory,
      });
      context.state.behaviorReport = report;
      return called();
    },
  },
  {
    toolName: "remit_coverage_report",
    run: async (context) => invoke(context, "remit_coverage_report", { report: context.state.behaviorReport }),
  },
  {
    toolName: "agent_drift_analyze",
    run: async (context) =>
      invoke(context, "agent_drift_analyze", {
        remit: context.state.agentRemit,
        currentInventory: context.state.agentInventory,
      }),
  },
  {
    toolName: "behavior_findings_render",
    run: async (context) => invoke(context, "behavior_findings_render", { report: context.state.behaviorReport }),
  },
  {
    toolName: "agent_workspace_create",
    run: async (context) => {
      const workspace = asObject(
        await invoke(context, "agent_workspace_create", {
          missionId: context.state.missionId,
          objective: "Share dogfood state.",
        }),
      );
      context.state.workspaceId = workspace.workspaceId;
      return called({ workspaceId: workspace.workspaceId });
    },
  },
  {
    toolName: "agent_workspace_write",
    run: async (context) =>
      invoke(context, "agent_workspace_write", {
        workspaceId: context.state.workspaceId,
        runId: "dogfood",
        key: "finding",
        value: { summary: "Dogfood workspace writes persist." },
        visibility: "shared",
      }),
  },
  {
    toolName: "agent_workspace_read",
    run: async (context) => invoke(context, "agent_workspace_read", { workspaceId: context.state.workspaceId }),
  },
  {
    toolName: "agent_workspace_merge",
    run: async (context) =>
      invoke(context, "agent_workspace_merge", {
        workspaceId: context.state.workspaceId,
        runIds: ["dogfood"],
      }),
  },
  {
    toolName: "lsp_session_list",
    run: async (context) => invoke(context, "lsp_session_list"),
  },
  {
    toolName: "optimization_adapter_register",
    run: async (context) =>
      invoke(context, "optimization_adapter_register", {
        adapterId: "dogfood-native-compact",
        transport: "native",
        capabilities: ["command_output_compaction"],
        installation: "installed",
      }),
  },
  {
    toolName: "optimization_adapter_list",
    run: async (context) => invoke(context, "optimization_adapter_list"),
  },
  {
    toolName: "optimization_adapter_select",
    run: async (context) =>
      invoke(context, "optimization_adapter_select", {
        capability: "command_output_compaction",
      }),
  },
  {
    toolName: "optimization_adapter_run",
    run: async (context) =>
      invoke(context, "optimization_adapter_run", {
        adapterId: "dogfood-native-compact",
        kind: "command_output_compaction",
        content: "dogfood output",
      }),
  },
  {
    toolName: "optimized_command_run",
    run: async (context) =>
      invoke(context, "optimized_command_run", {
        command: process.execPath,
        args: ["-e", "console.log('dogfood optimized command')"],
        cwd: context.repoRoot,
        timeoutMs: 2_000,
      }),
  },
  {
    toolName: "optimization_stats",
    run: async (context) => invoke(context, "optimization_stats"),
  },
  {
    toolName: "tool_factory_generate",
    run: async (context) => {
      const scaffold = asObject(
        await invoke(context, "tool_factory_generate", {
          toolId: "dogfood-tool",
          displayName: "Dogfood Tool",
          description: "Generated by dogfood self-test.",
          commandName: "dogfood-tool",
          capabilities: ["dogfood"],
          inputs: [{ name: "query", type: "string", required: true }],
        }),
      );
      context.state.toolScaffold = scaffold;
      return called();
    },
  },
  {
    toolName: "tool_factory_validate",
    run: async (context) => invoke(context, "tool_factory_validate", context.state.toolScaffold),
  },
  {
    toolName: "tool_factory_write",
    run: async (context) =>
      invoke(context, "tool_factory_write", {
        scaffold: context.state.toolScaffold,
        targetDir: path.join(context.scratchRoot, "generated-tool"),
      }),
  },
  {
    toolName: "conductor_plan",
    run: async (context) => {
      const conductor = asObject(
        await invoke(context, "conductor_plan", {
          objective: "Dogfood Wormhole",
          risk: "medium",
          complexity: "medium",
          requiredStrengths: ["coding"],
          modelProfileIds: ["dogfood-local"],
        }),
      );
      context.state.conductorTrace = conductor.trace;
      return called();
    },
  },
  {
    toolName: "conductor_replay",
    run: async (context) => invoke(context, "conductor_replay", context.state.conductorTrace),
  },
  {
    toolName: "behavior_mode_set",
    run: async (context) => invoke(context, "behavior_mode_set", { brevity: "dense", minimality: "review" }),
  },
  {
    toolName: "behavior_mode_get",
    run: async (context) => invoke(context, "behavior_mode_get"),
  },
  {
    toolName: "behavior_apply",
    run: async (context) =>
      invoke(context, "behavior_apply", {
        text: "Run `npm test` and keep source paths exact.",
      }),
  },
  {
    toolName: "behavior_minimality_review",
    run: async (context) =>
      invoke(context, "behavior_minimality_review", {
        objective: "Add dogfood self-test",
        planSteps: ["Add script", "Run tests", "Deploy Kubernetes cluster"],
      }),
  },
  {
    toolName: "runtime_behavior_audit",
    run: async (context) =>
      invoke(context, "runtime_behavior_audit", {
        recommendedTools: [
          { toolName: "repo_index_build", required: true },
          { toolName: "gate_request", required: true, after: ["repo_index_build"] },
        ],
        observedToolCalls: [
          { toolName: "repo_index_build", status: "ran" },
          { toolName: "gate_request", status: "ran" },
        ],
        knownToolNames: TOOL_REGISTRY.map((tool) => tool.name),
      }),
  },
  {
    toolName: "orchestration_trace_record",
    run: async (context) => invoke(context, "orchestration_trace_record", commandTrace()),
  },
  {
    toolName: "orchestration_dataset_export",
    run: async (context) => invoke(context, "orchestration_dataset_export"),
  },
  {
    toolName: "orchestration_policy_train",
    run: async (context) =>
      invoke(context, "orchestration_policy_train", {
        traceJsonl: Array.from({ length: 60 }, (_, index) => JSON.stringify(orchestrationTrace(index))).join("\n"),
        epochs: 1,
      }),
  },
  {
    toolName: "orchestration_policy_evaluate",
    run: async (context) => {
      await seedOrchestrationPolicyTraces(context);
      const evaluation = asObject(
        await invoke(context, "orchestration_policy_evaluate", {
          policyJson: passingPolicyJson(),
        }),
      );
      context.state.policyEvaluationId = evaluation.evaluationId;
      return called({ evaluationId: evaluation.evaluationId });
    },
  },
  {
    toolName: "orchestration_policy_compare_baselines",
    run: async (context) =>
      invoke(context, "orchestration_policy_compare_baselines", {
        policyJson: passingPolicyJson(),
      }),
  },
  {
    toolName: "orchestration_policy_activate",
    run: async (context) =>
      invoke(context, "orchestration_policy_activate", {
        evaluationId: context.state.policyEvaluationId,
      }),
  },
  {
    toolName: "orchestration_policy_get",
    run: async (context) => invoke(context, "orchestration_policy_get"),
  },
  {
    toolName: "orchestration_policy_live_feedback",
    run: async (context) => invoke(context, "orchestration_policy_live_feedback", { ...commandTrace(), traceId: "dogfood-live" }),
  },
  {
    toolName: "reasoning_trace_record",
    run: async (context) =>
      invoke(context, "reasoning_trace_record", {
        traceId: "dogfood-reason-1",
        strategy: "critique-revise",
        taskKind: "feature",
        planSummary: "Plan with dogfood evidence.",
        critiqueSummary: "Critique missing clean-state run.",
        revisionSummary: "Add clean-state dogfood self-test.",
        verifierSummary: "Verifier checks tool dispositions.",
        evidenceReferenced: 4,
        evidenceAvailable: 5,
        openQuestionsResolved: 1,
        openQuestionsRemaining: 0,
        outcome: "succeeded",
        userCorrections: 0,
      }),
  },
  {
    toolName: "reasoning_dataset_export",
    run: async (context) => invoke(context, "reasoning_dataset_export"),
  },
  {
    toolName: "reasoning_strategy_evaluate",
    run: async (context) => invoke(context, "reasoning_strategy_evaluate"),
  },
];

async function runDogfood(): Promise<void> {
  mkdirSync(reportRoot, { recursive: true });
  mkdirSync(path.join(actualRepoRoot, ".wormhole"), { recursive: true });
  mkdirSync(scratchRoot, { recursive: true });

  const handlerMap = loadHandlerMap(actualRepoRoot);
  const registryToolNames = TOOL_REGISTRY.map((tool) => tool.name);
  const mappedToolNames = [...handlerMap.keys()];
  const missingMappings = registryToolNames.filter((toolName) => !handlerMap.has(toolName));
  const extraMappings = mappedToolNames.filter((toolName) => !registryToolNames.includes(toolName));
  if (missingMappings.length > 0 || extraMappings.length > 0) {
    throw new Error(
      `MCP mapping drift: missing=${missingMappings.join(",") || "none"} extra=${extraMappings.join(",") || "none"}`,
    );
  }

  const caseNames = new Set(cases.map((entry) => entry.toolName));
  const duplicateCases = cases
    .map((entry) => entry.toolName)
    .filter((toolName, index, all) => all.indexOf(toolName) !== index);
  if (duplicateCases.length > 0) {
    throw new Error(`Duplicate dogfood cases: ${[...new Set(duplicateCases)].join(", ")}`);
  }
  const unclassified = registryToolNames.filter(
    (toolName) => !caseNames.has(toolName) && !Object.prototype.hasOwnProperty.call(GUARDED_REASONS, toolName),
  );
  if (unclassified.length > 0) {
    throw new Error(`Unclassified Wormhole tools in dogfood harness: ${unclassified.join(", ")}`);
  }

  const options = createDefaultToolHandlerOptions(actualRepoRoot);
  const tools = createToolHandlers(createDefaultKernel(actualRepoRoot), {
    ...options,
    allowedRepoRoots: [actualRepoRoot, scratchRoot],
    privilegedActionGate: createPrivilegedActionGate({
      mode: "strict",
      approvedTools: [...APPROVED_DOGFOOD_TOOLS],
    }),
  }) as unknown as ToolHandlers;

  const context: DogfoodContext = {
    repoRoot: actualRepoRoot,
    scratchRoot,
    reportRoot,
    tools,
    handlerMap,
    state: {
      runId,
      reportHashSeed: stableHash(`${actualRepoRoot}:${runId}`),
    },
  };

  const results: DogfoodResult[] = [];
  for (const entry of cases) {
    const started = Date.now();
    const handlerName = handlerMap.get(entry.toolName);
    writeProgress({
      runId,
      status: "running",
      currentTool: entry.toolName,
      completed: results.length,
      totalRunnable: cases.length,
      statusCounts: countStatuses(results),
    });
    try {
      const raw = await entry.run(context);
      const classified = classifyDogfoodResult(raw);
      results.push({
        toolName: entry.toolName,
        handlerName,
        status: classified.status,
        durationMs: Date.now() - started,
        detail: classified.detail,
        ...(classified.error ? { error: classified.error } : {}),
      });
      writeProgress({
        runId,
        status: "running",
        currentTool: entry.toolName,
        completed: results.length,
        totalRunnable: cases.length,
        statusCounts: countStatuses(results),
      });
      const logMessage = `[${classified.status}] ${entry.toolName} ${Date.now() - started}ms`;
      if (classified.status === "failed") {
        console.error(`${logMessage}: ${classified.error ?? "Tool returned failed status."}`);
      } else {
        console.log(logMessage);
      }
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      results.push({
        toolName: entry.toolName,
        handlerName,
        status: "failed",
        durationMs: Date.now() - started,
        error: message,
      });
      writeProgress({
        runId,
        status: "running",
        currentTool: entry.toolName,
        completed: results.length,
        totalRunnable: cases.length,
        statusCounts: countStatuses(results),
      });
      console.error(`[failed] ${entry.toolName}: ${message}`);
    }
  }

  for (const [toolName, reason] of Object.entries(GUARDED_REASONS)) {
    results.push({
      toolName,
      handlerName: handlerMap.get(toolName),
      status: "guarded",
      durationMs: 0,
      detail: reason,
    });
    console.log(`[guarded] ${toolName} 0ms`);
  }

  const statusCounts = results.reduce<Record<DogfoodStatus, number>>(
    (counts, result) => {
      counts[result.status] += 1;
      return counts;
    },
    { called: 0, guarded: 0, failed: 0 },
  );
  const report = {
    runId,
    repoRoot: actualRepoRoot,
    scratchRoot,
    toolCount: TOOL_REGISTRY.length,
    handlerMappingHash: stableHash(JSON.stringify([...handlerMap.entries()])),
    statusCounts,
    results: results.sort((left, right) => left.toolName.localeCompare(right.toolName)),
  };
  const reportPath = path.join(reportRoot, `selftest-${runId}.json`);
  const failed = results.filter((result) => result.status === "failed");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(reportRoot, "latest-selftest.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeProgress({
    runId,
    status: failed.length > 0 ? "failed" : "completed",
    completed: results.length,
    totalRunnable: cases.length,
    statusCounts,
    reportPath,
  });

  console.log(
    JSON.stringify(
      {
        reportPath,
        called: statusCounts.called,
        guarded: statusCounts.guarded,
        failed: statusCounts.failed,
      },
      null,
      2,
    ),
  );
  if (failed.length > 0) {
    throw new Error(`Dogfood self-test failed for ${failed.length} tool(s): ${failed.map((result) => result.toolName).join(", ")}`);
  }
}

function countStatuses(results: DogfoodResult[]): Record<DogfoodStatus, number> {
  return results.reduce<Record<DogfoodStatus, number>>(
    (counts, result) => {
      counts[result.status] += 1;
      return counts;
    },
    { called: 0, guarded: 0, failed: 0 },
  );
}

function writeProgress(progress: Record<string, unknown>): void {
  writeFileSync(progressPath, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...progress }, null, 2)}\n`);
}

try {
  await runDogfood();
} finally {
  if (existsSync(scratchRoot)) {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}
