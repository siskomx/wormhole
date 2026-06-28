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
import { auditRuntimeBehavior, type RuntimeBehaviorAuditInput } from "../src/runtime-behavior-audit.js";
import { TOOL_REGISTRY } from "../src/tool-registry.js";
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

function createLargeFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-agent-routing-large-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: { test: "vitest run tests" },
        devDependencies: { typescript: "^6.0.3", vitest: "^4.1.9" },
      },
      null,
      2,
    ),
  );
  for (let index = 0; index < 1005; index += 1) {
    const id = String(index).padStart(4, "0");
    writeFileSync(path.join(repoRoot, "src", `f${id}.ts`), `export const value${id} = ${index};\n`);
  }
  writeFileSync(
    path.join(repoRoot, "src", "f1004.ts"),
    "export function lifecycleAccountingMarker() { return 'large repo context'; }\n",
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
      expect(snapshot.indexHealth.source).toBe("repo_index");
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
      expect(prepared.indexHealth.source).toBe("repo_index");
      expect(prepared.snapshot.indexHealth.source).toBe("repo_index");
      expect(prepared.contextPack.indexHealth.source).toBe("repo_index");
      expect(prepared.contextPack.sources).toEqual(
        expect.arrayContaining(["src/services/user-service.ts", "src/api/users.ts", "tests/user-service.test.ts"]),
      );
      expect(prepared.nextToolCalls.map((call) => call.toolName)).toEqual(
        expect.arrayContaining(["record_evidence", "test_plan_select", "gate_request", "runtime_behavior_audit"]),
      );
      expect(prepared.nextToolCalls.find((call) => call.toolName === "record_evidence")?.missingInput).toContain("missionId");
      const runtimeAuditCall = prepared.nextToolCalls.find((call) => call.toolName === "runtime_behavior_audit");
      expect(runtimeAuditCall?.missingInput).toContain("observedToolCalls");
      const runtimeAuditInput = runtimeAuditCall?.input as RuntimeBehaviorAuditInput;
      expect(runtimeAuditInput.requiredTools).toEqual(
        expect.arrayContaining(["record_evidence", "verification_run", "gate_request"]),
      );
      expect(runtimeAuditInput.ignoredToolNames).toEqual(
        expect.arrayContaining([
          "agent_context_prepare",
          "ctx_pack_refresh",
          "durable_index_status",
          "durable_repo_index_query",
          "mission_route",
          "round_start",
          "state_maintenance_run",
          "tool_catalog_query",
          "tool_layer_map",
          "workflow_write_artifacts",
        ]),
      );
      expect(runtimeAuditInput.knownToolNames).toEqual(
        expect.arrayContaining(TOOL_REGISTRY.map((tool) => tool.name)),
      );
      expect(runtimeAuditInput.recommendedTools.map((tool) => tool.toolName)).toEqual(
        expect.arrayContaining([
          "project_onboard",
          "architecture_map",
          "context_pack_generate",
          "test_plan_select",
          "verification_run",
          "record_evidence",
          "gate_request",
        ]),
      );
      expect(runtimeAuditInput.recommendedTools.map((tool) => tool.toolName)).not.toContain("runtime_behavior_audit");
      expect(runtimeAuditInput.recommendedTools.find((tool) => tool.toolName === "gate_request")?.after).toEqual([
        "record_evidence",
        "verification_run",
      ]);
      const runtimeAudit = auditRuntimeBehavior({
        ...runtimeAuditInput,
        observedToolCalls: [{ toolName: "repo_index_query" }, { toolName: "shell" }],
      });
      expect(runtimeAudit.unexpectedTools.map((tool) => tool.toolName)).toEqual(["repo_index_query"]);
      const metaToolAudit = auditRuntimeBehavior({
        ...runtimeAuditInput,
        observedToolCalls: [
          { toolName: "agent_context_prepare" },
          { toolName: "durable_repo_index_query" },
          { toolName: "workflow_write_artifacts" },
        ],
      });
      expect(metaToolAudit.unexpectedTools).toEqual([]);
      expect(prepared.recommendedDiscovery.map((call) => call.toolName)).toEqual([
        "tool_layer_map",
        "tool_catalog_query",
      ]);
      expect(prepared.stateMaintenance.coordinator.toolName).toBe("state_maintenance_run");
      expect(prepared.stateMaintenance.context.ownerTools).toContain("ctx_pack_refresh");
      expect(prepared.agentInstructions).toContain("Start with tool_layer_map before browsing the full MCP surface.");
      expect(prepared.agentInstructions).toContain("Continue into implementation and verification for coding tasks.");
      expect(prepared.agentInstructions).toContain("Run gate_request after verification_run");
      expect(prepared.agentInstructions).toContain("Call emit_plan only when the user explicitly asks for a plan");
      expect(prepared.agentInstructions).toContain(
        "Use durable_repo_index_query, ctx_pack_refresh, and workflow_write_artifacts for durable handoff and resume paths.",
      );
      expect(prepared.agentInstructions).toContain("Refresh index state before trusting degraded or stale context.");
      expect(prepared.agentInstructions).toContain(
        "Run runtime_behavior_audit before final claims when observed tool calls are available.",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("includes repo-native feature slice sources in prepared agent context", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-agent-context-native-"));
    try {
      mkdirSync(path.join(repoRoot, "src", "features", "tickets"), { recursive: true });
      mkdirSync(path.join(repoRoot, "backend", "src", "modules", "tickets"), { recursive: true });
      writeFileSync(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run tests" }, dependencies: { typescript: "^6.0.0" } }),
      );
      writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
      writeFileSync(path.join(repoRoot, "src", "features", "tickets", "TicketView.tsx"), "export function TicketView() { return null; }\n");
      writeFileSync(path.join(repoRoot, "backend", "src", "modules", "tickets", "TicketRoutes.ts"), "export function registerTicketRoutes() {}\n");

      const prepared = prepareAgentContext({
        repoRoot,
        objective: "Fix ticket creation",
        query: "tickets",
        preferredSources: ["backend/src/modules/tickets/TicketRoutes.ts"],
      });

      expect(prepared.contextPack.sources).toContain("backend/src/modules/tickets/TicketRoutes.ts");
      expect(prepared.agentInstructions).toContain("Repo-native feature slices seeded this context pack.");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("prioritizes detected language source in prepared context for Rust tasks", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-agent-routing-rust-"));
    try {
      mkdirSync(path.join(repoRoot, "src"), { recursive: true });
      mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
      writeFileSync(
        path.join(repoRoot, "Cargo.toml"),
        ["[package]", 'name = "agent-browser"', 'version = "0.1.0"', ""].join("\n"),
      );
      writeFileSync(
        path.join(repoRoot, "src", "lib.rs"),
        [
          "mod router;",
          "pub struct DesktopAgent;",
          "pub fn agent_query() {",
          "    router::route_query();",
          "}",
        ].join("\n"),
      );
      writeFileSync(path.join(repoRoot, "src", "router.rs"), "pub fn route_query() {}\n");
      writeFileSync(
        path.join(repoRoot, "docs", "agent-notes.md"),
        [
          "# DesktopAgent agent_query QueryRouter",
          "",
          "DesktopAgent agent_query QueryRouter DesktopAgent agent_query QueryRouter.",
        ].join("\n"),
      );

      const prepared = prepareAgentContext({
        repoRoot,
        objective: "Change DesktopAgent query flow",
        query: "DesktopAgent agent_query QueryRouter",
        changedFiles: ["src/lib.rs"],
        maxChars: 4_000,
      });

      expect(prepared.contextPack.sources[0]).toBe("src/lib.rs");
      expect(prepared.contextPack.sources).toContain("src/router.rs");
      expect(prepared.contextPack.indexHealth.languageCoverage).toContainEqual(
        expect.objectContaining({
          language: "rust",
          totalFileCount: 2,
          indexedFileCount: 2,
          status: "ok",
        }),
      );
      expect(prepared.contextPack.rendered.indexOf("## File: src/lib.rs")).toBeLessThan(
        prepared.contextPack.rendered.indexOf("## File: docs/agent-notes.md"),
      );
      expect(prepared.agentInstructions).toContain("Language profile");
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

  it("seeds prepared context from fresh durable retrieval in large repos", () => {
    const repoRoot = createLargeFixtureRepo();
    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const fallback = tools.agentContextPrepare({
        repoRoot,
        objective: "Create accounting lifecycle feature",
        query: "lifecycleAccountingMarker",
        maxChars: 4_000,
      });

      expect(fallback.durableRetrieval).toBeUndefined();
      expect(fallback.contextPack.rendered).toContain("Context Pack");
      expect(fallback.agentInstructions).toContain("Refresh index state before trusting degraded or stale context.");

      tools.durableRepoIndexRefresh({ repoRoot, preset: "large_repo" });

      const prepared = tools.agentContextPrepare({
        repoRoot,
        objective: "Create accounting lifecycle feature",
        query: "lifecycleAccountingMarker",
        maxChars: 4_000,
      });

      expect(prepared.durableRetrieval?.usedSqlite).toBe(true);
      expect(["sqlite_fts", "sqlite_like"]).toContain(prepared.durableRetrieval?.retrievalMode);
      expect(prepared.durableRetrieval?.results.map((entry) => entry.path)).toContain("src/f1004.ts");
      expect(prepared.contextPack.sources).toContain("src/f1004.ts");
      expect(prepared.indexHealth.fileCount).toBeGreaterThan(1000);
      expect(prepared.agentInstructions).toContain("durable repo index retrieval seeded this context pack");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("keeps prepared context health aligned with fresh durable large-repo retrieval across handler instances", () => {
    const repoRoot = createLargeFixtureRepo();
    try {
      const first = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      first.durableRepoIndexRefresh({ repoRoot, preset: "large_repo" });

      const second = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const prepared = second.agentContextPrepare({
        repoRoot,
        objective: "Create accounting lifecycle feature",
        query: "lifecycleAccountingMarker",
        maxChars: 4_000,
      });

      expect(prepared.durableRetrieval?.usedSqlite).toBe(true);
      expect(prepared.indexHealth.source).toMatch(/durable/);
      expect(prepared.indexHealth.fileCount).toBeGreaterThan(1000);
      expect(prepared.indexHealth.status).not.toBe("degraded");
      expect(prepared.contextPack.indexHealth.fileCount).toBeGreaterThan(1000);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }, 20_000);
});
