import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFeatureWorkflow,
  createBugfixWorkflow,
  createOnboardingWorkflow,
  createReviewWorkflow,
} from "../src/workflows.js";

describe("golden-path workflows", () => {
  function createChatFixtureRepo(): string {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-workflow-"));
    mkdirSync(path.join(repoRoot, "src", "features", "chat", "hooks"), { recursive: true });
    mkdirSync(path.join(repoRoot, "src", "features", "agents", "hooks"), { recursive: true });
    mkdirSync(path.join(repoRoot, "backend", "src", "modules", "chat"), { recursive: true });
    mkdirSync(path.join(repoRoot, "backend", "src", "modules", "agents"), { recursive: true });
    mkdirSync(path.join(repoRoot, "migrations"), { recursive: true });
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "features", "chat", "hooks", "useChat.ts"),
      "export function useChat() { return { send: () => fetch('/chat', { method: 'POST' }) }; }\n",
    );
    writeFileSync(
      path.join(repoRoot, "backend", "src", "modules", "chat", "ChatRoutes.ts"),
      "export const ChatRoutes = { postMessage() { return 'ok'; } };\n",
    );
    writeFileSync(
      path.join(repoRoot, "backend", "src", "modules", "agents", "AgentRoutes.ts"),
      "export const AgentRoutes = {};\n",
    );
    writeFileSync(
      path.join(repoRoot, "src", "features", "agents", "hooks", "useAiApprovalQueue.ts"),
      "export function useAiApprovalQueue() { return []; }\n",
    );
    writeFileSync(
      path.join(repoRoot, "migrations", "001_create_chat_messages.sql"),
      "create table chat_messages (id text primary key, body text not null);\n",
    );
    writeFileSync(path.join(repoRoot, "tests", "chat.test.ts"), "import '../src/features/chat/hooks/useChat';\n");
    return repoRoot;
  }

  function createClientAgentFixtureRepo(): string {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-workflow-compound-"));
    mkdirSync(path.join(repoRoot, "backend", "src", "modules", "agents"), { recursive: true });
    mkdirSync(path.join(repoRoot, "backend", "src", "modules", "clients"), { recursive: true });
    mkdirSync(path.join(repoRoot, "backend", "tests", "workflows"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "backend", "src", "modules", "agents", "AgentRoutes.ts"),
      "export const AgentRoutes = {};\n",
    );
    writeFileSync(
      path.join(repoRoot, "backend", "src", "modules", "clients", "ClientRoutes.ts"),
      "export const ClientRoutes = {};\n",
    );
    writeFileSync(
      path.join(repoRoot, "backend", "tests", "workflows", "org-client-agent-invoice-review.workflow.test.ts"),
      "test('client agent workflow', () => expect(true).toBe(true));\n",
    );
    return repoRoot;
  }

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

  it("binds feature workflows to repo features and exposes a resumable next action", () => {
    const repoRoot = createChatFixtureRepo();
    try {
      const workflow = createFeatureWorkflow({
        repoRoot,
        objective: "Fix chat message sending",
        missionId: "mission-chat",
        changedFiles: ["src/features/chat/hooks/useChat.ts"],
      });

      expect(workflow.run).toMatchObject({
        schemaVersion: "workflow-run.v0",
        workflow: "workflow_start_feature",
        missionId: "mission-chat",
        currentPhase: "orient",
        status: "planned",
      });
      expect(workflow.exactNextAction).toMatchObject({
        phase: "orient",
        toolName: "project_onboard",
      });
      expect(workflow.featureBindings.map((feature) => feature.featureId)).toEqual(["chat"]);
      expect(workflow.featureBindings[0]).toMatchObject({
        featureId: "chat",
        fileCount: expect.any(Number),
        featureIndexPath: ".wormhole/feature-index.json",
      });
      expect(workflow.featureBindings[0]?.routes).toContain("backend/src/modules/chat/ChatRoutes.ts");
      expect(workflow.featureBindings[0]?.hooks).toContain("src/features/chat/hooks/useChat.ts");
      expect(workflow.featureBindings[0]?.dbTables).toContain("chat_messages");
      expect(workflow.featureBindings[0]?.tests).toContain("tests/chat.test.ts");
      expect(workflow.featureBindings[0]?.sourceOfTruth.map((source) => source.sourcePath)).toEqual(
        expect.arrayContaining([
          "backend/src/modules/chat/ChatRoutes.ts",
          "migrations/001_create_chat_messages.sql",
          "src/features/chat/hooks/useChat.ts",
          "tests/chat.test.ts",
        ]),
      );
      expect(workflow.featureBindings[0]?.supportingDocs.map((source) => source.sourcePath)).toEqual([]);
      expect(workflow.verificationContract).toMatchObject({
        tier: "focused",
        commandsSource: "test_plan_select",
        changedFiles: ["src/features/chat/hooks/useChat.ts"],
        featureIds: ["chat"],
      });
      expect(workflow.resume.exactNextAction).toContain("project_onboard");
      expect(workflow.resume.sourceOfTruth.map((source) => source.sourcePath)).toEqual(
        expect.arrayContaining([".wormhole/feature-index.json"]),
      );
      expect(workflow.requiredArtifacts.map((artifact) => artifact.path)).toEqual(
        expect.arrayContaining([
          `.wormhole/workflows/${workflow.run.runId}.json`,
          `.wormhole/workflows/${workflow.run.runId}.md`,
          ".wormhole/workflows/latest.json",
        ]),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("surfaces source conflicts for feature-bound stale documentation claims", () => {
    const repoRoot = createChatFixtureRepo();
    try {
      mkdirSync(path.join(repoRoot, "docs", "discoveries", "features"), { recursive: true });
      writeFileSync(
        path.join(repoRoot, "docs", "discoveries", "features", "chat.md"),
        [
          "# Chat",
          "",
          "Current implementation: [missing](../../../src/features/chat/Missing.tsx).",
        ].join("\n"),
      );
      writeFileSync(
        path.join(repoRoot, "docs", "unrelated.md"),
        ["# Unrelated", "", "Tables: missing_accounts."].join("\n"),
      );

      const workflow = createFeatureWorkflow({
        repoRoot,
        objective: "Fix chat message sending",
      });

      expect(workflow.featureBindings[0]?.conflicts).toContainEqual(
        expect.objectContaining({
          subject: "docs/discoveries/features/chat.md -> src/features/chat/Missing.tsx",
          resolution: "needs_validation",
        }),
      );
      expect(workflow.resume.conflicts).toContainEqual(
        expect.objectContaining({
          subject: "docs/discoveries/features/chat.md -> src/features/chat/Missing.tsx",
        }),
      );
      expect(workflow.featureBindings[0]?.conflicts.map((conflict) => conflict.subject)).not.toContain(
        "table:missing_accounts",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not attach conflicts through broad fallback feature roots", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-workflow-broad-root-"));
    try {
      mkdirSync(path.join(repoRoot, "backend", "src", "modules", "fiscal"), { recursive: true });
      mkdirSync(path.join(repoRoot, "backend", "src", ".claude", "refs"), { recursive: true });
      writeFileSync(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }, null, 2),
      );
      writeFileSync(
        path.join(repoRoot, "backend", "src", "modules", "fiscal", "AccountingService.ts"),
        "export class AccountingService {}\n",
      );
      writeFileSync(
        path.join(repoRoot, "backend", "src", ".claude", "refs", "testing.md"),
        "Run `npm run missing` before release.\n",
      );

      const workflow = createFeatureWorkflow({
        repoRoot,
        objective: "Finish accounting production readiness",
      });

      expect(workflow.featureBindings[0]?.featureId).toBe("accounting");
      expect(workflow.featureBindings[0]?.roots).toContain("backend/src");
      expect(workflow.featureBindings[0]?.conflicts.map((conflict) => conflict.subject)).not.toContain(
        "script:missing",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("prefers compound workflow features over broad single-token feature matches", () => {
    const repoRoot = createClientAgentFixtureRepo();
    try {
      const workflow = createFeatureWorkflow({
        repoRoot,
        objective: "Continue the client agent invoice review workflow",
      });

      expect(workflow.featureBindings.map((feature) => feature.featureId)).toEqual([
        "client-agent",
        "agent",
        "client",
      ]);
      expect(workflow.featureBindings[0]?.sourceOfTruth.map((source) => source.sourcePath)).toContain(
        "backend/tests/workflows/org-client-agent-invoice-review.workflow.test.ts",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
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
