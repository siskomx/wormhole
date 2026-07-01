import { describe, expect, it } from "vitest";
import { auditToolSurface } from "../src/tool-surface-audit.js";
import { TOOL_REGISTRY } from "../src/tool-registry.js";

const HIGH_LEVEL_GUIDED_TOOLS = [
  "project_onboard",
  "repo_intelligence_search",
  "repo_relation_query",
  "change_impact_analyze",
  "context_pack_generate",
  "test_plan_select",
  "verification_run",
  "record_evidence",
  "gate_request",
] as const;

const LOW_LEVEL_DISCOVERY_TOOLS = [
  "repo_index_query",
  "repo_index_explain",
  "repo_index_path",
  "repo_graph_analyze",
  "graph_node_semantic_search",
  "semantic_search",
  "durable_repo_index_query",
  "durable_semantic_search",
] as const;

describe("tool surface audit", () => {
  it("guides high-level large-repo workflow tools", () => {
    const audit = auditToolSurface({ registry: TOOL_REGISTRY });
    const exposureByName = new Map(audit.exposures.map((exposure) => [exposure.tool.name, exposure]));

    expect(audit.mode).toBe("guided");
    for (const toolName of HIGH_LEVEL_GUIDED_TOOLS) {
      expect(exposureByName.get(toolName)).toEqual(
        expect.objectContaining({
          availability: "guided",
          mode: "guided",
          hidden: false,
        }),
      );
    }
  });

  it("keeps low-level graph semantic and index tools catalog or expert available", () => {
    const audit = auditToolSurface({ registry: TOOL_REGISTRY });
    const exposureByName = new Map(audit.exposures.map((exposure) => [exposure.tool.name, exposure]));

    for (const toolName of LOW_LEVEL_DISCOVERY_TOOLS) {
      expect(exposureByName.get(toolName)).toEqual(
        expect.objectContaining({
          hidden: false,
          availability: expect.stringMatching(/^(catalog|expert)$/),
        }),
      );
    }
  });

  it("recommends high-level primitives for duplicate capability groups", () => {
    const audit = auditToolSurface({ registry: TOOL_REGISTRY });
    const duplicateById = new Map(audit.duplicateCapabilityGroups.map((group) => [group.groupId, group]));

    expect(duplicateById.get("large-repo-search")).toEqual(
      expect.objectContaining({
        recommendedTool: "repo_intelligence_search",
        duplicateTools: expect.arrayContaining([
          "repo_index_query",
          "durable_repo_index_query",
          "graph_node_semantic_search",
          "semantic_search",
        ]),
      }),
    );
    expect(duplicateById.get("change-impact")).toEqual(
      expect.objectContaining({
        recommendedTool: "change_impact_analyze",
        duplicateTools: expect.arrayContaining(["impact_analyze", "test_impact_analyze_v2", "blast_radius_analyze"]),
      }),
    );
    expect(duplicateById.get("context-evidence-gate")).toEqual(
      expect.objectContaining({
        recommendedTool: "context_pack_generate",
        duplicateTools: expect.arrayContaining(["ctx_pack_create", "ctx_pack_refresh", "cache_evidence"]),
      }),
    );
  });

  it("keeps the guided tier under the bounded surface cap", () => {
    const audit = auditToolSurface({ registry: TOOL_REGISTRY });

    expect(audit.guidedToolCount).toBeLessThanOrEqual(80);
    expect(audit.tiers.guided.toolNames).toHaveLength(audit.guidedToolCount);
    expect(audit.warnings).not.toContain("Guided tier exceeds the advisory cap of 80 tools.");
  });
});
