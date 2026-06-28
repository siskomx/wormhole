import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { detectProjectContract, type ProjectPackageManager } from "./project-contract.js";
import type {
  ArchitectureMap,
  EntrypointFlowDiscovery,
  ProjectObservationEvidence,
} from "./project-intelligence.js";
import type { ProjectOnboardReport } from "./project-onboard.js";
import { createVerificationPlan, type VerificationCommand } from "./verification-runner.js";
import { createFeatureIndex, type RepoFeatureIndex } from "./feature-index.js";
import {
  evaluateGateSignals,
  type GateFreshnessInput,
  type GateSourceConflictsInput,
} from "./gate-signals.js";

export type BlueprintStatus =
  | "confirmed_from_repo"
  | "recommended_default"
  | "assumption_needs_approval"
  | "unknown_blocking";

export type BlueprintEvidence = {
  source: string;
  sourcePath?: string;
  lineStart?: number;
  lineEnd?: number;
  summary: string;
  confidence: number;
};

export type BlueprintField<T> = {
  value: T;
  status: BlueprintStatus;
  confidence: number;
  evidence: BlueprintEvidence[];
};

export type BlueprintApprovalItem = {
  field: string;
  status: BlueprintStatus;
  reason: string;
  evidence: BlueprintEvidence[];
};

export type BlueprintCommand = {
  name: string;
  command: string;
  args: string[];
  reason: string;
};

export type BlueprintModule = {
  moduleId: string;
  name: string;
  rootPath: string;
  fileCount: number;
  symbolCount: number;
  entrypointCount: number;
  testCount: number;
  owners: string[];
  dependencies: string[];
  dependents: string[];
  evidence: BlueprintEvidence[];
};

export type BlueprintEntrypoint = {
  entrypointId: string;
  kind: string;
  name: string;
  path: string;
  command?: string;
  symbol?: string;
  downstreamFiles: string[];
  moduleRoot: string;
  evidence: BlueprintEvidence[];
};

export const BLUEPRINT_LANES = [
  "backend",
  "frontend",
  "security",
  "tests",
  "infra",
  "generated",
  "docs",
  "agent-meta",
  "runtime",
] as const;

export type BlueprintLaneId = (typeof BLUEPRINT_LANES)[number];

export type BlueprintCoverageStatus = "partial" | "complete";

export type BlueprintLaneStatus = "pending" | "complete";

export type BlueprintLaneSummary = {
  lane: BlueprintLaneId;
  status: BlueprintLaneStatus;
  fileCount: number;
  roots: string[];
  sampleFiles: string[];
  artifactPath: string;
};

export type BlueprintLaneArtifact = BlueprintLaneSummary & {
  schemaVersion: "blueprint-lane.v0";
  generatedAt: string;
  repoRoot: string;
};

export type BlueprintProgressiveState = {
  status: BlueprintCoverageStatus;
  lanes: BlueprintLaneSummary[];
};

export type RepoBlueprint = {
  schemaVersion: "blueprint.v0";
  kind: "existing_repo";
  blueprintId: string;
  generatedAt: string;
  objective: string;
  repoRoot: string;
  fingerprint: string;
  fields: {
    packageManager: BlueprintField<ProjectPackageManager>;
    language: BlueprintField<string>;
    runtime: BlueprintField<string>;
    framework: BlueprintField<string>;
    database: BlueprintField<string>;
    verification: BlueprintField<BlueprintCommand[]>;
  };
  modules: BlueprintModule[];
  entrypoints: BlueprintEntrypoint[];
  featureIndex: RepoFeatureIndex;
  approvalNeeded: BlueprintApprovalItem[];
};

export type BlueprintConstraintRule = {
  ruleId: string;
  severity: "warn" | "block";
  description: string;
};

export type ConstraintManifest = {
  schemaVersion: "constraints.v0";
  generatedAt: string;
  blueprintId: string;
  packageManager: BlueprintField<ProjectPackageManager>;
  requiredVerification: BlueprintCommand[];
  approvalNeeded: BlueprintApprovalItem[];
  rules: BlueprintConstraintRule[];
};

export type BlueprintCompileInput = {
  objective: string;
  onboard: ProjectOnboardReport;
  architecture: ArchitectureMap;
  entrypoints: EntrypointFlowDiscovery;
};

export type BlueprintCompileResult = {
  blueprint: RepoBlueprint;
  constraints: ConstraintManifest;
  agentContextMarkdown: string;
  approvalNeeded: BlueprintApprovalItem[];
  progressive?: BlueprintProgressiveState;
};

export type BlueprintGateCommand = {
  command: string;
  args?: string[];
};

export type BlueprintGateReportedVerification = BlueprintGateCommand & {
  status: "passed" | "failed" | "skipped";
};

export type BlueprintGateInput = {
  constraints: ConstraintManifest;
  sourceConflicts?: GateSourceConflictsInput;
  freshness?: GateFreshnessInput;
  action: {
    plannedCommands?: BlueprintGateCommand[];
    completionClaim?: boolean;
    reportedVerification?: BlueprintGateReportedVerification[];
  };
};

export type BlueprintGateFinding = {
  ruleId: string;
  severity: "warn" | "block";
  message: string;
};

export type BlueprintGateResult = {
  status: "pass" | "warn" | "block";
  findings: BlueprintGateFinding[];
};

const PACKAGE_MANAGER_COMMANDS = new Set(["npm", "pnpm", "yarn", "bun"]);
const DATABASE_DEPENDENCIES = [
  "better-sqlite3",
  "drizzle-orm",
  "kysely",
  "mongodb",
  "mongoose",
  "mysql",
  "mysql2",
  "pg",
  "postgres",
  "prisma",
  "sequelize",
  "sqlite",
  "sqlite3",
  "typeorm",
];

export function compileRepoBlueprint(input: BlueprintCompileInput): BlueprintCompileResult {
  const generatedAt = new Date().toISOString();
  const dependencyNames = new Set(input.onboard.contract.dependencies.map((dependency) => dependency.name));
  const packageManagerEvidence = contractEvidence(
    "package.json",
    `Detected package manager ${input.onboard.contract.packageManager}.`,
    input.onboard.contract.packageManager === "unknown" ? 0.3 : 1,
  );
  const packageManager = field(input.onboard.contract.packageManager, "confirmed_from_repo", packageManagerEvidence);
  const language = detectLanguage(dependencyNames);
  const runtime = detectRuntime(dependencyNames, language.value);
  const framework = detectFramework(dependencyNames);
  const database = detectDatabase(dependencyNames, input.onboard.repoRoot);
  const featureIndex = createFeatureIndex({ repoRoot: input.onboard.repoRoot, generatedAt });
  const requiredVerification = selectRequiredVerification(input.onboard.verificationPlan.commands);
  const verificationEvidence = requiredVerification.length > 0
    ? contractEvidence(
        "package.json",
        `Selected required verification from scripts: ${requiredVerification.map((command) => command.name).join(", ")}.`,
        1,
      )
    : contractEvidence("package.json", "No required verification command was detected.", 0.4);
  const verification = field(requiredVerification, requiredVerification.length > 0 ? "confirmed_from_repo" : "unknown_blocking", verificationEvidence);
  const approvalNeeded = createApprovalItems({
    database,
    repoEvidence: contractEvidence("package.json", "No repository database convention was detected.", 0.7),
  });
  const fingerprint = fingerprintBlueprint([
    input.architecture.fingerprint,
    input.entrypoints.fingerprint,
    featureIndex.fingerprint,
    input.onboard.contract.packageManager,
    ...requiredVerification.map((command) => `${command.command} ${command.args.join(" ")}`),
  ]);
  const blueprintId = `blueprint:${fingerprint}:${randomUUID()}`;
  const blueprint: RepoBlueprint = {
    schemaVersion: "blueprint.v0",
    kind: "existing_repo",
    blueprintId,
    generatedAt,
    objective: input.objective,
    repoRoot: input.onboard.repoRoot,
    fingerprint,
    fields: {
      packageManager,
      language,
      runtime,
      framework,
      database,
      verification,
    },
    modules: input.architecture.modules.map((module) => ({
      moduleId: module.moduleId,
      name: module.name,
      rootPath: module.rootPath,
      fileCount: module.fileCount,
      symbolCount: module.symbolCount,
      entrypointCount: module.entrypointCount,
      testCount: module.testCount,
      owners: module.owners,
      dependencies: module.dependencies,
      dependents: module.dependents,
      evidence: module.evidence.map(toBlueprintEvidence),
    })),
    entrypoints: input.entrypoints.entrypoints.map((entrypoint) => ({
      entrypointId: entrypoint.entrypointId,
      kind: entrypoint.kind,
      name: entrypoint.name,
      path: entrypoint.path,
      ...(entrypoint.command ? { command: entrypoint.command } : {}),
      ...(entrypoint.symbol ? { symbol: entrypoint.symbol } : {}),
      downstreamFiles: entrypoint.downstreamFiles,
      moduleRoot: entrypoint.moduleRoot,
      evidence: entrypoint.evidence.map(toBlueprintEvidence),
    })),
    featureIndex,
    approvalNeeded,
  };
  const constraints: ConstraintManifest = {
    schemaVersion: "constraints.v0",
    generatedAt,
    blueprintId,
    packageManager,
    requiredVerification,
    approvalNeeded,
    rules: [
      {
        ruleId: "package-manager",
        severity: "warn",
        description: "Warn when planned commands use a package manager other than the repo package manager.",
      },
      {
        ruleId: "verification-required",
        severity: "block",
        description: "Block completion claims until required verification is reported as passed.",
      },
      {
        ruleId: "approval:database",
        severity: "block",
        description: "Require user approval before persistence or data-model decisions when database is unknown.",
      },
    ],
  };
  const result = {
    blueprint,
    constraints,
    approvalNeeded,
    agentContextMarkdown: "",
  };
  return {
    ...result,
    agentContextMarkdown: renderAgentContext(result),
  };
}

export function compileBootstrapBlueprint(input: {
  repoRoot: string;
  objective: string;
}): BlueprintCompileResult {
  const generatedAt = new Date().toISOString();
  const contract = detectProjectContract({ repoRoot: input.repoRoot });
  const dependencyNames = new Set(contract.dependencies.map((dependency) => dependency.name));
  const packageManagerEvidence = contractEvidence(
    "package.json",
    `Detected package manager ${contract.packageManager}.`,
    contract.packageManager === "unknown" ? 0.3 : 1,
  );
  const packageManager = field(contract.packageManager, "confirmed_from_repo", packageManagerEvidence);
  const language = detectLanguage(dependencyNames);
  const runtime = detectRuntime(dependencyNames, language.value);
  const framework = detectFramework(dependencyNames);
  const database = detectDatabase(dependencyNames, contract.repoRoot);
  const featureIndex = createFeatureIndex({ repoRoot: contract.repoRoot, generatedAt });
  const verificationPlan = createVerificationPlan({ contract });
  const requiredVerification = selectRequiredVerification(verificationPlan.commands);
  const verification = field(
    requiredVerification,
    requiredVerification.length > 0 ? "confirmed_from_repo" : "unknown_blocking",
    requiredVerification.length > 0
      ? contractEvidence("package.json", "Selected required verification from package scripts.", 1)
      : contractEvidence("package.json", "No required verification command was detected.", 0.4),
  );
  const approvalNeeded = createApprovalItems({
    database,
    repoEvidence: contractEvidence("package.json", "No repository database convention was detected.", 0.7),
  });
  const fingerprint = fingerprintBlueprint([
    contract.packageManager,
    language.value,
    runtime.value,
    framework.value,
    database.value,
    featureIndex.fingerprint,
    ...contract.lockfiles,
    ...requiredVerification.map((command) => `${command.command} ${command.args.join(" ")}`),
  ]);
  const blueprintId = `blueprint:${fingerprint}:${randomUUID()}`;
  const blueprint: RepoBlueprint = {
    schemaVersion: "blueprint.v0",
    kind: "existing_repo",
    blueprintId,
    generatedAt,
    objective: input.objective,
    repoRoot: contract.repoRoot,
    fingerprint,
    fields: {
      packageManager,
      language,
      runtime,
      framework,
      database,
      verification,
    },
    modules: [],
    entrypoints: [],
    featureIndex,
    approvalNeeded,
  };
  const constraints: ConstraintManifest = {
    schemaVersion: "constraints.v0",
    generatedAt,
    blueprintId,
    packageManager,
    requiredVerification,
    approvalNeeded,
    rules: [
      {
        ruleId: "package-manager",
        severity: "warn",
        description: "Warn when planned commands use a package manager other than the repo package manager.",
      },
      {
        ruleId: "verification-required",
        severity: "block",
        description: "Block completion claims until required verification is reported as passed.",
      },
      {
        ruleId: "approval:database",
        severity: "block",
        description: "Require user approval before persistence or data-model decisions when database is unknown.",
      },
    ],
  };
  const progressive: BlueprintProgressiveState = {
    status: "partial",
    lanes: scanBlueprintLanes(contract.repoRoot).map((lane) => ({
      lane: lane.lane,
      status: "pending",
      fileCount: lane.fileCount,
      roots: lane.roots,
      sampleFiles: lane.sampleFiles,
      artifactPath: `.wormhole/lanes/${lane.lane}.json`,
    })),
  };
  const result = {
    blueprint,
    constraints,
    approvalNeeded,
    progressive,
    agentContextMarkdown: "",
  };
  return {
    ...result,
    agentContextMarkdown: renderAgentContext(result),
  };
}

export function renderAgentContext(
  input: Pick<BlueprintCompileResult, "blueprint" | "constraints" | "approvalNeeded" | "progressive">,
): string {
  const blueprint = input.blueprint;
  const fieldLines = [
    `- Package manager: ${blueprint.fields.packageManager.value}`,
    `- Language: ${blueprint.fields.language.value}`,
    `- Runtime: ${blueprint.fields.runtime.value}`,
    `- Framework: ${blueprint.fields.framework.value}`,
    `- Database: ${blueprint.fields.database.value}`,
  ];
  const verificationLines = input.constraints.requiredVerification.length > 0
    ? input.constraints.requiredVerification.map(
        (command) => `- ${command.name}: ${[command.command, ...command.args].join(" ")} - ${command.reason}`,
      )
    : ["- No required verification command detected."];
  const approvalLines = input.approvalNeeded.length > 0
    ? input.approvalNeeded.map((item) => `- ${item.field}: ${item.status} - ${item.reason}`)
    : ["- None."];
  const moduleLines = blueprint.modules.length > 0
    ? blueprint.modules
        .slice(0, 12)
        .map(
          (module) =>
            `- ${module.rootPath}: files=${module.fileCount}, symbols=${module.symbolCount}, tests=${module.testCount}, owners=${module.owners.join(", ") || "none"}`,
        )
    : ["- No modules detected."];
  const entrypointLines = blueprint.entrypoints.length > 0
    ? blueprint.entrypoints
        .slice(0, 12)
        .map((entrypoint) => `- ${entrypoint.kind} ${entrypoint.name} (${entrypoint.path})`)
    : ["- No entrypoints detected."];
  const featureLines = blueprint.featureIndex.features.length > 0
    ? blueprint.featureIndex.features
        .slice(0, 12)
        .map((feature) => {
          const keyFiles = feature.files
            .slice(0, 6)
            .map((file) => file.path)
            .join(", ");
          return `- ${feature.featureId}: files=${feature.fileCount}, roots=${feature.roots.join(", ") || "none"}, key=${keyFiles}`;
        })
    : ["- No feature roots detected."];
  const progressive = input.progressive;
  const statusLines = progressive
    ? [
        `Blueprint status: ${progressive.status}`,
        ...progressive.lanes
          .filter((lane) => lane.fileCount > 0)
          .slice(0, 12)
          .map((lane) => `- ${lane.lane}: ${lane.status}, files=${lane.fileCount}`),
      ]
    : [];

  return [
    "# Wormhole Agent Context",
    "",
    `Objective: ${blueprint.objective}`,
    `Repo root: ${blueprint.repoRoot}`,
    ...statusLines,
    "",
    "## Confirmed Project Rules",
    ...fieldLines,
    "",
    "## Required verification",
    ...verificationLines,
    "",
    "## Approval Needed",
    ...approvalLines,
    "",
    "## Architecture",
    ...moduleLines,
    "",
    "## Entrypoints",
    ...entrypointLines,
    "",
    "## Feature Index",
    "Path: .wormhole/feature-index.json",
    ...featureLines,
    "",
  ].join("\n");
}

export function checkBlueprintGate(input: BlueprintGateInput): BlueprintGateResult {
  const findings: BlueprintGateFinding[] = [];
  findings.push(
    ...evaluateGateSignals({
      sourceConflicts: input.sourceConflicts,
      freshness: input.freshness,
      enforce: input.action.completionClaim === true,
    }),
  );
  const expectedPackageManager = input.constraints.packageManager.value;
  if (expectedPackageManager !== "unknown") {
    for (const command of input.action.plannedCommands ?? []) {
      if (PACKAGE_MANAGER_COMMANDS.has(command.command) && command.command !== expectedPackageManager) {
        findings.push({
          ruleId: "package-manager",
          severity: "warn",
          message: `Use ${expectedPackageManager} for repository package commands instead of ${command.command}.`,
        });
      }
    }
  }

  if (input.action.completionClaim) {
    const reportedVerification = input.action.reportedVerification ?? [];
    for (const requiredCommand of input.constraints.requiredVerification) {
      const passed = reportedVerification.some((reportedCommand) =>
        verificationMatches(requiredCommand, reportedCommand),
      );
      if (!passed) {
        findings.push({
          ruleId: "verification-required",
          severity: "block",
          message: `Report passing verification for ${requiredCommand.name} before claiming completion.`,
        });
      }
    }
  }

  if (findings.some((finding) => finding.severity === "block")) {
    return { status: "block", findings };
  }
  if (findings.some((finding) => finding.severity === "warn")) {
    return { status: "warn", findings };
  }
  return { status: "pass", findings };
}

function detectLanguage(dependencyNames: Set<string>): BlueprintField<string> {
  if (dependencyNames.has("typescript") || dependencyNames.has("@types/node")) {
    return field("TypeScript", "confirmed_from_repo", contractEvidence("package.json", "TypeScript dependency detected.", 1));
  }
  return field("unknown", "unknown_blocking", contractEvidence("package.json", "No primary language dependency was detected.", 0.3));
}

function detectRuntime(dependencyNames: Set<string>, language: string): BlueprintField<string> {
  if (dependencyNames.has("@types/node") || dependencyNames.has("@modelcontextprotocol/sdk") || language === "TypeScript") {
    return field("Node.js", "confirmed_from_repo", contractEvidence("package.json", "Node.js runtime dependencies detected.", 0.9));
  }
  return field("unknown", "unknown_blocking", contractEvidence("package.json", "No runtime convention was detected.", 0.3));
}

function detectFramework(dependencyNames: Set<string>): BlueprintField<string> {
  if (dependencyNames.has("@modelcontextprotocol/sdk")) {
    return field("MCP TypeScript service", "confirmed_from_repo", contractEvidence("package.json", "MCP SDK dependency detected.", 0.95));
  }
  if (dependencyNames.has("next")) {
    return field("Next.js", "confirmed_from_repo", contractEvidence("package.json", "Next.js dependency detected.", 0.95));
  }
  if (dependencyNames.has("react")) {
    return field("React", "confirmed_from_repo", contractEvidence("package.json", "React dependency detected.", 0.9));
  }
  return field("unknown", "assumption_needs_approval", contractEvidence("package.json", "No framework dependency was detected.", 0.45));
}

function detectDatabase(dependencyNames: Set<string>, repoRoot: string): BlueprintField<string> {
  const databaseDependency = DATABASE_DEPENDENCIES.find((dependencyName) => dependencyNames.has(dependencyName));
  if (databaseDependency) {
    return field(
      databaseNameForDependency(databaseDependency),
      "confirmed_from_repo",
      contractEvidence("package.json", `Database dependency ${databaseDependency} detected.`, 0.9),
    );
  }
  const sourceHint = detectDatabaseSourceHint(repoRoot);
  if (sourceHint) {
    return field(sourceHint.value, "confirmed_from_repo", sourceHint.evidence);
  }
  return field("unknown", "unknown_blocking", contractEvidence("package.json", "No database dependency or migration convention was detected.", 0.7));
}

function databaseNameForDependency(dependencyName: string): string {
  if (dependencyName.includes("sqlite")) {
    return "SQLite";
  }
  if (dependencyName === "pg" || dependencyName === "postgres") {
    return "Postgres";
  }
  if (dependencyName === "mysql" || dependencyName === "mysql2") {
    return "MySQL";
  }
  if (dependencyName === "mongodb" || dependencyName === "mongoose") {
    return "MongoDB";
  }
  return dependencyName;
}

function detectDatabaseSourceHint(repoRootInput: string): { value: string; evidence: BlueprintEvidence } | undefined {
  const repoRoot = path.resolve(repoRootInput);
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    return undefined;
  }
  for (const repoPath of listSourceFiles(repoRoot)) {
    const lowerPath = repoPath.toLowerCase();
    const absolutePath = path.join(repoRoot, repoPath);
    const content = safeReadSmallFile(absolutePath);
    const lowerContent = content.toLowerCase();
    if (
      lowerContent.includes("node:sqlite") ||
      lowerContent.includes("better-sqlite3") ||
      lowerContent.includes("sqlite3") ||
      (lowerPath.includes("sqlite") && lowerContent.includes("sqlite"))
    ) {
      return {
        value: "SQLite",
        evidence: {
          source: "source",
          sourcePath: toRepoPath(repoPath),
          summary: `SQLite usage detected in ${toRepoPath(repoPath)}.`,
          confidence: 0.9,
        },
      };
    }
    if (/\bfrom\s+["']pg["']|\brequire\(["']pg["']\)/.test(content)) {
      return {
        value: "Postgres",
        evidence: {
          source: "source",
          sourcePath: toRepoPath(repoPath),
          summary: `Postgres usage detected in ${toRepoPath(repoPath)}.`,
          confidence: 0.85,
        },
      };
    }
  }
  return undefined;
}

function listSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const queue = [repoRoot];
  const ignoredDirectories = new Set([
    ".git",
    ".wormhole",
    "benchmarks",
    "coverage",
    "dist",
    "docs",
    "node_modules",
    "tests",
    "__tests__",
  ]);
  while (queue.length > 0 && files.length < 500) {
    const directory = queue.shift();
    if (!directory) {
      break;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toRepoPath(path.relative(repoRoot, absolutePath));
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && !entry.name.endsWith(".test")) {
          queue.push(absolutePath);
        }
        continue;
      }
      if (entry.isFile() && isSourceFile(relativePath)) {
        files.push(relativePath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function isSourceFile(repoPath: string): boolean {
  if (/(\.|-)(test|spec)\.[A-Za-z0-9]+$/.test(repoPath)) {
    return false;
  }
  return /\.(?:cjs|cts|js|mjs|mts|sql|ts|tsx)$/.test(repoPath);
}

function safeReadSmallFile(filePath: string): string {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size > 200_000) {
      return "";
    }
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function scanBlueprintLanes(repoRootInput: string): BlueprintLaneArtifact[] {
  const repoRoot = path.resolve(repoRootInput);
  const generatedAt = new Date().toISOString();
  const lanes = new Map<BlueprintLaneId, { files: string[]; roots: Set<string> }>();
  for (const lane of BLUEPRINT_LANES) {
    lanes.set(lane, { files: [], roots: new Set<string>() });
  }
  for (const repoPath of listBlueprintFiles(repoRoot)) {
    const lane = classifyBlueprintLane(repoPath);
    const laneState = lanes.get(lane)!;
    laneState.files.push(repoPath);
    laneState.roots.add(rootForLane(repoPath));
  }
  return BLUEPRINT_LANES.map((lane) => {
    const laneState = lanes.get(lane)!;
    const sampleFiles = laneState.files.slice(0, 25);
    return {
      schemaVersion: "blueprint-lane.v0" as const,
      generatedAt,
      repoRoot,
      lane,
      status: "pending" as const,
      fileCount: laneState.files.length,
      roots: [...laneState.roots].sort((left, right) => left.localeCompare(right)).slice(0, 20),
      sampleFiles,
      artifactPath: `.wormhole/lanes/${lane}.json`,
    };
  }).filter((lane) => lane.fileCount > 0);
}

function listBlueprintFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const queue = [repoRoot];
  const ignoredDirectories = new Set([
    ".git",
    ".next",
    ".pnpm-store",
    ".turbo",
    ".wormhole",
    "coverage",
    "dist",
    "node_modules",
    "playwright-report",
    "test-results",
    "tmp",
  ]);
  while (queue.length > 0 && files.length < 25_000) {
    const directory = queue.shift();
    if (!directory) {
      break;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toRepoPath(path.relative(repoRoot, absolutePath));
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }
      if (entry.isFile() && isBlueprintRelevantFile(relativePath)) {
        files.push(relativePath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function isBlueprintRelevantFile(repoPath: string): boolean {
  return /\.(?:cjs|css|cts|html|js|json|jsx|md|mdx|mjs|mts|ps1|py|sh|sql|ts|tsx|txt|ya?ml)$/.test(repoPath);
}

function classifyBlueprintLane(repoPathInput: string): BlueprintLaneId {
  const repoPath = toRepoPath(repoPathInput);
  const lower = repoPath.toLowerCase();
  const segments = lower.split("/");
  const basename = lower.split("/").pop() ?? lower;
  if (
    lower.startsWith(".claude/") ||
    lower.startsWith(".codex/") ||
    lower.startsWith(".cursor/") ||
    lower.startsWith(".agents/") ||
    lower.startsWith(".superpowers/") ||
    segments.includes(".claude") ||
    segments.includes(".codex") ||
    segments.includes(".cursor") ||
    segments.includes(".agents") ||
    segments.includes(".superpowers") ||
    basename === "claude.md" ||
    basename === "agents.md"
  ) {
    return "agent-meta";
  }
  if (
    /(^|\/)(dist|build|coverage|generated|__generated__)(\/|$)/.test(lower) ||
    /[._-](generated|gen)\.[a-z0-9]+$/.test(basename) ||
    lower.includes("/generated/") ||
    basename.includes("openapi")
  ) {
    return "generated";
  }
  if (/(^|\/)(tests?|__tests__|e2e)(\/|$)/.test(lower) || /[._-](test|spec)\.[a-z0-9]+$/.test(basename)) {
    return "tests";
  }
  if (
    /(^|\/)(security|auth|permissions?|firewall|rate-limiter|audit)(\/|$)/.test(lower) ||
    /\.(gitleaks|semgrep|trivy|zap)/.test(lower) ||
    lower.includes("security") ||
    lower.includes("permission") ||
    lower.includes("firewall")
  ) {
    return "security";
  }
  if (
    lower.startsWith(".github/") ||
    lower.startsWith("migrations/") ||
    /(^|\/)(docker|deploy|infra|k8s|helm|nginx|scripts)(\/|$)/.test(lower) ||
    basename.startsWith("dockerfile") ||
    basename.includes("docker-compose") ||
    basename.includes("vite.config") ||
    basename.includes("tsconfig") ||
    basename.includes("eslint.config")
  ) {
    return "infra";
  }
  if (lower.startsWith("backend/") || lower.startsWith("server/") || lower.startsWith("api/")) {
    return "backend";
  }
  if (
    lower.startsWith("src/") ||
    lower.startsWith("frontend/") ||
    lower.startsWith("browser-extension/") ||
    lower.startsWith("desktop/") ||
    /\.(tsx|jsx|css|html)$/.test(basename)
  ) {
    return "frontend";
  }
  if (lower.startsWith("docs/") || basename === "readme.md" || /\.(md|mdx)$/.test(basename)) {
    return "docs";
  }
  return "runtime";
}

function rootForLane(repoPathInput: string): string {
  const repoPath = toRepoPath(repoPathInput);
  const segments = repoPath.split("/");
  if (segments.length <= 1) {
    return ".";
  }
  if (segments[0] === "backend" || segments[0] === "src") {
    return segments.length > 2 ? `${segments[0]}/${segments[1]}` : segments[0];
  }
  if (segments[0]?.startsWith(".")) {
    return segments.length > 1 ? `${segments[0]}/${segments[1]}` : segments[0];
  }
  return segments[0] ?? ".";
}

function selectRequiredVerification(commands: VerificationCommand[]): BlueprintCommand[] {
  const testCommands = commands.filter((command) => command.name === "test");
  const selected = testCommands.length > 0 ? testCommands : commands.slice(0, 1);
  return selected.map((command) => ({
    name: command.name,
    command: command.command,
    args: command.args ?? [],
    reason: command.reason ?? "Required by repository verification plan.",
  }));
}

function createApprovalItems(input: {
  database: BlueprintField<string>;
  repoEvidence: BlueprintEvidence;
}): BlueprintApprovalItem[] {
  const items: BlueprintApprovalItem[] = [];
  if (input.database.status === "unknown_blocking") {
    items.push({
      field: "database",
      status: "unknown_blocking",
      reason: "Ask before adding persistence, migrations, database clients, or data-model conventions.",
      evidence: [input.repoEvidence],
    });
  }
  return items;
}

function field<T>(value: T, status: BlueprintStatus, evidence: BlueprintEvidence): BlueprintField<T> {
  return {
    value,
    status,
    confidence: evidence.confidence,
    evidence: [evidence],
  };
}

function contractEvidence(sourcePath: string, summary: string, confidence: number): BlueprintEvidence {
  return {
    source: "project_contract",
    sourcePath,
    summary,
    confidence,
  };
}

function toBlueprintEvidence(evidence: ProjectObservationEvidence): BlueprintEvidence {
  return {
    source: evidence.sourceType,
    ...(evidence.sourcePath ? { sourcePath: evidence.sourcePath } : {}),
    ...(evidence.lineStart !== undefined ? { lineStart: evidence.lineStart } : {}),
    ...(evidence.lineEnd !== undefined ? { lineEnd: evidence.lineEnd } : {}),
    summary: evidence.summary,
    confidence: evidence.confidence,
  };
}

function fingerprintBlueprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function verificationMatches(
  required: BlueprintCommand,
  reported: BlueprintGateReportedVerification,
): boolean {
  if (reported.status !== "passed" || required.command !== reported.command) {
    return false;
  }
  const requiredArgs = required.args.join(" ");
  const reportedArgs = (reported.args ?? []).join(" ");
  return (
    requiredArgs === reportedArgs ||
    required.name === reportedArgs ||
    requiredArgs.endsWith(` ${reportedArgs}`)
  );
}
