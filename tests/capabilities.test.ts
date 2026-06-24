import { describe, expect, it } from "vitest";
import { createDefaultCapabilityManifest } from "../src/capabilities.js";

describe("capability manifest", () => {
  it("declares v1 implemented capability plus v2 and v3 planned tracks", () => {
    const manifest = createDefaultCapabilityManifest();

    expect(manifest.maxOrchestrationDepth).toBe(4);
    expect(manifest.connectors.map((connector) => connector.target)).toEqual([
      "generic-mcp",
      "claude-code",
      "claude-desktop",
      "codex",
      "hermes-agent",
      "inflection-pi",
    ]);
    expect(new Set(manifest.capabilities.map((capability) => capability.track))).toEqual(
      new Set(["v1", "v2", "v3"]),
    );
    expect(manifest.capabilities.some((capability) => capability.status === "implemented")).toBe(
      true,
    );
  });

  it("declares first-party optimization primitives as implemented", () => {
    const manifest = createDefaultCapabilityManifest();

    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        id: "v2.first-party-optimization-primitives",
        status: "implemented",
      }),
    );
  });

  it("declares live sub-orchestrator control as implemented", () => {
    const manifest = createDefaultCapabilityManifest();

    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        id: "v2.live-sub-orchestrator-control",
        status: "implemented",
      }),
    );
  });

  it("declares the repo-local Codex connector as implemented", () => {
    const manifest = createDefaultCapabilityManifest();

    expect(manifest.connectors).toContainEqual(
      expect.objectContaining({
        target: "codex",
        status: "implemented",
        transport: "plugin-manifest",
      }),
    );
  });

  it("declares Claude Desktop and external agent connector targets", () => {
    const manifest = createDefaultCapabilityManifest();

    expect(manifest.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "claude-desktop",
          status: "implemented",
          transport: "mcpb",
        }),
        expect.objectContaining({
          target: "hermes-agent",
          status: "implemented",
          transport: "agent-adapter",
        }),
        expect.objectContaining({
          target: "inflection-pi",
          status: "implemented",
          transport: "provider-api",
        }),
      ]),
    );
  });

  it("declares the remaining v2 and v3 foundations as implemented", () => {
    const manifest = createDefaultCapabilityManifest();
    const implementedIds = manifest.capabilities
      .filter((capability) => capability.status === "implemented")
      .map((capability) => capability.id);

    expect(implementedIds).toEqual(
      expect.arrayContaining([
        "v2.parallel-sub-orchestrators",
        "v2.content-addressed-evidence-cache",
        "v2.reconciliation-engine",
        "v2.benchmark-runner",
        "v2.codex-runtime-adapter",
        "v2.external-agent-adapters",
        "v3.adaptive-routing-model-selection",
        "v3.connector-registry",
        "v3.dynamic-task-spawning",
        "v3.model-pool-orchestration",
        "v3.workbench-artifacts",
        "v3.rich-artifact-types",
      ]),
    );
  });
});
