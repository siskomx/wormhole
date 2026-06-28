import { describe, expect, it } from "vitest";
import {
  auditRuntimeBehavior,
  type RuntimeBehaviorAuditInput,
} from "../src/runtime-behavior-audit.js";
import { auditRuntimeBehavior as exportedAuditRuntimeBehavior } from "../src/index.js";
import { createInMemoryKernel, createToolHandlers } from "../src/index.js";

function toolNames<T extends { toolName: string }>(tools: T[]): string[] {
  return tools.map((tool) => tool.toolName);
}

describe("runtime behavior audit", () => {
  it("reports covered, missing, and unexpected Wormhole-scope tools from a recommended route", () => {
    const audit = auditRuntimeBehavior({
      knownToolNames: [
        "tool_layer_map",
        "architecture_map",
        "context_pack_generate",
        "gate_request",
        "repo_index_query",
      ],
      recommendedTools: [
        { toolName: "tool_layer_map", phase: "orient", priority: 100 },
        { toolName: "architecture_map", phase: "orient", priority: 95 },
        { toolName: "context_pack_generate", phase: "context", priority: 90 },
        { toolName: "gate_request", phase: "gate", priority: 80 },
      ],
      observedToolCalls: [
        { toolName: "tool_layer_map" },
        { toolName: "repo_index_query" },
        { toolName: "context_pack_generate" },
        { toolName: "shell" },
      ],
    });

    expect(audit.summary.coverageRatio).toBe(0.5);
    expect(audit.summary.status).toBe("warning");
    expect(toolNames(audit.coveredTools)).toEqual(["tool_layer_map", "context_pack_generate"]);
    expect(toolNames(audit.missingTools)).toEqual(["architecture_map", "gate_request"]);
    expect(toolNames(audit.unexpectedTools)).toEqual(["repo_index_query"]);
    expect(audit.nextActions).toContain("Run or justify missing recommended tool: gate_request.");
  });

  it("blocks when required gate or evidence tools are missing", () => {
    const audit = auditRuntimeBehavior({
      requiredTools: ["record_evidence", "gate_request"],
      recommendedTools: [
        { toolName: "record_evidence", phase: "gate", priority: 90 },
        { toolName: "gate_request", phase: "gate", priority: 80 },
      ],
      observedToolCalls: [{ toolName: "record_evidence" }],
    });

    expect(audit.summary.status).toBe("blocker");
    expect(toolNames(audit.uncoveredRequiredTools)).toEqual(["gate_request"]);
    expect(audit.blockingReasons).toContain("Required tool was not observed: gate_request.");
    expect(audit.nextActions).toContain("Run required tool before final claims: gate_request.");
  });

  it("does not count failed or skipped required tools as covered", () => {
    const audit = auditRuntimeBehavior({
      requiredTools: ["gate_request", "verification_run"],
      recommendedTools: [
        { toolName: "gate_request", phase: "gate", required: true },
        { toolName: "verification_run", phase: "verify", required: true },
      ],
      observedToolCalls: [
        { toolName: "gate_request", status: "failed", reason: "gate refused" },
        { toolName: "verification_run", status: "skipped", reason: "no command selected" },
      ],
    });

    expect(audit.summary.status).toBe("blocker");
    expect(toolNames(audit.coveredTools)).toEqual([]);
    expect(toolNames(audit.missingTools)).toEqual(["gate_request", "verification_run"]);
    expect(toolNames(audit.failedTools)).toEqual(["gate_request"]);
    expect(toolNames(audit.skippedTools)).toEqual(["verification_run"]);
    expect(toolNames(audit.uncoveredRequiredTools)).toEqual(["gate_request", "verification_run"]);
    expect(audit.blockingReasons).toEqual(
      expect.arrayContaining([
        "Required tool failed: gate_request.",
        "Required tool was skipped: verification_run.",
      ]),
    );
  });

  it("handles empty recommendations without NaN coverage", () => {
    const audit = auditRuntimeBehavior({
      recommendedTools: [],
      observedToolCalls: [{ toolName: "shell" }],
    });

    expect(audit.summary.recommendedToolCount).toBe(0);
    expect(audit.summary.coverageRatio).toBe(1);
    expect(audit.summary.status).toBe("ok");
    expect(audit.unexpectedTools).toEqual([]);
  });

  it("treats repeated recommendations as call-level checks", () => {
    const audit = auditRuntimeBehavior({
      recommendedTools: [
        { toolName: "context_pack_generate", recommendationId: "context.initial", phase: "context" },
        { toolName: "context_pack_generate", recommendationId: "context.refresh", phase: "context" },
        { toolName: "verification_run", phase: "verify", minCalls: 2 },
      ],
      observedToolCalls: [
        { toolName: "context_pack_generate", recommendationId: "context.initial" },
        { toolName: "verification_run" },
      ],
    });

    expect(audit.summary.coveredToolCount).toBe(1);
    expect(audit.summary.coverageRatio).toBeCloseTo(1 / 3);
    expect(audit.coveredTools.map((tool) => tool.recommendationId)).toEqual(["context.initial"]);
    expect(audit.missingTools.map((tool) => tool.recommendationId ?? tool.toolName)).toEqual([
      "context.refresh",
      "verification_run",
    ]);
  });

  it("reports gate requests that run before required predecessors", () => {
    const audit = auditRuntimeBehavior({
      requiredTools: ["gate_request"],
      recommendedTools: [
        { toolName: "record_evidence", phase: "gate" },
        { toolName: "verification_run", phase: "verify" },
        {
          toolName: "gate_request",
          phase: "gate",
          required: true,
          after: ["record_evidence", "verification_run"],
        },
      ],
      observedToolCalls: [
        { toolName: "gate_request" },
        { toolName: "record_evidence" },
        { toolName: "verification_run" },
      ],
    });

    expect(audit.summary.status).toBe("blocker");
    expect(audit.orderingViolations).toContainEqual(
      expect.objectContaining({
        toolName: "gate_request",
        after: ["record_evidence", "verification_run"],
      }),
    );
    expect(audit.blockingReasons.some((reason) => reason.includes("gate_request"))).toBe(true);
  });

  it("ignores non-Wormhole tools by default and honors explicit ignored tools", () => {
    const defaultScoped = auditRuntimeBehavior({
      recommendedTools: [{ toolName: "tool_layer_map" }],
      observedToolCalls: [
        { toolName: "tool_layer_map" },
        { toolName: "shell" },
        { toolName: "read_file" },
      ],
    });
    const registryScoped = auditRuntimeBehavior({
      knownToolNames: ["tool_layer_map", "capability_relation_audit"],
      recommendedTools: [{ toolName: "tool_layer_map" }],
      observedToolCalls: [
        { toolName: "tool_layer_map" },
        { toolName: "capability_relation_audit" },
        { toolName: "shell" },
      ],
    });
    const ignored = auditRuntimeBehavior({
      knownToolNames: ["tool_layer_map", "capability_relation_audit"],
      ignoredToolNames: ["capability_relation_audit"],
      recommendedTools: [{ toolName: "tool_layer_map" }],
      observedToolCalls: [{ toolName: "capability_relation_audit" }],
    });

    expect(defaultScoped.unexpectedTools).toEqual([]);
    expect(toolNames(registryScoped.unexpectedTools)).toEqual(["capability_relation_audit"]);
    expect(ignored.unexpectedTools).toEqual([]);
  });

  it("surfaces required tools that are outside the recommendation route", () => {
    const audit = auditRuntimeBehavior({
      requiredTools: ["gate_request"],
      recommendedTools: [],
      observedToolCalls: [],
    });

    expect(audit.summary.coverageRatio).toBe(1);
    expect(audit.summary.status).toBe("blocker");
    expect(toolNames(audit.uncoveredRequiredTools)).toEqual(["gate_request"]);
    expect(audit.nextActions).toContain("Run required tool before final claims: gate_request.");
  });

  it("exposes runtime behavior audit through package exports and tool handlers", () => {
    expect(exportedAuditRuntimeBehavior).toBe(auditRuntimeBehavior);

    const tools = createToolHandlers(createInMemoryKernel());
    const input: RuntimeBehaviorAuditInput = {
      requiredTools: ["agent_context_prepare"],
      recommendedTools: [{ toolName: "agent_context_prepare", required: true }],
      observedToolCalls: [],
    };

    const audit = tools.runtimeBehaviorAudit(input);

    expect(audit.summary.status).toBe("blocker");
    expect(audit.blockingReasons).toContain("Required tool was not observed: agent_context_prepare.");
  });
});
