import { describe, expect, it } from "vitest";
import {
  createFeatureWorkflow,
  createBugfixWorkflow,
  createOnboardingWorkflow,
  createReviewWorkflow,
} from "../src/workflows.js";

describe("golden-path workflows", () => {
  it("creates a start-feature workflow with exact next calls and evidence gates", () => {
    const workflow = createFeatureWorkflow({
      repoRoot: "/repo",
      objective: "Add audit logging",
      missionId: "mission-1",
      changedFiles: ["src/audit.ts"],
    });

    expect(workflow.workflow).toBe("workflow_start_feature");
    expect(workflow.nextCalls.map((call) => call.toolName)).toEqual([
      "project_onboard",
      "mission_route",
      "agent_context_prepare",
    ]);
    expect(workflow.phases.map((phase) => phase.name)).toEqual([
      "orient",
      "context",
      "act",
      "verify",
      "gate",
    ]);
    expect(workflow.phases.flatMap((phase) => phase.calls.map((call) => call.toolName))).toEqual(
      expect.arrayContaining([
        "tool_admission_review",
        "action_policy_review",
        "patch_checkpoint",
        "verification_run",
        "record_evidence",
        "gate_request",
      ]),
    );
    expect(workflow.phases.find((phase) => phase.name === "act")?.gate.requiredBeforeProceeding).toEqual(
      expect.arrayContaining(["action_policy_review", "patch_checkpoint"]),
    );
    expect(workflow.phases.find((phase) => phase.name === "gate")?.goal).toContain("final response");
    expect(workflow.phases.find((phase) => phase.name === "gate")?.calls.map((call) => call.toolName)).not.toContain(
      "emit_plan",
    );
  });

  it("prioritizes repro and focused verification for bug fixes", () => {
    const workflow = createBugfixWorkflow({
      repoRoot: "/repo",
      objective: "Fix failed login",
      diagnosticSource: "npm test",
      changedFiles: ["src/login.ts"],
    });

    expect(workflow.workflow).toBe("workflow_fix_bug");
    expect(workflow.nextCalls.map((call) => call.toolName)).toEqual([
      "diagnostics_from_command",
      "blast_radius_analyze",
      "context_pack_generate",
    ]);
    expect(workflow.phases.flatMap((phase) => phase.calls.map((call) => call.toolName))).toEqual(
      expect.arrayContaining(["diagnostics_from_command", "test_impact_analyze_v2", "test_plan_select"]),
    );
    expect(workflow.stopRule).toContain("reproduction");
  });

  it("keeps review workflows read-only by default", () => {
    const workflow = createReviewWorkflow({
      repoRoot: "/repo",
      objective: "Review authentication PR",
      changedFiles: ["src/auth.ts"],
    });

    expect(workflow.workflow).toBe("workflow_review_pr");
    expect(workflow.phases.flatMap((phase) => phase.calls.map((call) => call.toolName))).not.toContain(
      "patch_checkpoint",
    );
    expect(workflow.phases.flatMap((phase) => phase.calls.map((call) => call.toolName))).toEqual(
      expect.arrayContaining(["repo_change_scan", "secret_scan", "dependency_security_report"]),
    );
  });

  it("onboards repos through project model and route discovery", () => {
    const workflow = createOnboardingWorkflow({
      repoRoot: "/repo",
      objective: "Understand this repo",
    });

    expect(workflow.workflow).toBe("workflow_onboard_repo");
    expect(workflow.nextCalls.map((call) => call.toolName)).toEqual([
      "project_onboard",
      "architecture_map",
      "entrypoint_flow_discover",
    ]);
    expect(workflow.phases.flatMap((phase) => phase.calls.map((call) => call.toolName))).toEqual(
      expect.arrayContaining(["project_intelligence_snapshot", "tool_exposure_profile", "tool_catalog_query"]),
    );
  });
});
