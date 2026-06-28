import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  prepareAgentContext,
  recommendMissionRoute,
  recommendNextBestTool,
  createProjectIntelligenceSnapshot,
} from "../src/agent-routing.js";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-agent-routing-"));
  mkdirSync(path.join(repoRoot, ".github"), { recursive: true });
  mkdirSync(path.join(repoRoot, "src", "api"), { recursive: true });
  mkdirSync(path.join(repoRoot, "src", "services"), { recursive: true });
  mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        scripts: {
          start: "node dist/server.js",
          test: "vitest run tests",
        },
        dependencies: { express: "^5.0.0" },
        devDependencies: { vitest: "^4.0.0", typescript: "^6.0.0" },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(path.join(repoRoot, ".github", "CODEOWNERS"), "src/services/ @backend\nsrc/api/ @api\n");
  writeFileSync(
    path.join(repoRoot, "src", "services", "user-service.ts"),
    [
      "export type User = { id: string; name: string };",
      "export function loadUser(id: string): User {",
      "  return { id, name: 'Ada' };",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "api", "users.ts"),
    [
      "import { loadUser } from '../services/user-service';",
      "export function registerUserRoutes(app: { get(path: string, handler: unknown): void }) {",
      "  app.get('/users/:id', () => loadUser('42'));",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "tests", "user-service.test.ts"),
    [
      "import { loadUser } from '../src/services/user-service';",
      "test('loads users', () => {",
      "  expect(loadUser('7').name).toBe('Ada');",
      "});",
    ].join("\n"),
  );
  return repoRoot;
}

describe("agent-facing routing tools", () => {
  it("creates a project intelligence snapshot with the recommended default path", () => {
    const repoRoot = createFixtureRepo();
    try {
      const snapshot = createProjectIntelligenceSnapshot({
        repoRoot,
        objective: "Change user loading behavior",
        changedFiles: ["src/services/user-service.ts"],
      });

      expect(snapshot.summary.recommendedPath).toBe("balanced");
      expect(snapshot.summary.moduleCount).toBeGreaterThanOrEqual(3);
      expect(snapshot.orientation.topEntrypoints.map((entrypoint) => entrypoint.path)).toContain("src/api/users.ts");
      expect(snapshot.toolSequence.map((call) => call.toolName)).toEqual(
        expect.arrayContaining([
          "project_onboard",
          "architecture_map",
          "entrypoint_flow_discover",
          "blast_radius_analyze",
          "context_pack_generate",
        ]),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("recommends the next best tool from completed work and changed files", () => {
    const repoRoot = createFixtureRepo();
    try {
      const first = recommendNextBestTool({
        repoRoot,
        objective: "Change user loading behavior",
        changedFiles: ["src/services/user-service.ts"],
        completedTools: ["project_onboard", "architecture_map", "entrypoint_flow_discover"],
      });
      const second = recommendNextBestTool({
        repoRoot,
        objective: "Change user loading behavior",
        changedFiles: ["src/services/user-service.ts"],
        completedTools: [
          "project_onboard",
          "architecture_map",
          "entrypoint_flow_discover",
          "blast_radius_analyze",
        ],
      });

      expect(first.recommended.toolName).toBe("blast_radius_analyze");
      expect(first.recommended.input.changedFiles).toEqual(["src/services/user-service.ts"]);
      expect(second.recommended.toolName).toBe("context_pack_generate");
      expect(second.alternatives.map((call) => call.toolName)).toContain("test_impact_analyze_v2");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("routes missions into ordered stages instead of exposing the full tool surface", () => {
    const repoRoot = createFixtureRepo();
    try {
      const route = recommendMissionRoute({
        repoRoot,
        objective: "Change user loading behavior",
        changedFiles: ["src/services/user-service.ts"],
      });

      expect(route.route).toBe("balanced");
      expect(route.stages.map((stage) => stage.name)).toEqual([
        "orient",
        "impact",
        "context",
        "verify",
        "gate",
      ]);
      expect(route.stages.flatMap((stage) => stage.toolCalls.map((call) => call.toolName))).toEqual(
        expect.arrayContaining(["architecture_map", "blast_radius_analyze", "context_pack_generate", "verification_run"]),
      );
      expect(route.stateMaintenance.discovery.firstTools).toEqual([
        "tool_layer_map",
        "tool_catalog_query",
        "next_best_tool",
      ]);
      expect(route.stateMaintenance.coordinator.toolName).toBe("state_maintenance_run");
      expect(route.stateMaintenance.context.ownerTools).toEqual(
        expect.arrayContaining(["ctx_pack_budget_review", "ctx_pack_refresh"]),
      );
      expect(route.stateMaintenance.graph.ownerTools).toContain("durable_repo_index_refresh");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("prepares an agent context bundle with route, snapshot, context pack, and next calls", () => {
    const repoRoot = createFixtureRepo();
    try {
      const prepared = prepareAgentContext({
        repoRoot,
        objective: "Change user loading behavior",
        query: "load user API tests",
        changedFiles: ["src/services/user-service.ts"],
        maxChars: 3_000,
      });

      expect(prepared.contextPack.rendered).toContain("Context Pack");
      expect(prepared.contextPack.sources).toEqual(
        expect.arrayContaining(["src/services/user-service.ts", "src/api/users.ts", "tests/user-service.test.ts"]),
      );
      expect(prepared.nextToolCalls.map((call) => call.toolName)).toEqual(
        expect.arrayContaining(["record_evidence", "test_plan_select", "gate_request"]),
      );
      expect(prepared.nextToolCalls.find((call) => call.toolName === "record_evidence")?.missingInput).toContain("missionId");
      expect(prepared.recommendedDiscovery.map((call) => call.toolName)).toEqual([
        "tool_layer_map",
        "tool_catalog_query",
      ]);
      expect(prepared.stateMaintenance.coordinator.toolName).toBe("state_maintenance_run");
      expect(prepared.stateMaintenance.context.ownerTools).toContain("ctx_pack_refresh");
      expect(prepared.agentInstructions).toContain("Start with tool_layer_map before browsing the full MCP surface.");
      expect(prepared.agentInstructions).toContain("Continue into implementation and verification for coding tasks.");
      expect(prepared.agentInstructions).toContain("Call emit_plan only when the user explicitly asks for a plan");
      expect(prepared.agentInstructions).toContain(
        "Use durable_repo_index_query, ctx_pack_refresh, and workflow_write_artifacts for durable handoff and resume paths.",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("exposes the routing layer through tool handlers", () => {
    const repoRoot = createFixtureRepo();
    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });

      expect(tools.projectIntelligenceSnapshot({ repoRoot }).summary.moduleCount).toBeGreaterThan(0);
      expect(
        tools.nextBestTool({
          repoRoot,
          objective: "Change user loading behavior",
          changedFiles: ["src/services/user-service.ts"],
        }).recommended.toolName,
      ).toBe("project_onboard");
      expect(tools.missionRoute({ repoRoot, objective: "Change user loading behavior" }).stages.length).toBeGreaterThan(0);
      expect(
        tools.agentContextPrepare({
          repoRoot,
          objective: "Change user loading behavior",
          query: "load user",
          changedFiles: ["src/services/user-service.ts"],
          maxChars: 2_000,
        }).contextPack.rendered,
      ).toContain("Context Pack");
      expect(tools.toolLayerMap().entryTools).toContain("tool_catalog_query");
      expect(tools.toolCatalogQuery({ plane: "project", phase: "orient" }).tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["architecture_map", "entrypoint_flow_discover"]),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
