import { describe, expect, it } from "vitest";
import {
  planWorkflow,
  type PlannedWorkflow,
  type ToolContract,
  type WorkflowIntent,
} from "../src/workflow-planner.js";

function stageNames(plan: PlannedWorkflow): string[] {
  return plan.stages.map((stage) => stage.name);
}

function allToolNames(plan: PlannedWorkflow): string[] {
  return plan.stages.flatMap((stage) => stage.tools.map((tool) => tool.toolName));
}

describe("workflow planner", () => {
  it("plans bug work from observed failure through diagnostics, impact, context, verification, evidence, and gate", () => {
    const plan = planWorkflow({
      repoRoot: "/repo",
      objective: "Fix the login timeout bug",
      observedFailure: "npx vitest run tests/auth.test.ts -- login timeout assertion fails",
      changedFiles: ["src/auth/session.ts"],
    });
    const intent: WorkflowIntent = plan.intent;
    const firstTool: ToolContract | undefined = plan.stages[0]?.tools[0];

    expect(intent).toBe("bug");
    expect(firstTool?.toolName).toBe("diagnostics_from_command");
    expect(stageNames(plan)).toEqual(
      expect.arrayContaining([
        "diagnostics",
        "change_impact",
        "context",
        "verification",
        "evidence",
        "gate",
      ]),
    );
    expect(allToolNames(plan)).toEqual(
      expect.arrayContaining([
        "diagnostics_from_command",
        "change_impact_analyze",
        "context_pack_generate",
        "test_plan_select",
        "verification_run",
        "record_evidence",
        "gate_request",
      ]),
    );
    expect(plan.missingInputs).toEqual([]);
  });

  it("keeps review-only plans free of patch tools", () => {
    const plan = planWorkflow({
      repoRoot: "/repo",
      objective: "Review the auth change for regressions",
      changedFiles: ["src/auth/session.ts"],
      reviewOnly: true,
    });

    expect(plan.reviewOnly).toBe(true);
    expect(allToolNames(plan)).not.toEqual(
      expect.arrayContaining(["patch_checkpoint", "patch_apply"]),
    );
  });

  it("uses relation-aware search before broad context for large repo queries", () => {
    const plan = planWorkflow({
      intent: "large_repo_query",
      repoRoot: "/repo",
      objective: "Find where token refresh is orchestrated",
      query: "token refresh orchestration",
      changedFiles: ["src/auth/session.ts"],
    });
    const tools = allToolNames(plan);
    const broadContextIndex = tools.indexOf("context_pack_generate");

    expect(plan.intent).toBe("large_repo_query");
    expect(tools.indexOf("repo_intelligence_search")).toBeGreaterThanOrEqual(0);
    expect(tools.indexOf("repo_relation_query")).toBeGreaterThanOrEqual(0);
    expect(tools.indexOf("repo_intelligence_search")).toBeLessThan(broadContextIndex);
    expect(tools.indexOf("repo_relation_query")).toBeLessThan(broadContextIndex);
  });

  it("reports missing repoRoot for feature objectives without throwing", () => {
    const plan = planWorkflow({
      objective: "Add CSV export to the reports screen",
    });

    expect(plan.intent).toBe("feature");
    expect(plan.missingInputs).toContain("repoRoot");
  });

  it("declares produced outputs and required evidence for every stage", () => {
    const plans = [
      planWorkflow({
        repoRoot: "/repo",
        objective: "Fix the login timeout bug",
        observedFailure: "timeout assertion failed",
        changedFiles: ["src/auth/session.ts"],
      }),
      planWorkflow({
        repoRoot: "/repo",
        objective: "Review the auth change",
        reviewOnly: true,
      }),
      planWorkflow({
        intent: "large_repo_query",
        repoRoot: "/repo",
        objective: "Map auth call graph",
      }),
      planWorkflow({
        objective: "Add CSV export to reports",
      }),
    ];

    for (const plan of plans) {
      for (const stage of plan.stages) {
        expect(stage.produces.length, `${plan.intent}:${stage.name} produces`).toBeGreaterThan(0);
        expect(
          stage.requiredEvidence.length,
          `${plan.intent}:${stage.name} requiredEvidence`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
