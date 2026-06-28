import { createDefaultCapabilityManifest, type WormholeCapabilityManifest } from "./capabilities.js";
import {
  CAPABILITY_RELATIONS,
  toolNamesForCapabilityRelation,
  type CapabilityRelation,
} from "./capability-relations.js";
import { TOOL_REGISTRY } from "./tool-registry.js";
import {
  createBugfixWorkflow,
  createFeatureWorkflow,
  createOnboardingWorkflow,
  createReviewWorkflow,
  type WorkflowSequence,
} from "./workflows.js";

export type CapabilityRelationGapKind =
  | "registry_runtime_drift"
  | "relation_unknown_capability"
  | "capability_no_relation"
  | "capability_no_tool"
  | "relation_tool_missing"
  | "relation_test_file_missing"
  | "workflow_tool_missing"
  | "tool_no_capability"
  | "tool_no_test"
  | "artifact_metadata_missing"
  | "stale_allowlist";

export type CapabilityRelationGapSeverity = "error" | "warning";

export type CapabilityRelationGapResolution =
  | "wire_relation"
  | "add_allowlist"
  | "mark_planned"
  | "add_test"
  | "remove_allowlist"
  | "needs_validation";

export type CapabilityRelationGap = {
  subject: string;
  kind: CapabilityRelationGapKind;
  severity: CapabilityRelationGapSeverity;
  resolution: CapabilityRelationGapResolution;
  message: string;
};

export type CapabilityRelationAuditInput = {
  manifest: WormholeCapabilityManifest;
  relations: CapabilityRelation[];
  registryToolNames: string[];
  runtimeToolNames?: string[];
  workflowToolNames?: string[];
  testFiles?: string[];
  allowlist?: string[];
};

export type CapabilityRelationAudit = {
  checked: {
    capabilities: number;
    relations: number;
    registryTools: number;
    runtimeTools?: number;
    workflowToolReferences: number;
  };
  errorCount: number;
  warningCount: number;
  gaps: CapabilityRelationGap[];
};

const ARTIFACT_RELATION_REQUIREMENTS = [
  {
    toolName: "workflow_write_artifacts",
    artifactKinds: ["workflow_state", "workflow_resume", "workflow_latest"],
    stateOwners: ["workflow-files"],
    freshnessChecks: ["workflow-artifact-freshness"],
  },
] as const;

export function auditCapabilityRelations(input: CapabilityRelationAuditInput): CapabilityRelationAudit {
  const capabilitiesById = new Map(input.manifest.capabilities.map((capability) => [capability.id, capability]));
  const relationsByCapabilityId = groupRelationsByCapabilityId(input.relations);
  const registryToolNames = uniqueSorted(input.registryToolNames);
  const runtimeToolNames = input.runtimeToolNames ? uniqueSorted(input.runtimeToolNames) : undefined;
  const workflowToolNames = uniqueSorted(input.workflowToolNames ?? []);
  const registryTools = new Set(registryToolNames);
  const relationTools = new Set(input.relations.flatMap(toolNamesForCapabilityRelation));
  const testFiles = new Set(input.testFiles ?? []);
  const rawGaps: CapabilityRelationGap[] = [];

  if (runtimeToolNames) {
    addSetDiffGaps({
      rawGaps,
      left: registryToolNames,
      right: new Set(runtimeToolNames),
      leftLabel: "registry",
      rightLabel: "runtime MCP server",
    });
    addSetDiffGaps({
      rawGaps,
      left: runtimeToolNames,
      right: registryTools,
      leftLabel: "runtime MCP server",
      rightLabel: "registry",
    });
  }

  for (const relation of input.relations) {
    const capability = capabilitiesById.get(relation.capabilityId);
    const tools = toolNamesForCapabilityRelation(relation);
    if (!capability) {
      rawGaps.push({
        subject: `capability:${relation.capabilityId}`,
        kind: "relation_unknown_capability",
        severity: "error",
        resolution: "wire_relation",
        message: `${relation.capabilityId} has a relation entry but is not declared in the capability manifest.`,
      });
    }
    if (tools.length === 0 && !relation.noToolReason) {
      rawGaps.push({
        subject: `capability:${relation.capabilityId}`,
        kind: "capability_no_tool",
        severity: "error",
        resolution: "wire_relation",
        message: `${relation.capabilityId} has a relation entry but no tools or explicit no-tool reason.`,
      });
    }
    for (const toolName of tools) {
      if (!registryTools.has(toolName)) {
        rawGaps.push({
          subject: `tool:${toolName}`,
          kind: "relation_tool_missing",
          severity: "error",
          resolution: "wire_relation",
          message: `${relation.capabilityId} references ${toolName}, but that tool is not in the registry.`,
        });
      }
    }
    if (tools.length > 0 && (relation.testFiles ?? []).length === 0 && testFiles.size > 0) {
      for (const toolName of tools) {
        rawGaps.push({
          subject: `tool:${toolName}`,
          kind: "tool_no_test",
          severity: "warning",
          resolution: "add_test",
          message: `${relation.capabilityId} maps ${toolName}, but the relation entry declares no test files.`,
        });
      }
    }
    for (const testFile of relation.testFiles ?? []) {
      if (!testFiles.has(testFile) && testFiles.size > 0) {
        rawGaps.push({
          subject: `test:${testFile}`,
          kind: "relation_test_file_missing",
          severity: "warning",
          resolution: "wire_relation",
          message: `${relation.capabilityId} declares ${testFile}, but that file was not found in the current test inventory.`,
        });
      }
    }
    for (const requirement of ARTIFACT_RELATION_REQUIREMENTS) {
      if (!tools.includes(requirement.toolName)) {
        continue;
      }
      const missingArtifactKinds = missingValues(requirement.artifactKinds, relation.artifactKinds);
      const missingStateOwners = missingValues(requirement.stateOwners, relation.stateOwners);
      const missingFreshnessChecks = missingValues(requirement.freshnessChecks, relation.freshnessChecks);
      if (
        missingArtifactKinds.length === 0 &&
        missingStateOwners.length === 0 &&
        missingFreshnessChecks.length === 0
      ) {
        continue;
      }
      rawGaps.push({
        subject: `tool:${requirement.toolName}`,
        kind: "artifact_metadata_missing",
        severity: "warning",
        resolution: "wire_relation",
        message: `${relation.capabilityId} maps ${requirement.toolName}, but is missing artifact/freshness relation metadata: ${[
          ...missingArtifactKinds.map((value) => `artifactKinds:${value}`),
          ...missingStateOwners.map((value) => `stateOwners:${value}`),
          ...missingFreshnessChecks.map((value) => `freshnessChecks:${value}`),
        ].join(", ")}.`,
      });
    }
  }

  for (const capability of input.manifest.capabilities) {
    if (capability.status !== "implemented") {
      continue;
    }
    if (!relationsByCapabilityId.has(capability.id)) {
      rawGaps.push({
        subject: `capability:${capability.id}`,
        kind: "capability_no_relation",
        severity: "error",
        resolution: "wire_relation",
        message: `${capability.id} is implemented but has no capability relation entry.`,
      });
    }
  }

  for (const toolName of workflowToolNames) {
    if (!registryTools.has(toolName)) {
      rawGaps.push({
        subject: `tool:${toolName}`,
        kind: "workflow_tool_missing",
        severity: "error",
        resolution: "wire_relation",
        message: `A workflow references ${toolName}, but that tool is not in the registry.`,
      });
    }
  }

  for (const toolName of registryToolNames) {
    if (!relationTools.has(toolName)) {
      rawGaps.push({
        subject: `tool:${toolName}`,
        kind: "tool_no_capability",
        severity: "warning",
        resolution: "wire_relation",
        message: `${toolName} is registered but is not owned by any capability relation.`,
      });
    }
  }

  const allowlist = new Set(input.allowlist ?? []);
  const rawSubjects = new Set(rawGaps.map((gap) => gap.subject));
  const gaps = uniqueGaps([
    ...rawGaps.filter((gap) => !allowlist.has(gap.subject)),
    ...[...allowlist]
      .filter((subject) => !rawSubjects.has(subject))
      .map((subject): CapabilityRelationGap => ({
        subject,
        kind: "stale_allowlist",
        severity: "warning",
        resolution: "remove_allowlist",
        message: `${subject} is allowlisted but no current relation gap uses it.`,
      })),
  ]);

  return {
    checked: {
      capabilities: input.manifest.capabilities.length,
      relations: input.relations.length,
      registryTools: registryToolNames.length,
      ...(runtimeToolNames ? { runtimeTools: runtimeToolNames.length } : {}),
      workflowToolReferences: workflowToolNames.length,
    },
    errorCount: gaps.filter((gap) => gap.severity === "error").length,
    warningCount: gaps.filter((gap) => gap.severity === "warning").length,
    gaps,
  };
}

export function createDefaultCapabilityRelationAuditInput(
  overrides: Partial<CapabilityRelationAuditInput> = {},
): CapabilityRelationAuditInput {
  const repoRoot = "/repo";
  return {
    manifest: createDefaultCapabilityManifest(),
    relations: CAPABILITY_RELATIONS,
    registryToolNames: TOOL_REGISTRY.map((tool) => tool.name),
    workflowToolNames: collectWorkflowToolNames([
      createFeatureWorkflow({ repoRoot, objective: "Audit capability relations" }),
      createBugfixWorkflow({ repoRoot, objective: "Audit capability relations" }),
      createReviewWorkflow({ repoRoot, objective: "Audit capability relations" }),
      createOnboardingWorkflow({ repoRoot, objective: "Audit capability relations" }),
    ]),
    ...overrides,
  };
}

export function collectWorkflowToolNames(workflows: WorkflowSequence[]): string[] {
  return uniqueSorted(
    workflows.flatMap((workflow) => [
      ...workflow.nextCalls.map((call) => call.toolName),
      ...workflow.phases.flatMap((phase) => phase.calls.map((call) => call.toolName)),
      workflow.exactNextAction.toolName,
    ]),
  );
}

function addSetDiffGaps(input: {
  rawGaps: CapabilityRelationGap[];
  left: string[];
  right: Set<string>;
  leftLabel: string;
  rightLabel: string;
}): void {
  for (const toolName of input.left) {
    if (input.right.has(toolName)) {
      continue;
    }
    input.rawGaps.push({
      subject: `tool:${toolName}`,
      kind: "registry_runtime_drift",
      severity: "error",
      resolution: "needs_validation",
      message: `${toolName} appears in the ${input.leftLabel} but not in the ${input.rightLabel}.`,
    });
  }
}

function groupRelationsByCapabilityId(relations: CapabilityRelation[]): Map<string, CapabilityRelation[]> {
  const grouped = new Map<string, CapabilityRelation[]>();
  for (const relation of relations) {
    grouped.set(relation.capabilityId, [...(grouped.get(relation.capabilityId) ?? []), relation]);
  }
  return grouped;
}

function uniqueGaps(gaps: CapabilityRelationGap[]): CapabilityRelationGap[] {
  const byKey = new Map<string, CapabilityRelationGap>();
  for (const gap of gaps) {
    byKey.set(`${gap.kind}\0${gap.subject}\0${gap.message}`, gap);
  }
  return [...byKey.values()].sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity.localeCompare(right.severity);
    }
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.subject.localeCompare(right.subject);
  });
}

function missingValues(required: readonly string[], actual: readonly string[] | undefined): string[] {
  const actualValues = new Set(actual ?? []);
  return required.filter((value) => !actualValues.has(value));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
