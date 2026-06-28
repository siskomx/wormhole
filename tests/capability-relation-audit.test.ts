import { describe, expect, it } from "vitest";
import { createDefaultCapabilityManifest, createInMemoryKernel, createToolHandlers, createWormholeMcpServer } from "../src/index.js";
import {
  auditCapabilityRelations,
  createDefaultCapabilityRelationAuditInput,
} from "../src/capability-relation-audit.js";
import { CAPABILITY_RELATIONS } from "../src/capability-relations.js";

function runtimeToolNames(): string[] {
  const server = createWormholeMcpServer(createInMemoryKernel());
  return Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort(
    (left, right) => left.localeCompare(right),
  );
}

describe("capability relation audit", () => {
  it("reports structural relation gaps for missing capability, tool, and workflow links", () => {
    const manifest = {
      ...createDefaultCapabilityManifest(),
      capabilities: [
        {
          id: "core.implemented-without-relation",
          area: "core" as const,
          status: "implemented" as const,
          description: "Implemented but not wired.",
        },
        {
          id: "core.implemented-with-missing-tool",
          area: "core" as const,
          status: "implemented" as const,
          description: "Implemented with a relation that points at a missing tool.",
        },
      ],
    };

    const audit = auditCapabilityRelations({
      manifest,
      relations: [
        {
          capabilityId: "core.implemented-with-missing-tool",
          primaryTools: ["missing_tool"],
          workflows: ["workflow_start_feature"],
        },
        {
          capabilityId: "core.unknown-capability",
          primaryTools: ["known_tool"],
        },
      ],
      registryToolNames: ["known_tool"],
      runtimeToolNames: ["known_tool", "runtime_only"],
      workflowToolNames: ["missing_workflow_tool"],
      testFiles: ["tests/known-tool.test.ts"],
    });

    expect(audit.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "capability_no_relation",
          subject: "capability:core.implemented-without-relation",
          severity: "error",
        }),
        expect.objectContaining({
          kind: "relation_tool_missing",
          subject: "tool:missing_tool",
          severity: "error",
        }),
        expect.objectContaining({
          kind: "relation_unknown_capability",
          subject: "capability:core.unknown-capability",
          severity: "error",
        }),
        expect.objectContaining({
          kind: "workflow_tool_missing",
          subject: "tool:missing_workflow_tool",
          severity: "error",
        }),
        expect.objectContaining({
          kind: "registry_runtime_drift",
          subject: "tool:runtime_only",
          severity: "error",
        }),
      ]),
    );
    expect(audit.errorCount).toBeGreaterThanOrEqual(5);
  });

  it("keeps the default implemented capabilities structurally wired", () => {
    const audit = auditCapabilityRelations(
      createDefaultCapabilityRelationAuditInput({
        runtimeToolNames: runtimeToolNames(),
      }),
    );

    expect(audit.gaps.filter((gap) => gap.severity === "error")).toEqual([]);
    expect(CAPABILITY_RELATIONS).toContainEqual(
      expect.objectContaining({
        capabilityId: "orchestration.project-ground-truth-suite",
        primaryTools: expect.arrayContaining(["source_conflicts_analyze"]),
      }),
    );
    expect(CAPABILITY_RELATIONS).toContainEqual(
      expect.objectContaining({
        capabilityId: "adaptive.agent-facing-routing",
        supportingTools: expect.arrayContaining([
          "ctx_pack_refresh",
          "durable_repo_index_query",
          "durable_index_manifest_status",
          "context_pack_generate",
        ]),
        stateOwners: expect.arrayContaining(["context-store", "durable-index-store", "workflow-files"]),
        artifactKinds: expect.arrayContaining(["context_pack", "workflow_state", "workflow_resume", "workflow_latest"]),
        freshnessChecks: expect.arrayContaining(["durable-index-status", "workflow-artifact-freshness"]),
      }),
    );
  });

  it("warns when workflow artifact writers omit artifact freshness metadata", () => {
    const audit = auditCapabilityRelations({
      manifest: {
        ...createDefaultCapabilityManifest(),
        capabilities: [
          {
            id: "adaptive.agent-facing-routing",
            area: "adaptive",
            status: "implemented",
            description: "Routes coding agents through workflow tools.",
          },
        ],
      },
      relations: [
        {
          capabilityId: "adaptive.agent-facing-routing",
          primaryTools: ["workflow_write_artifacts"],
          testFiles: ["tests/workflows.test.ts"],
        },
      ],
      registryToolNames: ["workflow_write_artifacts"],
      testFiles: ["tests/workflows.test.ts"],
    });

    expect(audit.gaps).toContainEqual(
      expect.objectContaining({
        kind: "artifact_metadata_missing",
        subject: "tool:workflow_write_artifacts",
        severity: "warning",
        resolution: "wire_relation",
      }),
    );
  });

  it("exposes the relation audit through the public tool handler", () => {
    const tools = createToolHandlers(createInMemoryKernel());

    const audit = tools.capabilityRelationAudit();

    expect(audit.errorCount).toBe(0);
    expect(audit.checked.capabilities).toBeGreaterThan(0);
    expect(audit.checked.relations).toBe(CAPABILITY_RELATIONS.length);
  });
});
