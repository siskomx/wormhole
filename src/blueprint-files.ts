import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  renderAgentContext,
  scanBlueprintLanes,
  type BlueprintCompileResult,
  type BlueprintCoverageStatus,
  type BlueprintLaneArtifact,
  type BlueprintLaneSummary,
} from "./blueprint.js";
import { renderFeatureIndexMarkdown } from "./feature-index.js";

export type BlueprintArtifactFile = {
  relativePath: string;
  absolutePath: string;
  bytes: number;
};

export type BlueprintArtifactWriteResult = {
  repoRoot: string;
  files: BlueprintArtifactFile[];
};

export type WriteBlueprintArtifactsInput = {
  repoRoot: string;
  result: BlueprintCompileResult;
};

export function writeBlueprintArtifacts(input: WriteBlueprintArtifactsInput): BlueprintArtifactWriteResult {
  const repoRoot = path.resolve(input.repoRoot);
  const outputDir = resolveRepoPath(repoRoot, ".wormhole");
  mkdirSync(outputDir, { recursive: true });

  const markdown = input.result.agentContextMarkdown || renderAgentContext(input.result);
  const files = [
    writeArtifact(repoRoot, ".wormhole/agent-context.md", `${markdown.trimEnd()}\n`),
    writeArtifact(repoRoot, ".wormhole/blueprint.json", `${JSON.stringify(input.result.blueprint, null, 2)}\n`),
    writeArtifact(repoRoot, ".wormhole/constraints.json", `${JSON.stringify(input.result.constraints, null, 2)}\n`),
    writeArtifact(repoRoot, ".wormhole/feature-index.json", `${JSON.stringify(input.result.blueprint.featureIndex, null, 2)}\n`),
    writeArtifact(repoRoot, ".wormhole/feature-index.md", `${renderFeatureIndexMarkdown(input.result.blueprint.featureIndex).trimEnd()}\n`),
  ];

  return {
    repoRoot,
    files,
  };
}

export type WriteProgressiveBlueprintArtifactsInput = WriteBlueprintArtifactsInput & {
  status?: BlueprintCoverageStatus;
  completedLanes?: string[];
};

export function writeProgressiveBlueprintArtifacts(
  input: WriteProgressiveBlueprintArtifactsInput,
): BlueprintArtifactWriteResult {
  const repoRoot = path.resolve(input.repoRoot);
  const outputDir = resolveRepoPath(repoRoot, ".wormhole");
  const lanesDir = resolveRepoPath(repoRoot, ".wormhole/lanes");
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(lanesDir, { recursive: true });

  const completedLanes = new Set(input.completedLanes ?? []);
  const laneArtifacts = scanBlueprintLanes(repoRoot).map((lane) => ({
    ...lane,
    status: completedLanes.has(lane.lane) ? "complete" as const : "pending" as const,
  }));
  const status = input.status ?? (laneArtifacts.every((lane) => lane.status === "complete") ? "complete" : "partial");
  const laneSummaries = laneArtifacts.map(toLaneSummary);
  const progressiveBlueprint = {
    schemaVersion: "blueprint-progress.v0",
    kind: "existing_repo",
    status,
    blueprintId: input.result.blueprint.blueprintId,
    generatedAt: input.result.blueprint.generatedAt,
    objective: input.result.blueprint.objective,
    repoRoot: input.result.blueprint.repoRoot,
    fingerprint: input.result.blueprint.fingerprint,
    fields: input.result.blueprint.fields,
    approvalNeeded: input.result.approvalNeeded,
    constraintsPath: ".wormhole/constraints.json",
    agentContextPath: ".wormhole/agent-context.md",
    featureIndexPath: ".wormhole/feature-index.json",
    lanes: laneSummaries,
  };
  const markdown = renderAgentContext({
    ...input.result,
    progressive: { status, lanes: laneSummaries },
  });

  const files = [
    writeArtifact(repoRoot, ".wormhole/agent-context.md", `${markdown.trimEnd()}\n`),
    writeArtifact(repoRoot, ".wormhole/blueprint.json", `${JSON.stringify(progressiveBlueprint, null, 2)}\n`),
    writeArtifact(repoRoot, ".wormhole/constraints.json", `${JSON.stringify(input.result.constraints, null, 2)}\n`),
    writeArtifact(repoRoot, ".wormhole/feature-index.json", `${JSON.stringify(input.result.blueprint.featureIndex, null, 2)}\n`),
    writeArtifact(repoRoot, ".wormhole/feature-index.md", `${renderFeatureIndexMarkdown(input.result.blueprint.featureIndex).trimEnd()}\n`),
    ...laneArtifacts.map((lane) =>
      writeArtifact(repoRoot, `.wormhole/lanes/${lane.lane}.json`, `${JSON.stringify(lane, null, 2)}\n`),
    ),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    repoRoot,
    files,
  };
}

function toLaneSummary(lane: BlueprintLaneArtifact): BlueprintLaneSummary {
  return {
    lane: lane.lane,
    status: lane.status,
    fileCount: lane.fileCount,
    roots: lane.roots,
    sampleFiles: lane.sampleFiles,
    artifactPath: lane.artifactPath,
  };
}

function writeArtifact(repoRoot: string, relativePath: string, content: string): BlueprintArtifactFile {
  const absolutePath = resolveRepoPath(repoRoot, relativePath);
  writeFileSync(absolutePath, content);
  return {
    relativePath,
    absolutePath,
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

function resolveRepoPath(repoRoot: string, relativePath: string): string {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relativeToRoot = path.relative(repoRoot, absolutePath);
  if (relativeToRoot === "" || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Blueprint artifact path must stay within repoRoot");
  }
  return absolutePath;
}
