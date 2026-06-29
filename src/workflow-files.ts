import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SourceConflict, SourceProvenance } from "./source-authority.js";
import type { WorkflowArtifactRequirement, WorkflowFeatureBinding, WorkflowSequence } from "./workflows.js";

export type WorkflowArtifactFile = {
  relativePath: string;
  absolutePath: string;
  bytes: number;
};

export type WorkflowArtifactWriteResult = {
  repoRoot: string;
  artifactWriteStatus: {
    generated: true;
    status: "written";
    message: string;
  };
  files: WorkflowArtifactFile[];
  requiredArtifacts: WorkflowRequiredArtifactStatus[];
};

export type WorkflowRequiredArtifactStatus = {
  relativePath: string;
  absolutePath: string;
  kind: WorkflowArtifactRequirement["kind"];
  requiredStatus: WorkflowArtifactRequirement["status"];
  description: string;
  status: "written" | "missing";
  bytes?: number;
};

export type WriteWorkflowArtifactsInput = {
  repoRoot: string;
  workflow: WorkflowSequence;
};

export function writeWorkflowArtifacts(input: WriteWorkflowArtifactsInput): WorkflowArtifactWriteResult {
  const repoRoot = path.resolve(input.repoRoot);
  mkdirSync(resolveRepoPath(repoRoot, ".wormhole/workflows"), { recursive: true });

  const runPath = `.wormhole/workflows/${input.workflow.run.runId}.json`;
  const resumePath = `.wormhole/workflows/${input.workflow.run.runId}.md`;
  const latest = {
    runId: input.workflow.run.runId,
    workflowPath: runPath,
    resumePath,
  };

  const files = [
    writeArtifact(repoRoot, ".wormhole/workflows/latest.json", `${JSON.stringify(latest, null, 2)}\n`),
    writeArtifact(repoRoot, runPath, `${JSON.stringify(input.workflow, null, 2)}\n`),
    writeArtifact(repoRoot, resumePath, renderWorkflowResumeMarkdown(input.workflow)),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const fileByPath = new Map(files.map((file) => [file.relativePath, file]));

  return {
    repoRoot,
    artifactWriteStatus: {
      generated: true,
      status: "written",
      message: "Workflow artifacts were written to .wormhole/workflows.",
    },
    files,
    requiredArtifacts: input.workflow.requiredArtifacts
      .map((artifact) => {
        const file = fileByPath.get(artifact.path);
        const absolutePath = file?.absolutePath ?? resolveRepoPath(repoRoot, artifact.path);
        return {
          relativePath: artifact.path,
          absolutePath,
          kind: artifact.kind,
          requiredStatus: artifact.status,
          description: artifact.description,
          status: file && existsSync(absolutePath) ? "written" as const : "missing" as const,
          ...(file ? { bytes: file.bytes } : {}),
        };
      })
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
}

export function renderWorkflowResumeMarkdown(workflow: WorkflowSequence): string {
  const features = workflow.featureBindings.length > 0
    ? workflow.featureBindings.flatMap(renderFeatureBinding)
    : ["- No matching feature binding detected.", ""];
  const supportingDocs = workflow.resume.supportingDocs.length > 0
    ? workflow.resume.supportingDocs.map((source) => `- ${formatSourceProvenance(source)}`)
    : ["- None detected.", ""];
  const conflicts = workflow.resume.conflicts.length > 0
    ? workflow.resume.conflicts.map((conflict) => `- ${formatConflict(conflict)}`)
    : ["- None detected.", ""];
  return [
    "# Workflow Resume",
    "",
    `Workflow: ${workflow.workflow}`,
    `Run: ${workflow.run.runId}`,
    `Status: ${workflow.run.status}`,
    `Objective: ${workflow.objective}`,
    "",
    "## Exact Next Action",
    "",
    `Phase: ${workflow.exactNextAction.phase}`,
    `Tool: ${workflow.exactNextAction.toolName}`,
    `Reason: ${workflow.exactNextAction.reason}`,
    "",
    "## Feature Bindings",
    "",
    ...features,
    "## Verification Contract",
    "",
    `Tier: ${workflow.verificationContract.tier}`,
    `Commands source: ${workflow.verificationContract.commandsSource}`,
    `Required tools: ${workflow.verificationContract.requiredTools.join(", ") || "none"}`,
    "",
    "## Source Of Truth",
    "",
    ...workflow.resume.sourceOfTruth.map((source) => `- ${formatSourceProvenance(source)}`),
    "",
    "## Supporting Docs",
    "",
    ...supportingDocs,
    "## Conflicts / Validation Needed",
    "",
    ...conflicts,
    "",
  ].join("\n");
}

function renderFeatureBinding(feature: WorkflowFeatureBinding): string[] {
  return [
    `### ${feature.name} (${feature.featureId})`,
    "",
    `Files: ${feature.fileCount}`,
    `Roots: ${feature.roots.join(", ") || "none"}`,
    `Side effects: ${feature.sideEffects.join(", ") || "none detected"}`,
    "",
    "Source of truth:",
    ...(feature.sourceOfTruth.length > 0
      ? feature.sourceOfTruth.slice(0, 12).map((source) => `- ${formatSourceProvenance(source)}`)
      : ["- None detected."]),
    "",
    "Supporting docs:",
    ...(feature.supportingDocs.length > 0
      ? feature.supportingDocs.slice(0, 8).map((source) => `- ${formatSourceProvenance(source)}`)
      : ["- None detected."]),
    "",
  ];
}

function formatSourceProvenance(source: SourceProvenance): string {
  return `${source.sourcePath} [${source.authority}, freshness=${source.freshness}, score=${source.authorityScore.toFixed(2)}]`;
}

function formatConflict(conflict: SourceConflict): string {
  return `${conflict.severity}: ${conflict.message}`;
}

function writeArtifact(repoRoot: string, relativePath: string, content: string): WorkflowArtifactFile {
  const normalizedContent = `${content.trimEnd()}\n`;
  const absolutePath = resolveRepoPath(repoRoot, relativePath);
  writeFileSync(absolutePath, normalizedContent);
  return {
    relativePath,
    absolutePath,
    bytes: Buffer.byteLength(normalizedContent, "utf8"),
  };
}

function resolveRepoPath(repoRoot: string, relativePath: string): string {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relativeToRoot = path.relative(repoRoot, absolutePath);
  if (relativeToRoot === "" || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Workflow artifact path must stay within repoRoot");
  }
  return absolutePath;
}
