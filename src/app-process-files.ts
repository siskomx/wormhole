import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  renderAppProcessContext,
  renderProductDefinition,
  type AppProcess,
  type AppProcessCompileResult,
  type AppProcessStory,
} from "./app-process.js";

export type AppProcessArtifactFile = {
  relativePath: string;
  absolutePath: string;
  bytes: number;
};

export type AppProcessArtifactWriteResult = {
  repoRoot: string;
  files: AppProcessArtifactFile[];
};

export type WriteAppProcessArtifactsInput = {
  repoRoot: string;
  result: AppProcessCompileResult;
};

export function writeAppProcessArtifacts(input: WriteAppProcessArtifactsInput): AppProcessArtifactWriteResult {
  const repoRoot = path.resolve(input.repoRoot);
  mkdirSync(resolveRepoPath(repoRoot, ".wormhole"), { recursive: true });
  mkdirSync(resolveRepoPath(repoRoot, ".wormhole/lanes"), { recursive: true });
  mkdirSync(resolveRepoPath(repoRoot, ".wormhole/app-process/phases"), { recursive: true });

  const appProcess = input.result.appProcess;
  const files = [
    writeArtifact(repoRoot, ".wormhole/app-context.md", `${renderAppProcessContext(input.result).trimEnd()}\n`),
    writeArtifact(repoRoot, ".wormhole/app-process.md", `${renderAppProcessContext(input.result).trimEnd()}\n`),
    writeArtifact(repoRoot, ".wormhole/app-process.json", `${JSON.stringify(appProcess, null, 2)}\n`),
    ...appProcess.roadmap.value.phases.map((phase) =>
      writeArtifact(repoRoot, `.wormhole/app-process/phases/phase-${phase.phase}.json`, `${JSON.stringify(phase, null, 2)}\n`),
    ),
    writeArtifact(repoRoot, ".wormhole/backlog.json", `${JSON.stringify(appProcess.backlog.value, null, 2)}\n`),
    writeArtifact(repoRoot, ".wormhole/product-definition.md", `${renderProductDefinition(input.result).trimEnd()}\n`),
    writeArtifact(repoRoot, ".wormhole/roadmap.json", `${JSON.stringify(appProcess.roadmap.value, null, 2)}\n`),
    writeArtifact(repoRoot, ".wormhole/lanes/architecture.md", renderArchitectureLane(appProcess)),
    writeArtifact(repoRoot, ".wormhole/lanes/backlog.md", renderBacklogLane(appProcess)),
    writeArtifact(repoRoot, ".wormhole/lanes/discovery.md", renderDiscoveryLane(appProcess)),
    writeArtifact(repoRoot, ".wormhole/lanes/product.md", renderProductDefinition(input.result)),
    writeArtifact(repoRoot, ".wormhole/lanes/roadmap.md", renderRoadmapLane(appProcess)),
    writeArtifact(repoRoot, ".wormhole/lanes/security.md", renderSecurityLane(appProcess)),
    writeArtifact(repoRoot, ".wormhole/lanes/ux.md", renderUxLane(appProcess)),
    writeArtifact(repoRoot, ".wormhole/lanes/verification.md", renderVerificationLane(appProcess)),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    repoRoot,
    files,
  };
}

function renderArchitectureLane(appProcess: AppProcess): string {
  const architecture = appProcess.architecture.value;
  return [
    "# Architecture Lane",
    "",
    `Stack: ${architecture.stack.language}, ${architecture.stack.runtime}, ${architecture.stack.framework}, ${architecture.stack.database}`,
    "",
    "## Boundaries",
    ...architecture.boundaries.map((item) => `- ${item}`),
    "",
    "## Constraints",
    ...architecture.constraints.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function renderBacklogLane(appProcess: AppProcess): string {
  return [
    "# Backlog Lane",
    "",
    ...appProcess.backlog.value.stories.map(renderStory),
    "",
  ].join("\n");
}

function renderDiscoveryLane(appProcess: AppProcess): string {
  return [
    "# Discovery Lane",
    "",
    "## Assumptions",
    ...appProcess.productDefinition.value.assumptions.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function renderRoadmapLane(appProcess: AppProcess): string {
  return [
    "# Roadmap Lane",
    "",
    `Current phase: ${appProcess.roadmap.value.currentPhase}`,
    "",
    ...appProcess.roadmap.value.phases.map((phase) =>
      [
        `## Phase ${phase.phase}: ${phase.goal}`,
        "",
        `Milestone: ${phase.milestone}`,
        "",
        ...phase.stories.map((story) => `- ${story.storyId}: ${story.title} [${story.ownerLane}]`),
        "",
      ].join("\n"),
    ),
  ].join("\n");
}

function renderSecurityLane(appProcess: AppProcess): string {
  const security = appProcess.security.value;
  return [
    "# Security Lane",
    "",
    `Posture: ${security.posture}`,
    "",
    "## Data Classes",
    ...security.dataClasses.map((item) => `- ${item}`),
    "",
    "## Required Controls",
    ...security.requiredControls.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function renderUxLane(appProcess: AppProcess): string {
  const ux = appProcess.ux.value;
  return [
    "# UX Lane",
    "",
    "## Primary Flows",
    ...ux.primaryFlows.map((item) => `- ${item}`),
    "",
    "## Screens",
    ...ux.screens.map((item) => `- ${item}`),
    "",
    "## Information Architecture",
    ...ux.informationArchitecture.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function renderVerificationLane(appProcess: AppProcess): string {
  const verification = appProcess.verification.value;
  const commandLines = verification.requiredCommands.length > 0
    ? verification.requiredCommands.map((command) => `- ${command.name}: ${[command.command, ...command.args].join(" ")}`)
    : ["- No required verification command detected."];
  return [
    "# Verification Lane",
    "",
    "## Commands",
    ...commandLines,
    "",
    "## Quality Gates",
    ...verification.qualityGates.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function renderStory(story: AppProcessStory): string {
  return [
    `## ${story.storyId}: ${story.title}`,
    "",
    `Lane: ${story.ownerLane}`,
    `Priority: ${story.priority}`,
    `Phase: ${story.phase}`,
    "",
    "Acceptance criteria:",
    ...story.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    `Verifiable by: ${story.verifiableBy.join(", ")}`,
    "",
  ].join("\n");
}

function writeArtifact(repoRoot: string, relativePath: string, content: string): AppProcessArtifactFile {
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
    throw new Error("App process artifact path must stay within repoRoot");
  }
  return absolutePath;
}
