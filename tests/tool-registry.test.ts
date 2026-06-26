import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createWormholeMcpServer } from "../src/mcp-server.js";
import {
  TOOL_REGISTRY,
  queryToolCatalog,
  toolExposureProfile,
  toolLayerMap,
  validateToolRegistry,
} from "../src/tool-registry.js";

function registeredToolNames(): string[] {
  const server = createWormholeMcpServer(createInMemoryKernel());
  return Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort(
    (left, right) => left.localeCompare(right),
  );
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
        "mission_route",
        "agent_context_prepare",
        "state_maintenance_run",
        "gate_request",
      ]),
    );
    expect(layered.visibleTools).not.toContain("patch_apply");
    expect(layered.hiddenToolCount).toBeGreaterThan(0);
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
