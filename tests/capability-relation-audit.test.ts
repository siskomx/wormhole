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
    const toolSurfaceTools = [
      "tool_profile_list",
      "tool_profile_get",
      "tool_search",
      "tool_promote",
      "tool_promotion_status",
    ];
    const agentFacingRelation = CAPABILITY_RELATIONS.find(
      (relation) => relation.capabilityId === "adaptive.agent-facing-routing",
    );
    const toolSurfaceRelation = CAPABILITY_RELATIONS.find(
      (relation) => relation.capabilityId === "adaptive.tool-surface-compression",
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
          ...toolSurfaceTools,
          "ctx_pack_refresh",
          "durable_repo_index_query",
          "durable_index_manifest_status",
          "context_pack_generate",
          "runtime_behavior_audit",
        ]),
        stateOwners: expect.arrayContaining([
          "context-store",
          "durable-index-store",
          "workflow-files",
        ]),
        artifactKinds: expect.arrayContaining(["context_pack", "workflow_state", "workflow_resume", "workflow_latest"]),
        freshnessChecks: expect.arrayContaining(["durable-index-status", "workflow-artifact-freshness"]),
      }),
    );
    for (const toolName of toolSurfaceTools) {
      expect(agentFacingRelation?.primaryTools ?? []).not.toContain(toolName);
    }
    expect(agentFacingRelation?.stateOwners ?? []).not.toContain("tool-promotion-state");
    expect(toolSurfaceRelation).toEqual(
      expect.objectContaining({
        primaryTools: expect.arrayContaining(toolSurfaceTools),
        stateOwners: expect.arrayContaining(["tool-promotion-state"]),
        testFiles: expect.arrayContaining([
          "tests/tool-profiles.test.ts",
          "tests/tool-registry.test.ts",
          "tests/agent-routing.test.ts",
          "tests/tools.test.ts",
          "tests/runtime-persistence.test.ts",
        ]),
      }),
    );
    expect(CAPABILITY_RELATIONS).toContainEqual(
      expect.objectContaining({
        capabilityId: "orchestration.app-process-compiler",
        artifactKinds: expect.arrayContaining(["app-process", "roadmap", "backlog", "lifecycle"]),
      }),
    );
    expect(CAPABILITY_RELATIONS).toContainEqual(
      expect.objectContaining({
        capabilityId: "orchestration.repo-native-coverage-pack",
        primaryTools: expect.arrayContaining(["repo_native_pack_build", "feature_slice_query"]),
        supportingTools: expect.arrayContaining([
          "project_onboard",
          "agent_context_prepare",
          "mission_delta_replan",
          "source_conflicts_analyze",
          "capability_relation_audit",
        ]),
        artifactKinds: expect.arrayContaining(["repo_native_pack", "feature_slice"]),
        freshnessChecks: expect.arrayContaining(["repo-native-pack-fingerprint", "relation-test-file-exists"]),
      }),
    );
    expect(CAPABILITY_RELATIONS).toContainEqual(
      expect.objectContaining({
        capabilityId: "orchestration.domain-indexing-layer",
        primaryTools: expect.arrayContaining([
          "domain_index_refresh",
          "domain_manifest_generate",
          "domain_manifest_diff",
          "domain_manifest_apply",
          "domain_slice_query",
          "domain_api_query",
          "domain_verification_gate_plan",
        ]),
        supportingTools: expect.arrayContaining([
          "repo_native_pack_build",
          "feature_slice_query",
          "durable_repo_index_refresh",
          "durable_index_status",
          "source_conflicts_analyze",
          "project_contract_detect",
          "test_plan_select",
          "verification_run",
          "discovery_openapi_import",
          "capability_relation_audit",
        ]),
        stateOwners: expect.arrayContaining(["sqlite-domain-index", "domain-index-manifest"]),
        freshnessChecks: expect.arrayContaining(["domain-index-status", "domain-index-drift"]),
      }),
    );
    expect(CAPABILITY_RELATIONS).toContainEqual(
      expect.objectContaining({
        capabilityId: "orchestration.repo-reachability-review",
        primaryTools: expect.arrayContaining(["repo_reachability_analyze"]),
        supportingTools: expect.arrayContaining([
          "repo_graph_analyze",
          "entrypoint_flow_discover",
          "workspace_graph_analyze",
          "code_smell_scan",
          "diff_scope_review",
          "gate_request",
          "runtime_behavior_audit",
          "capability_relation_audit",
        ]),
        freshnessChecks: expect.arrayContaining(["repo-index-health", "workspace-boundary-model"]),
      }),
    );
    expect(CAPABILITY_RELATIONS).toContainEqual(
      expect.objectContaining({
        capabilityId: "orchestration.resume-continuation",
        primaryTools: expect.arrayContaining(["resume_record", "resume_checkpoint", "resume_validate", "resume_load"]),
        stateOwners: expect.arrayContaining(["resume-store"]),
        artifactKinds: expect.arrayContaining(["resume_latest", "resume_checkpoint"]),
        testFiles: expect.arrayContaining([
          "tests/resume-store.test.ts",
          "tests/runtime-persistence.test.ts",
          "tests/tools.test.ts",
        ]),
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

  it("warns when relation test file metadata points at missing files", () => {
    const audit = auditCapabilityRelations({
      manifest: {
        ...createDefaultCapabilityManifest(),
        capabilities: [
          {
            id: "core.test-file-missing",
            area: "core",
            status: "implemented",
            description: "Implemented with stale relation test metadata.",
          },
        ],
      },
      relations: [
        {
          capabilityId: "core.test-file-missing",
          primaryTools: ["known_tool"],
          testFiles: ["tests/missing-relation-test.test.ts"],
        },
      ],
      registryToolNames: ["known_tool"],
      runtimeToolNames: ["known_tool"],
      workflowToolNames: [],
      testFiles: ["tests/known-tool.test.ts"],
    });

    expect(audit.gaps).toContainEqual(
      expect.objectContaining({
        kind: "relation_test_file_missing",
        subject: "test:tests/missing-relation-test.test.ts",
        severity: "warning",
        resolution: "wire_relation",
      }),
    );
  });

  it("declares the resume validation freshness check", () => {
    const relation = CAPABILITY_RELATIONS.find(
      (r) => r.capabilityId === "orchestration.resume-continuation",
    );
    expect(relation?.freshnessChecks).toContain("resume-validation-status");
  });

  it("exposes the relation audit through the public tool handler", () => {
    const tools = createToolHandlers(createInMemoryKernel());

    const audit = tools.capabilityRelationAudit();

    expect(audit.errorCount).toBe(0);
    expect(audit.checked.capabilities).toBeGreaterThan(0);
    expect(audit.checked.relations).toBe(CAPABILITY_RELATIONS.length);
  });
});
