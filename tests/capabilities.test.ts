import { describe, expect, it } from "vitest";
import { createDefaultCapabilityManifest } from "../src/capabilities.js";

describe("capability manifest", () => {
  it("declares implemented capabilities by area instead of version track", () => {
    const manifest = createDefaultCapabilityManifest();

    expect(manifest.maxOrchestrationDepth).toBe(4);
    expect(manifest.connectors.map((connector) => connector.target)).toEqual([
      "generic-mcp",
      "claude-code",
      "claude-desktop",
      "codex",
      "printing-press",
      "graphify",
      "python-sidecar",
      "hermes-agent",
      "inflection-pi",
    ]);
    expect(new Set(manifest.capabilities.map((capability) => capability.area))).toEqual(
      new Set(["core", "orchestration", "adaptive"]),
    );
    expect(manifest.capabilities.map((capability) => capability.id)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^v\d\./),
      ]),
    );
    expect(manifest.capabilities.some((capability) => capability.status === "implemented")).toBe(
      true,
    );
  });

  it("declares first-party optimization primitives as implemented", () => {
    const manifest = createDefaultCapabilityManifest();

    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        id: "orchestration.first-party-optimization-primitives",
        status: "implemented",
      }),
    );
  });

  it("declares live sub-orchestrator control as implemented", () => {
    const manifest = createDefaultCapabilityManifest();

    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        id: "orchestration.live-sub-orchestrator-control",
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
          target: "printing-press",
          status: "implemented",
          transport: "printing-press-cli",
        }),
        expect.objectContaining({
          target: "graphify",
          status: "implemented",
          transport: "graph-index",
        }),
        expect.objectContaining({
          target: "python-sidecar",
          status: "implemented",
          transport: "connector-contract",
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

  it("declares orchestration and adaptive foundations as implemented", () => {
    const manifest = createDefaultCapabilityManifest();
    const implementedIds = manifest.capabilities
      .filter((capability) => capability.status === "implemented")
      .map((capability) => capability.id);

    expect(implementedIds).toEqual(
      expect.arrayContaining([
        "orchestration.parallel-sub-orchestrators",
        "orchestration.external-optimization-adapters",
        "orchestration.native-context-packs",
        "orchestration.reversible-optimization-pipeline",
        "orchestration.content-addressed-evidence-cache",
        "orchestration.reconciliation-engine",
        "orchestration.benchmark-runner",
        "orchestration.codex-runtime-adapter",
        "orchestration.external-agent-adapters",
        "orchestration.printing-press-cli-adapters",
        "orchestration.printed-tool-runtime",
        "orchestration.repo-index-graph",
        "orchestration.project-ground-truth-suite",
        "orchestration.project-intelligence-sequencing",
        "orchestration.native-project-intelligence-spine",
        "orchestration.graph-artifact-suite",
        "orchestration.optimized-command-runner",
        "orchestration.native-tool-factory",
        "orchestration.local-runner",
        "adaptive.routing-model-selection",
        "adaptive.connector-registry",
        "adaptive.graph-first-codebase-query",
        "adaptive.model-profile-learning",
        "adaptive.optional-python-sidecar",
        "adaptive.deterministic-conductor",
        "adaptive.durable-behavior-policy",
        "adaptive.native-media-ingestion",
        "adaptive.shell-hook-manager",
        "adaptive.discovery-tool-generation",
        "adaptive.learned-orchestration-policy",
        "adaptive.orchestration-policy-lab",
        "adaptive.dynamic-task-spawning",
        "adaptive.model-pool-orchestration",
        "adaptive.workbench-artifacts",
        "adaptive.rich-artifact-types",
      ]),
    );
  });

  it("describes the stronger runtime-backed agent tooling contracts", () => {
    const manifest = createDefaultCapabilityManifest();

    expect(
      manifest.capabilities.find((capability) => capability.id === "orchestration.native-context-packs")
        ?.description,
    ).toMatch(/durable/i);
    expect(
      manifest.capabilities.find((capability) => capability.id === "orchestration.external-agent-adapters")
        ?.description,
    ).toContain("CLI/HTTP execution");
    expect(
      manifest.capabilities.find((capability) => capability.id === "orchestration.native-tool-factory")
        ?.description,
    ).toContain("validated workspace writes");
  });
});
