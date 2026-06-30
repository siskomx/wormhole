import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createWormholeMcpServer } from "../src/mcp-server.js";
import {
  TOOL_REGISTRY,
  queryToolCatalog,
  reviewToolAdmission,
  toolExposureProfile,
  toolLayerMap,
  validateToolRegistry,
} from "../src/tool-registry.js";

function registeredToolNames(): string[] {
  return registeredToolNamesInRegistrationOrder().sort((left, right) => left.localeCompare(right));
}

function registeredToolNamesInRegistrationOrder(): string[] {
  const server = createWormholeMcpServer(createInMemoryKernel());
  return Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

describe("tool registry conformance", () => {
  it("keeps registry metadata valid and unique", () => {
    const validation = validateToolRegistry(TOOL_REGISTRY);

    expect(validation).toEqual({ valid: true, errors: [] });
    expect(TOOL_REGISTRY.length).toBeGreaterThan(150);
    for (const tool of TOOL_REGISTRY) {
      expect(tool.summary.length).toBeGreaterThan(12);
      expect(tool.inputs.length).toBeGreaterThan(0);
      expect(tool.plane).not.toBe("uncategorized");
      expect(tool.phase).not.toBe("unknown");
      expect(tool.pack).not.toBe("misc");
    }
  });

  it("covers every runtime MCP tool and no stale tools", () => {
    const runtimeTools = registeredToolNames();
    const registryTools = TOOL_REGISTRY.map((tool) => tool.name).sort((left, right) =>
      left.localeCompare(right),
    );

    expect(registryTools).toEqual(runtimeTools);
  });

  it("keeps registry order aligned with runtime MCP registration order", () => {
    expect(TOOL_REGISTRY.map((tool) => tool.name)).toEqual(registeredToolNamesInRegistrationOrder());
  });

  it("registers promotion discovery tools immediately after admission review", () => {
    const registryToolNames = TOOL_REGISTRY.map((tool) => tool.name);
    const admissionReviewIndex = registryToolNames.indexOf("tool_admission_review");

    expect(registryToolNames.slice(admissionReviewIndex + 1, admissionReviewIndex + 6)).toEqual([
      "tool_profile_list",
      "tool_profile_get",
      "tool_search",
      "tool_promote",
      "tool_promotion_status",
    ]);
  });

  it("serves a layered map and structured catalog queries", () => {
    const layerMap = toolLayerMap();
    const projectOrient = queryToolCatalog({ plane: "project", phase: "orient" });
    const coreDiscovery = queryToolCatalog({
      toolNames: ["tool_layer_map", "tool_catalog_query", "architecture_map"],
      pack: "core",
    });

    expect(layerMap.toolCount).toBe(TOOL_REGISTRY.length);
    expect(layerMap.compatibility.fullToolSurfaceVisible).toBe(true);
    expect(layerMap.compatibility.activeMode).toBe("guided");
    expect(layerMap.compatibility.defaultMode).toBe("guided");
    expect(layerMap.entryTools).toEqual(
      expect.arrayContaining([
        "tool_layer_map",
        "tool_catalog_query",
        "workflow_start_feature",
        "tool_profile_list",
        "tool_search",
        "tool_promote",
        "tool_promotion_status",
        "workflow_fix_bug",
        "workflow_review_pr",
        "workflow_onboard_repo",
        "workflow_write_artifacts",
        "resume_record",
        "resume_checkpoint",
        "resume_validate",
        "resume_load",
        "next_best_tool",
        "mission_route",
        "agent_context_prepare",
      ]),
    );
    expect(layerMap.planes.map((plane) => plane.plane)).toEqual(
      expect.arrayContaining(["mission", "project", "context", "verification"]),
    );
    expect(projectOrient.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["project_onboard", "architecture_map", "entrypoint_flow_discover"]),
    );
    expect(coreDiscovery.tools.map((tool) => tool.name)).toEqual([
      "tool_layer_map",
      "tool_catalog_query",
    ]);
  });

  it("reports optional exposure profiles without changing the guided default", () => {
    const guided = toolExposureProfile({ mode: "guided" });
    const layered = toolExposureProfile({ mode: "layered" });

    expect(guided.fullToolSurfaceVisible).toBe(true);
    expect(guided.visibleTools).toHaveLength(TOOL_REGISTRY.length);
    expect(layered.fullToolSurfaceVisible).toBe(false);
    expect(layered.visibleTools).toEqual(
      expect.arrayContaining([
        "mission_start",
        "tool_layer_map",
        "tool_catalog_query",
        "tool_profile_list",
        "tool_profile_get",
        "tool_search",
        "tool_promote",
        "tool_promotion_status",
        "mission_route",
        "agent_context_prepare",
        "workflow_start_feature",
        "workflow_fix_bug",
        "workflow_review_pr",
        "workflow_onboard_repo",
        "workflow_write_artifacts",
        "resume_record",
        "resume_checkpoint",
        "resume_validate",
        "resume_load",
        "state_maintenance_run",
        "gate_request",
      ]),
    );
    expect(layered.visibleTools).not.toContain("patch_apply");
    expect(layered.hiddenToolCount).toBeGreaterThan(0);
  });

  it("advertises tool profile and promotion metadata", () => {
    const catalog = queryToolCatalog({
      toolNames: [
        "tool_profile_list",
        "tool_profile_get",
        "tool_search",
        "tool_promote",
        "tool_promotion_status",
      ],
    });

    expect(catalog.tools).toEqual([
      expect.objectContaining({
        name: "tool_profile_list",
        plane: "policy",
        phase: "orient",
        pack: "core",
        risk: "read",
        inputs: ["none"],
      }),
      expect.objectContaining({
        name: "tool_profile_get",
        plane: "policy",
        phase: "orient",
        pack: "core",
        risk: "read",
        inputs: ["profileId"],
      }),
      expect.objectContaining({
        name: "tool_search",
        plane: "policy",
        phase: "gather",
        pack: "core",
        risk: "read",
        inputs: [
          "query",
          "objective",
          "profileId",
          "plane",
          "phase",
          "pack",
          "risk",
          "toolNames",
          "limit",
        ],
      }),
      expect.objectContaining({
        name: "tool_promote",
        plane: "policy",
        phase: "plan",
        pack: "core",
        risk: "write",
        inputs: [
          "missionId",
          "sessionId",
          "profileId",
          "objective",
          "query",
          "toolNames",
          "allowOutOfProfile",
        ],
      }),
      expect.objectContaining({
        name: "tool_promotion_status",
        plane: "policy",
        phase: "maintain",
        pack: "core",
        risk: "read",
        inputs: ["promotionId", "missionId", "sessionId"],
      }),
    ]);
  });

  it("exempts safe advisory tool promotion writes from admission preflight", () => {
    const admission = reviewToolAdmission({ toolNames: ["tool_promote"] });

    expect(admission.approval).toBe("not_required");
    expect(admission.decisions).toEqual([
      expect.objectContaining({
        toolName: "tool_promote",
        known: true,
        risk: "write",
        approval: "not_required",
        requiredPreflightTools: [],
        reasons: ["tool_promote is a safe advisory promotion write and can be called directly."],
      }),
    ]);
  });

  it("does not classify mutating maintenance and patch tools as read-only", () => {
    const catalog = queryToolCatalog({
      toolNames: [
        "repo_watch_scan",
        "state_maintenance_run",
        "lsp_feedback_replan",
        "patch_checkpoint",
        "patch_apply",
        "patch_status",
        "patch_rollback",
      ],
    });
    const riskByName = new Map(catalog.tools.map((tool) => [tool.name, tool.risk]));
    const readOnlyToolNames = queryToolCatalog({ risk: "read" }).tools.map((tool) => tool.name);

    expect(riskByName.get("repo_watch_scan")).toBe("write");
    expect(riskByName.get("state_maintenance_run")).toBe("write");
    expect(riskByName.get("lsp_feedback_replan")).toBe("write");
    expect(riskByName.get("patch_checkpoint")).toBe("write");
    expect(riskByName.get("patch_apply")).toBe("write");
    expect(riskByName.get("patch_status")).toBe("read");
    expect(riskByName.get("patch_rollback")).toBe("write");
    expect(readOnlyToolNames).not.toEqual(
      expect.arrayContaining([
        "repo_watch_scan",
        "state_maintenance_run",
        "lsp_feedback_replan",
        "patch_apply",
        "patch_rollback",
      ]),
    );
  });

  it("advertises large-repo preset and freshness inputs in index tool metadata", () => {
    const catalog = queryToolCatalog({
      toolNames: [
        "repo_index_build",
        "durable_repo_index_refresh",
        "durable_index_manifest_refresh",
        "durable_repo_index_query",
      ],
    });
    const inputsByName = new Map(catalog.tools.map((tool) => [tool.name, tool.inputs]));

    expect(inputsByName.get("repo_index_build")).toContain("preset");
    expect(inputsByName.get("durable_repo_index_refresh")).toContain("preset");
    expect(inputsByName.get("durable_index_manifest_refresh")).toContain("preset");
    expect(inputsByName.get("durable_repo_index_query")).toContain("requireFresh");
  });

  it("advertises objective freshness input for app-process status", () => {
    const catalog = queryToolCatalog({ toolNames: ["app_process_status"] });

    expect(catalog.tools[0]?.inputs).toContain("objective");
  });

  it("advertises runtime behavior audit as a behavior verification tool", () => {
    const catalog = queryToolCatalog({ toolNames: ["runtime_behavior_audit"] });

    expect(catalog.tools[0]).toEqual(
      expect.objectContaining({
        name: "runtime_behavior_audit",
        plane: "behavior",
        phase: "verify",
        pack: "behavior",
        risk: "read",
      }),
    );
    expect(catalog.tools[0]?.inputs).toEqual(
      expect.arrayContaining([
        "recommendedTools",
        "observedToolCalls",
        "requiredTools",
        "knownToolNames",
        "ignoredToolNames",
        "scope",
      ]),
    );
  });

  it("advertises repo-native coverage tools as read-only large-repo guidance", () => {
    const catalog = queryToolCatalog({
      toolNames: ["repo_native_pack_build", "feature_slice_query"],
    });

    expect(catalog.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "repo_native_pack_build",
          plane: "project",
          phase: "orient",
          pack: "large-repo",
          risk: "read",
        }),
        expect.objectContaining({
          name: "feature_slice_query",
          plane: "project",
          phase: "gather",
          pack: "large-repo",
          risk: "read",
        }),
      ]),
    );
  });

  it("advertises graph intelligence query tools as large-repo graph guidance", () => {
    const catalog = queryToolCatalog({
      toolNames: [
        "graph_communities_refresh",
        "list_communities",
        "get_community",
        "get_surprising_connections",
        "graph_wiki_generate",
        "graph_node_semantic_index_refresh",
        "graph_node_semantic_search",
        "flows_refresh",
        "list_flows",
        "get_flow",
      ],
    });

    expect(catalog.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "graph_communities_refresh", risk: "write", phase: "maintain" }),
        expect.objectContaining({ name: "list_communities", risk: "read", phase: "gather" }),
        expect.objectContaining({ name: "get_community", risk: "read", phase: "gather" }),
        expect.objectContaining({ name: "get_surprising_connections", risk: "read", phase: "impact" }),
        expect.objectContaining({ name: "graph_wiki_generate", plane: "project", pack: "large-repo" }),
        expect.objectContaining({ name: "graph_node_semantic_search", risk: "read", phase: "gather" }),
        expect.objectContaining({ name: "flows_refresh", risk: "write", phase: "maintain" }),
        expect.objectContaining({ name: "list_flows", risk: "read", phase: "gather" }),
        expect.objectContaining({ name: "get_flow", risk: "read", phase: "gather" }),
      ]),
    );
  });

  it("advertises anti-slop lifecycle gates as verification tools", () => {
    const catalog = queryToolCatalog({
      toolNames: [
        "repo_reachability_analyze",
        "code_smell_scan",
        "diff_scope_review",
        "test_quality_review",
        "coverage_delta_analyze",
      ],
    });
    const admission = reviewToolAdmission({ toolNames: ["patch_apply"] });
    const patchDecision = admission.decisions.find((decision) => decision.toolName === "patch_apply");

    expect(catalog.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "repo_reachability_analyze",
          plane: "verification",
          pack: "large-repo",
          risk: "read",
          phase: "verify",
        }),
        expect.objectContaining({ name: "code_smell_scan", risk: "read", phase: "verify" }),
        expect.objectContaining({ name: "diff_scope_review", risk: "read", phase: "verify" }),
        expect.objectContaining({ name: "test_quality_review", risk: "read", phase: "verify" }),
        expect.objectContaining({ name: "coverage_delta_analyze", risk: "read", phase: "verify" }),
      ]),
    );
    expect(patchDecision?.requiredPreflightTools).toEqual(
      expect.arrayContaining(["action_policy_review", "patch_checkpoint", "diff_scope_review"]),
    );
  });

  it("advertises lifecycle gap closure tools with policy preflights", () => {
    const catalog = queryToolCatalog({
      toolNames: [
        "git_lifecycle_status",
        "git_branch_prepare",
        "git_branch_create",
        "git_commit_prepare",
        "git_commit_create",
        "git_pr_prepare",
        "git_conflict_analyze",
        "dependency_risk_report",
        "dependency_audit_live",
        "docs_sync_check",
        "workspace_graph_analyze",
      ],
    });
    const admission = reviewToolAdmission({ toolNames: ["git_commit_create", "dependency_audit_live"] });

    expect(catalog.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "git_lifecycle_status", plane: "project", risk: "read" }),
        expect.objectContaining({ name: "git_commit_create", risk: "write" }),
        expect.objectContaining({ name: "dependency_audit_live", risk: "execute" }),
        expect.objectContaining({ name: "docs_sync_check", plane: "verification", phase: "gate", risk: "read" }),
        expect.objectContaining({ name: "workspace_graph_analyze", plane: "project", phase: "gather" }),
      ]),
    );
    expect(admission.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "git_commit_create",
          requiredPreflightTools: expect.arrayContaining(["action_policy_review"]),
        }),
        expect.objectContaining({
          toolName: "dependency_audit_live",
          requiredPreflightTools: expect.arrayContaining(["action_policy_review"]),
        }),
      ]),
    );
  });

  it("advertises domain index tools as large-repo guidance and verification coverage", () => {
    const catalog = queryToolCatalog({
      toolNames: [
        "domain_index_refresh",
        "domain_manifest_generate",
        "domain_manifest_diff",
        "domain_manifest_status",
        "domain_manifest_apply",
        "domain_slice_query",
        "domain_api_query",
        "domain_table_query",
        "domain_index_coverage",
        "domain_index_drift",
        "domain_verification_gate_plan",
      ],
    });

    expect(catalog.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "domain_index_refresh", risk: "write", phase: "maintain" }),
        expect.objectContaining({ name: "domain_manifest_generate", risk: "read", phase: "gather" }),
        expect.objectContaining({ name: "domain_manifest_diff", risk: "read", phase: "verify" }),
        expect.objectContaining({ name: "domain_manifest_status", risk: "read", phase: "maintain" }),
        expect.objectContaining({ name: "domain_manifest_apply", risk: "write", phase: "maintain" }),
        expect.objectContaining({ name: "domain_slice_query", risk: "read", phase: "gather" }),
        expect.objectContaining({ name: "domain_index_coverage", risk: "read", phase: "verify" }),
        expect.objectContaining({ name: "domain_verification_gate_plan", plane: "verification", phase: "plan" }),
      ]),
    );
    expect(catalog.tools.find((tool) => tool.name === "domain_manifest_apply")?.inputs).toEqual(
      expect.arrayContaining(["baseHash", "refreshAfterApply"]),
    );
    expect(catalog.tools.find((tool) => tool.name === "domain_slice_query")?.inputs).toContain("requireFresh");
  });

  it("requires Claude manifest coverage or an explicit compact-manifest policy", () => {
    const manifest = readJson<{
      tools: Array<{ name: string }>;
      tool_manifest_policy?: {
        mode: string;
        source_of_truth: string;
        full_runtime_tool_surface: boolean;
        manifest_tools_are_curated: boolean;
        discovery_tools: string[];
      };
    }>(path.resolve("plugins/wormhole-claude-desktop/manifest.json"));
    const runtimeTools = registeredToolNames();
    const manifestTools = manifest.tools.map((tool) => tool.name).sort((left, right) =>
      left.localeCompare(right),
    );

    if (!manifest.tool_manifest_policy) {
      expect(manifestTools).toEqual(runtimeTools);
      return;
    }

    expect(manifest.tool_manifest_policy).toEqual({
      mode: "compact-guided",
      source_of_truth: "runtime-tool-registry",
      full_runtime_tool_surface: true,
      manifest_tools_are_curated: true,
      discovery_tools: ["tool_layer_map", "tool_catalog_query"],
    });
    expect(manifestTools).toEqual([...new Set(manifestTools)]);
    expect(manifestTools).toEqual(
      expect.arrayContaining([
        "tool_layer_map",
        "tool_catalog_query",
        "next_best_tool",
        "mission_route",
        "agent_context_prepare",
      ]),
    );
  });
});
