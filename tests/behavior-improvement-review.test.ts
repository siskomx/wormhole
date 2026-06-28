import { describe, expect, it } from "vitest";
import { createInMemoryKernel, createToolHandlers, createWormholeMcpServer } from "../src/index.js";
import {
  BEHAVIOR_IMPROVEMENT_REVIEW_VERSION,
  createBehaviorImprovementReview,
  type BehaviorImprovementReviewInput,
} from "../src/behavior-improvement-review.js";
import { TOOL_REGISTRY } from "../src/tool-registry.js";

function runtimeToolNames(): string[] {
  const server = createWormholeMcpServer(createInMemoryKernel());
  return Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort(
    (left, right) => left.localeCompare(right),
  );
}

function baseInput(overrides: Partial<BehaviorImprovementReviewInput> = {}): BehaviorImprovementReviewInput {
  return {
    runtime: {
      status: "ok",
      missingToolCount: 0,
      failedToolCount: 0,
      skippedToolCount: 0,
      orderingViolationCount: 0,
      missingToolNames: [],
      failedToolNames: [],
      skippedToolNames: [],
      orderingViolationToolNames: [],
      recommendedToolNames: [],
      ...overrides.runtime,
    },
    relations: {
      errorCount: 0,
      warningCount: 0,
      gapKinds: [],
      ...overrides.relations,
    },
    gates: {
      sourceConflictCount: 0,
      freshnessStatus: "fresh",
      verificationStatus: "passed",
      unsafeScope: false,
      priorReportReferences: [],
      ...overrides.gates,
      traceCounts: {
        runtimeAudits: 2,
        reasoningTraces: 1,
        orchestrationTraces: 1,
        modelProfileTraces: 1,
        ...overrides.gates?.traceCounts,
      },
    },
    knownToolNames: overrides.knownToolNames ?? [],
  };
}

describe("behavior improvement review", () => {
  it("creates a byte-stable advisory report from normalized input", () => {
    const first = createBehaviorImprovementReview(
      baseInput({
        knownToolNames: ["tool_catalog_query", "runtime_behavior_audit", "tool_catalog_query"],
      }),
    );
    const second = createBehaviorImprovementReview(
      baseInput({
        knownToolNames: ["runtime_behavior_audit", "tool_catalog_query"],
      }),
    );

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.reportVersion).toBe(BEHAVIOR_IMPROVEMENT_REVIEW_VERSION);
    expect(first.advisoryOnly).toBe(true);
    expect(first.status).toBe("ok");
    expect(first.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.candidates).toEqual([]);
  });

  it("maps hard blockers to fixed candidate categories", () => {
    const report = createBehaviorImprovementReview(
      baseInput({
        runtime: {
          status: "blocker",
          missingToolCount: 1,
          failedToolCount: 0,
          skippedToolCount: 0,
          orderingViolationCount: 0,
          missingToolNames: ["gate_request"],
          failedToolNames: [],
          skippedToolNames: [],
          orderingViolationToolNames: [],
          recommendedToolNames: ["runtime_behavior_audit"],
        },
        relations: {
          errorCount: 1,
          warningCount: 0,
          gapKinds: ["relation_tool_missing"],
        },
        gates: {
          sourceConflictCount: 1,
          freshnessStatus: "stale",
          verificationStatus: "failed",
          traceCounts: {
            runtimeAudits: 2,
            reasoningTraces: 1,
            orchestrationTraces: 1,
            modelProfileTraces: 1,
          },
          unsafeScope: true,
          priorReportReferences: [],
        },
        knownToolNames: [
          "runtime_behavior_audit",
          "capability_relation_audit",
          "source_conflicts_analyze",
          "gate_request",
          "verification_run",
          "state_maintenance_run",
        ],
      }),
    );

    expect(report.status).toBe("blocked");
    expect(report.candidates.map((candidate) => [candidate.id, candidate.state])).toEqual([
      ["routing-context:capability-relations", "blocked"],
      ["tool-description:runtime-tools", "blocked"],
      ["workflow-guidance:gate-health", "blocked"],
    ]);
    expect(report.candidates.map((candidate) => candidate.id)).not.toContain("context-pack-rule:context-evidence");
    expect(report.blockers.map((notice) => notice.code)).toEqual(
      expect.arrayContaining(["RELATION_ERRORS", "RUNTIME_BLOCKER", "SOURCE_CONFLICTS"]),
    );
  });

  it("uses needs-evidence for low traces and unknown gates", () => {
    const report = createBehaviorImprovementReview(
      baseInput({
        gates: {
          sourceConflictCount: 0,
          freshnessStatus: "unknown",
          verificationStatus: "unknown",
          traceCounts: {
            runtimeAudits: 1,
            reasoningTraces: 0,
            orchestrationTraces: 0,
            modelProfileTraces: 0,
          },
          unsafeScope: false,
          priorReportReferences: [],
        },
        knownToolNames: ["ctx_pack_refresh", "durable_index_manifest_status", "state_maintenance_run"],
      }),
    );

    expect(report.status).toBe("warning");
    expect(report.candidates).toEqual([
      expect.objectContaining({
        id: "context-pack-rule:context-evidence",
        state: "needs-evidence",
        severity: "warning",
        requiresHumanReview: true,
      }),
    ]);
    expect(report.warnings.map((notice) => notice.code)).toEqual(
      expect.arrayContaining(["FRESHNESS_UNKNOWN", "LOW_TRACE_COUNT", "VERIFICATION_UNKNOWN"]),
    );
  });

  it("omits unknown and unsafe-looking recommended tools without echoing their names", () => {
    const report = createBehaviorImprovementReview(
      baseInput({
        runtime: {
          status: "warning",
          missingToolCount: 1,
          failedToolCount: 0,
          skippedToolCount: 0,
          orderingViolationCount: 0,
          missingToolNames: ["safe_runner"],
          failedToolNames: [],
          skippedToolNames: [],
          orderingViolationToolNames: [],
          recommendedToolNames: ["tool_catalog_query", "ghost_tool", "patch_apply", "safe_runner"],
        },
        knownToolNames: ["tool_catalog_query", "patch_apply", "safe_runner", "runtime_behavior_audit"],
      }),
    );

    const candidate = report.candidates.find((entry) => entry.id === "tool-description:runtime-tools");

    expect(candidate?.recommendedExistingTools).toEqual(["runtime_behavior_audit", "safe_runner", "tool_catalog_query"]);
    expect(report.warnings.map((notice) => notice.code)).toEqual(
      expect.arrayContaining(["UNKNOWN_TOOL_NAME_OMITTED", "UNSAFE_TOOL_NAME_OMITTED"]),
    );
    expect(JSON.stringify(report)).not.toContain("ghost_tool");
    expect(JSON.stringify(report)).not.toContain("patch_apply");
  });

  it("treats circular high-impact candidates as blocked and other circular candidates as needs-evidence", () => {
    const relationCircular = createBehaviorImprovementReview(
      baseInput({
        relations: {
          errorCount: 0,
          warningCount: 1,
          gapKinds: ["artifact_metadata_missing"],
        },
        gates: {
          sourceConflictCount: 0,
          freshnessStatus: "fresh",
          verificationStatus: "passed",
          traceCounts: {
            runtimeAudits: 2,
            reasoningTraces: 1,
            orchestrationTraces: 1,
            modelProfileTraces: 1,
          },
          unsafeScope: false,
          priorReportReferences: [{ reportId: "prior", candidateIds: ["routing-context:capability-relations"] }],
        },
        knownToolNames: ["capability_relation_audit"],
      }),
    );
    const contextCircular = createBehaviorImprovementReview(
      baseInput({
        gates: {
          sourceConflictCount: 0,
          freshnessStatus: "unknown",
          verificationStatus: "passed",
          traceCounts: {
            runtimeAudits: 1,
            reasoningTraces: 0,
            orchestrationTraces: 0,
            modelProfileTraces: 0,
          },
          unsafeScope: false,
          priorReportReferences: [{ reportId: "prior", candidateIds: ["context-pack-rule:context-evidence"] }],
        },
        knownToolNames: ["ctx_pack_refresh"],
      }),
    );

    expect(relationCircular.status).toBe("warning");
    expect(relationCircular.candidates[0]).toEqual(
      expect.objectContaining({ id: "routing-context:capability-relations", state: "needs-evidence" }),
    );
    expect(contextCircular.status).toBe("blocked");
    expect(contextCircular.candidates[0]).toEqual(
      expect.objectContaining({ id: "context-pack-rule:context-evidence", state: "blocked" }),
    );
  });

  it("bounds and sorts warnings and recommended tools deterministically", () => {
    const report = createBehaviorImprovementReview(
      baseInput({
        runtime: {
          status: "warning",
          missingToolCount: 1,
          failedToolCount: 0,
          skippedToolCount: 0,
          orderingViolationCount: 0,
          missingToolNames: ["z_tool"],
          failedToolNames: [],
          skippedToolNames: [],
          orderingViolationToolNames: [],
          recommendedToolNames: [
            "z_tool",
            "y_tool",
            "x_tool",
            "w_tool",
            "v_tool",
            "u_tool",
            "unknown_9",
            "unknown_8",
            "unknown_7",
            "unknown_6",
            "unknown_5",
            "unknown_4",
            "unknown_3",
            "unknown_2",
            "unknown_1",
          ],
        },
        knownToolNames: ["z_tool", "y_tool", "x_tool", "w_tool", "v_tool", "u_tool"],
      }),
    );

    expect(report.warnings).toHaveLength(8);
    expect(report.warnings.map((notice) => `${notice.code}|${notice.subject}|${notice.message}`)).toEqual(
      [...report.warnings.map((notice) => `${notice.code}|${notice.subject}|${notice.message}`)].sort(),
    );
    expect(report.candidates[0]?.recommendedExistingTools).toEqual(["u_tool", "v_tool", "w_tool", "x_tool"]);
  });

  it("rejects malformed input", () => {
    expect(() =>
      createBehaviorImprovementReview({
        ...baseInput(),
        knownToolNames: "not-array",
      } as unknown as BehaviorImprovementReviewInput),
    ).toThrow(/Invalid behavior improvement review input: knownToolNames/);
    expect(() =>
      createBehaviorImprovementReview(
        baseInput({
          runtime: {
            ...baseInput().runtime,
            missingToolCount: -1,
          },
        }),
      ),
    ).toThrow(/Invalid behavior improvement review input: runtime\.missingToolCount/);
  });

  it("keeps the report free of mutation-shaped output fields and narratives", () => {
    const report = createBehaviorImprovementReview(
      baseInput({
        runtime: {
          status: "warning",
          missingToolCount: 1,
          failedToolCount: 0,
          skippedToolCount: 0,
          orderingViolationCount: 0,
          missingToolNames: ["safe_runner"],
          failedToolNames: [],
          skippedToolNames: [],
          orderingViolationToolNames: [],
          recommendedToolNames: ["safe_runner", "patch_apply"],
        },
        knownToolNames: ["safe_runner", "patch_apply"],
      }),
    );
    const serialized = JSON.stringify(report).toLowerCase();

    expect(serialized).not.toContain("patch");
    expect(serialized).not.toContain("command");
    expect(serialized).not.toContain("filepath");
    expect(serialized).not.toContain("registryentry");
    expect(serialized).not.toContain("activate");
    expect(serialized).not.toContain("mutate");
  });

  it("does not expose a new registry, handler, or MCP tool surface", () => {
    const forbiddenToolNames = ["self_improvement_review", "behavior_improvement_review"];
    const registryToolNames = TOOL_REGISTRY.map((tool) => tool.name);
    const handlers = createToolHandlers(createInMemoryKernel()) as unknown as Record<string, unknown>;

    expect(registryToolNames).not.toEqual(expect.arrayContaining(forbiddenToolNames));
    expect(Object.keys(handlers)).not.toEqual(
      expect.arrayContaining(["selfImprovementReview", "behaviorImprovementReview"]),
    );
    expect(runtimeToolNames()).not.toEqual(expect.arrayContaining(forbiddenToolNames));
  });
});
