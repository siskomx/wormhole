import { describe, expect, it } from "vitest";
import { createInMemoryKernel, createToolHandlers, createWormholeMcpServer } from "../src/index.js";
import {
  AGENT_LOOP_HEALTH_VERSION,
  createAgentLoopHealth,
  type AgentLoopHealthInput,
} from "../src/agent-loop-health.js";
import {
  auditRuntimeBehavior,
  type RuntimeBehaviorAudit,
  type RuntimeObservedToolCall,
  type RuntimeRecommendedTool,
} from "../src/runtime-behavior-audit.js";
import { TOOL_REGISTRY } from "../src/tool-registry.js";

const KNOWN_TOOLS = [
  "agent_context_prepare",
  "ctx_pack_refresh",
  "durable_index_manifest_status",
  "durable_index_status",
  "gate_request",
  "mission_route",
  "next_best_tool",
  "record_evidence",
  "repo_index_search",
  "runtime_behavior_audit",
  "safe_runner",
  "source_conflicts_analyze",
  "state_maintenance_run",
  "test_plan_select",
  "verification_run",
];

function runtimeToolNames(): string[] {
  const server = createWormholeMcpServer(createInMemoryKernel());
  return Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort(
    (left, right) => left.localeCompare(right),
  );
}

function createRuntimeAudit(input: {
  recommendedTools: RuntimeRecommendedTool[];
  observedToolCalls: RuntimeObservedToolCall[];
  requiredTools?: string[];
  knownToolNames?: string[];
}): RuntimeBehaviorAudit {
  return auditRuntimeBehavior({
    recommendedTools: input.recommendedTools,
    observedToolCalls: input.observedToolCalls,
    requiredTools: input.requiredTools,
    knownToolNames: input.knownToolNames ?? KNOWN_TOOLS,
  });
}

function baseInput(overrides: {
  mode?: AgentLoopHealthInput["mode"];
  recommendedTools?: RuntimeRecommendedTool[];
  observedToolCalls?: RuntimeObservedToolCall[];
  runtimeAudit?: RuntimeBehaviorAudit;
  knownToolNames?: string[];
  gateSignals?: Partial<AgentLoopHealthInput["gateSignals"]>;
  budgets?: Partial<AgentLoopHealthInput["budgets"]>;
} = {}): AgentLoopHealthInput {
  const recommendedTools = overrides.recommendedTools ?? [
    { toolName: "mission_route", phase: "plan", required: true },
    { toolName: "gate_request", phase: "gate" },
  ];
  const observedToolCalls = overrides.observedToolCalls ?? [];
  return {
    mode: overrides.mode ?? "planned",
    recommendedTools,
    observedToolCalls,
    runtimeAudit:
      overrides.runtimeAudit ??
      createRuntimeAudit({
        recommendedTools,
        observedToolCalls,
        requiredTools: recommendedTools.filter((tool) => tool.required === true).map((tool) => tool.toolName),
        knownToolNames: overrides.knownToolNames ?? KNOWN_TOOLS,
      }),
    knownToolNames: overrides.knownToolNames ?? KNOWN_TOOLS,
    gateSignals: {
      sourceConflictCount: 0,
      freshnessStatus: "fresh",
      verificationStatus: "passed",
      indexHealthStatus: "ok",
      ...overrides.gateSignals,
    },
    budgets: {
      currentIteration: 1,
      maxIterations: 4,
      estimatedTokenMultiplier: 1,
      maxTokenMultiplier: 4,
      noProgressIterations: 0,
      maxNoProgressIterations: 2,
      ...overrides.budgets,
    },
  };
}

function noticeCodes(report: ReturnType<typeof createAgentLoopHealth>, kind: "blockers" | "warnings"): string[] {
  return report[kind].map((notice) => notice.code);
}

describe("agent loop health", () => {
  it("keeps planned empty observations advisory even when the supplied runtime audit is blocking", () => {
    const recommendedTools: RuntimeRecommendedTool[] = [
      { toolName: "gate_request", phase: "gate", required: true },
      { toolName: "state_maintenance_run", phase: "maintain" },
    ];
    const runtimeAudit = createRuntimeAudit({
      recommendedTools,
      observedToolCalls: [],
      requiredTools: ["gate_request"],
    });

    expect(runtimeAudit.summary.status).toBe("blocker");

    const report = createAgentLoopHealth(
      baseInput({
        mode: "planned",
        recommendedTools,
        observedToolCalls: [],
        runtimeAudit,
      }),
    );

    expect(report.reportVersion).toBe(AGENT_LOOP_HEALTH_VERSION);
    expect(report.advisoryOnly).toBe(true);
    expect(report.status).toBe("warning");
    expect(noticeCodes(report, "blockers")).not.toContain("RUNTIME_AUDIT_BLOCKER");
    expect(noticeCodes(report, "warnings")).toEqual(
      expect.arrayContaining(["MISSING_RECOMMENDED_TOOLS", "PLANNED_NO_OBSERVATIONS"]),
    );
    expect(report.phases.find((phase) => phase.phase === "observe")?.missingToolNames).toEqual(["gate_request"]);
  });

  it("uses the caller supplied runtime audit in observed mode", () => {
    const recommendedTools: RuntimeRecommendedTool[] = [{ toolName: "mission_route", phase: "plan", required: true }];
    const observedToolCalls: RuntimeObservedToolCall[] = [{ toolName: "mission_route", status: "ran" }];
    const suppliedBlockingAudit = createRuntimeAudit({
      recommendedTools: [{ toolName: "gate_request", phase: "gate", required: true }],
      observedToolCalls: [],
      requiredTools: ["gate_request"],
    });

    const report = createAgentLoopHealth(
      baseInput({
        mode: "observed",
        recommendedTools,
        observedToolCalls,
        runtimeAudit: suppliedBlockingAudit,
      }),
    );

    expect(report.status).toBe("blocked");
    expect(noticeCodes(report, "blockers")).toContain("RUNTIME_AUDIT_BLOCKER");
    expect(report.phases.find((phase) => phase.phase === "observe")?.missingToolNames).toEqual(["gate_request"]);
  });

  it("maps freshness, verification, source conflicts, index health, and budgets to deterministic stop conditions", () => {
    const report = createAgentLoopHealth(
      baseInput({
        gateSignals: {
          sourceConflictCount: 2,
          freshnessStatus: "stale",
          verificationStatus: "failed",
          indexHealthStatus: "missing",
        },
        budgets: {
          currentIteration: 4,
          maxIterations: 4,
          estimatedTokenMultiplier: 5,
          maxTokenMultiplier: 4,
          noProgressIterations: 2,
          maxNoProgressIterations: 2,
        },
      }),
    );

    expect(report.status).toBe("blocked");
    expect(noticeCodes(report, "blockers")).toEqual(
      expect.arrayContaining([
        "FRESHNESS_STALE",
        "INDEX_MISSING",
        "ITERATION_LIMIT",
        "NO_PROGRESS_LIMIT",
        "SOURCE_CONFLICTS",
        "TOKEN_MULTIPLIER_LIMIT",
        "VERIFICATION_FAILED",
      ]),
    );
    expect(report.stopConditions.map((condition) => [condition.code, condition.status])).toEqual([
      ["FRESHNESS_STALE", "blocked"],
      ["INDEX_MISSING", "blocked"],
      ["ITERATION_LIMIT", "blocked"],
      ["NO_PROGRESS_LIMIT", "blocked"],
      ["SOURCE_CONFLICTS", "blocked"],
      ["TOKEN_MULTIPLIER_LIMIT", "blocked"],
      ["VERIFICATION_FAILED", "blocked"],
    ]);
  });

  it("classifies gather, special routing tools, and unknown phases into loop phases", () => {
    const recommendedTools: RuntimeRecommendedTool[] = [
      { toolName: "repo_index_search", phase: "gather" },
      { toolName: "mission_route", phase: "act" },
      { toolName: "gate_request", phase: "act" },
      { toolName: "state_maintenance_run", phase: "plan" },
      { toolName: "mystery_tool", phase: "custom" },
    ];
    const observedToolCalls = recommendedTools.map((tool) => ({ toolName: tool.toolName, status: "ran" as const }));
    const report = createAgentLoopHealth(
      baseInput({
        mode: "observed",
        recommendedTools,
        observedToolCalls,
        knownToolNames: [...KNOWN_TOOLS, "mystery_tool"],
      }),
    );

    expect(report.phases.find((phase) => phase.phase === "perceive")?.recommendedToolNames).toEqual([
      "repo_index_search",
    ]);
    expect(report.phases.find((phase) => phase.phase === "plan")?.recommendedToolNames).toEqual(["mission_route"]);
    expect(report.phases.find((phase) => phase.phase === "observe")?.recommendedToolNames).toEqual(["gate_request"]);
    expect(report.phases.find((phase) => phase.phase === "maintain")?.recommendedToolNames).toEqual([
      "state_maintenance_run",
    ]);
    expect(report.phases.find((phase) => phase.phase === "reason")?.recommendedToolNames).toEqual(["mystery_tool"]);
  });

  it("omits unknown next tools while retaining safe evidence summaries", () => {
    const recommendedTools: RuntimeRecommendedTool[] = [
      { toolName: "safe_runner", phase: "act", required: true },
      { toolName: "ghost_tool", phase: "act", required: true },
    ];
    const report = createAgentLoopHealth(
      baseInput({
        recommendedTools,
        observedToolCalls: [],
        knownToolNames: ["safe_runner"],
      }),
    );

    expect(report.nextExistingTools).toEqual(["safe_runner"]);
    expect(report.phases.find((phase) => phase.phase === "act")?.missingToolNames).toEqual([
      "ghost_tool",
      "safe_runner",
    ]);
    expect(noticeCodes(report, "warnings")).toContain("UNKNOWN_TOOL_NAME_OMITTED");
    expect(JSON.stringify(report)).toContain("ghost_tool");
  });

  it("creates byte-stable normalized output", () => {
    const first = createAgentLoopHealth(
      baseInput({
        knownToolNames: ["mission_route", "gate_request", "mission_route"],
      }),
    );
    const second = createAgentLoopHealth(
      baseInput({
        knownToolNames: ["gate_request", "mission_route"],
      }),
    );

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.reportVersion).toBe(AGENT_LOOP_HEALTH_VERSION);
    expect(first.advisoryOnly).toBe(true);
  });

  it("does not echo mutation-shaped next-tool names or generated text", () => {
    const recommendedTools: RuntimeRecommendedTool[] = [
      { toolName: "safe_runner", phase: "act", required: true },
      { toolName: "patch_apply", phase: "act", required: true },
    ];
    const report = createAgentLoopHealth(
      baseInput({
        recommendedTools,
        observedToolCalls: [],
        knownToolNames: ["safe_runner", "patch_apply"],
      }),
    );
    const serialized = JSON.stringify({
      nextExistingTools: report.nextExistingTools,
      blockers: report.blockers,
      warnings: report.warnings,
      stopConditions: report.stopConditions,
    }).toLowerCase();

    expect(report.nextExistingTools).toEqual(["safe_runner"]);
    expect(noticeCodes(report, "warnings")).toContain("UNSAFE_TOOL_NAME_OMITTED");
    expect(serialized).not.toContain("patch");
    expect(serialized).not.toContain("command");
    expect(serialized).not.toContain("filepath");
    expect(serialized).not.toContain("registryentry");
    expect(serialized).not.toContain("activate");
    expect(serialized).not.toContain("mutate");
  });

  it("does not expose a new registry, handler, or MCP tool surface", () => {
    const forbiddenToolNames = ["agent_loop_health", "loop_run", "loop_runner"];
    const registryToolNames = TOOL_REGISTRY.map((tool) => tool.name);
    const handlers = createToolHandlers(createInMemoryKernel()) as unknown as Record<string, unknown>;

    expect(registryToolNames).not.toEqual(expect.arrayContaining(forbiddenToolNames));
    expect(Object.keys(handlers)).not.toEqual(expect.arrayContaining(["agentLoopHealth", "loopRun", "loopRunner"]));
    expect(runtimeToolNames()).not.toEqual(expect.arrayContaining(forbiddenToolNames));
  });
});
