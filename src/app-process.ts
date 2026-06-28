import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { BlueprintCommand, BlueprintCompileResult } from "./blueprint.js";
import type { RepoFeature, RepoFeatureIndex } from "./feature-index.js";
import {
  evaluateGateSignals,
  type GateArtifactFreshness,
  type GateFreshnessInput,
  type GateSourceConflictsInput,
} from "./gate-signals.js";

export const APP_PROCESS_LANES = [
  "discovery",
  "product",
  "roadmap",
  "backlog",
  "architecture",
  "ux",
  "security",
  "verification",
  "lifecycle",
] as const;

export const APP_PROCESS_LIFECYCLE_STAGES = [
  "environment",
  "data_migration",
  "ci",
  "deployment",
  "release",
] as const;

export const APP_PROCESS_STORY_LANES = [
  "backend",
  "frontend",
  "security",
  "tests",
  "infra",
  "generated",
  "docs",
  "agent-meta",
  "runtime",
  ...APP_PROCESS_LANES,
] as const;

export type AppProcessLaneId = (typeof APP_PROCESS_LANES)[number];
export type AppProcessStoryLane = (typeof APP_PROCESS_STORY_LANES)[number];
export type AppProcessStatus = "partial" | "ready";
export type AppProcessSectionStatus = "ai_drafted" | "confirmed_from_repo" | "needs_user_confirmation";
export type AppProcessSecurityPosture = "low" | "medium" | "high";
export type AppProcessLifecycleStageId = (typeof APP_PROCESS_LIFECYCLE_STAGES)[number];
export type AppProcessLifecycleStageStatus = "ready" | "warning" | "unknown";

export type AppProcessEvidence = {
  source: "objective" | "repo" | "blueprint" | "derived";
  sourcePath?: string;
  summary: string;
  confidence: number;
};

export type AppProcessSection<T> = {
  value: T;
  status: AppProcessSectionStatus;
  confidence: number;
  evidence: AppProcessEvidence[];
};

export type AppProcessProductDefinition = {
  problem: string;
  targetUsers: string[];
  jobsToBeDone: string[];
  valueProposition: string;
  successMetrics: string[];
  nonGoals: string[];
  assumptions: string[];
  keyEntities: string[];
  dataClasses: string[];
  securityPosture: AppProcessSecurityPosture;
};

export type AppProcessArchitecture = {
  stack: {
    packageManager: string;
    language: string;
    runtime: string;
    framework: string;
    database: string;
  };
  boundaries: string[];
  constraints: string[];
};

export type AppProcessUx = {
  primaryFlows: string[];
  screens: string[];
  informationArchitecture: string[];
};

export type AppProcessSecurity = {
  posture: AppProcessSecurityPosture;
  dataClasses: string[];
  requiredControls: string[];
};

export type AppProcessVerification = {
  requiredCommands: BlueprintCommand[];
  qualityGates: string[];
};

export type AppProcessLifecycleStage = {
  stage: AppProcessLifecycleStageId;
  status: AppProcessLifecycleStageStatus;
  evidence: AppProcessEvidence[];
  findings: string[];
};

export type AppProcessLifecycle = {
  stages: AppProcessLifecycleStage[];
  releaseReadiness: "ready" | "needs_attention";
  requiredSignals: string[];
};

export type AppProcessStory = {
  storyId: string;
  title: string;
  ownerLane: AppProcessStoryLane;
  priority: "p0" | "p1" | "p2";
  phase: number;
  acceptanceCriteria: string[];
  dependencies: string[];
  verifiableBy: string[];
  provisional: boolean;
};

export type AppProcessPhase = {
  phase: number;
  goal: string;
  milestone: string;
  stories: AppProcessStory[];
};

export type AppProcessRoadmap = {
  currentPhase: number;
  readyToBuild: boolean;
  phases: AppProcessPhase[];
};

export type AppProcessBacklog = {
  stories: AppProcessStory[];
};

export type AppProcessLaneSummary = {
  lane: AppProcessLaneId;
  status: "pending" | "complete";
  itemCount: number;
  artifactPath: string;
};

export type AppProcessProgressiveState = {
  status: "partial" | "complete";
  lanes: AppProcessLaneSummary[];
};

export type AppProcessFeatureSummary = {
  featureId: string;
  name: string;
  fileCount: number;
  roots: string[];
  keyFiles: string[];
  sideEffects: string[];
};

export type AppProcessRepoIntelligence = {
  featureIndexPath: string;
  featureIndexFingerprint: string;
  featureCount: number;
  features: AppProcessFeatureSummary[];
};

export type AppProcess = {
  schemaVersion: "app-process.v0";
  kind: "full_app_process";
  status: AppProcessStatus;
  appProcessId: string;
  generatedAt: string;
  objective: string;
  repoRoot: string;
  blueprintRef: {
    blueprintId: string;
    fingerprint: string;
  };
  productDefinition: AppProcessSection<AppProcessProductDefinition>;
  roadmap: AppProcessSection<AppProcessRoadmap>;
  backlog: AppProcessSection<AppProcessBacklog>;
  architecture: AppProcessSection<AppProcessArchitecture>;
  ux: AppProcessSection<AppProcessUx>;
  security: AppProcessSection<AppProcessSecurity>;
  verification: AppProcessSection<AppProcessVerification>;
  lifecycle: AppProcessSection<AppProcessLifecycle>;
  repoIntelligence: AppProcessRepoIntelligence;
  progressive: AppProcessProgressiveState;
};

export type AppProcessCompileInput = {
  repoRoot: string;
  objective: string;
  blueprint: BlueprintCompileResult;
};

export type AppProcessCompileResult = {
  appProcess: AppProcess;
  featureIndex: RepoFeatureIndex;
  productMarkdown: string;
  appContextMarkdown: string;
};

export type AppProcessValidationResult = {
  valid: boolean;
  errors: string[];
};

export type AppProcessGateReportedVerification = {
  command: string;
  args?: string[];
  status: "passed" | "failed" | "skipped";
};

export type AppProcessGateInput = {
  appProcess: AppProcess;
  sourceConflicts?: GateSourceConflictsInput;
  freshness?: GateFreshnessInput;
  artifactFreshness?: GateArtifactFreshness[];
  action: {
    implementationClaim?: boolean;
    completionClaim?: boolean;
    acceptedDraftSections?: Array<keyof Pick<
      AppProcess,
      "productDefinition" | "roadmap" | "backlog" | "ux" | "security"
    >>;
    reportedVerification?: AppProcessGateReportedVerification[];
  };
};

export type AppProcessGateFinding = {
  ruleId: string;
  severity: "warn" | "block";
  message: string;
};

export type AppProcessGateResult = {
  status: "pass" | "warn" | "block";
  findings: AppProcessGateFinding[];
};

const ENTITY_KEYWORDS: Array<{ pattern: RegExp; entities: string[] }> = [
  { pattern: /\bsubscription|subscriptions\b/i, entities: ["Subscription"] },
  { pattern: /\bbilling|bill\b/i, entities: ["Subscription", "Invoice", "Payment"] },
  { pattern: /\binvoice|invoices\b/i, entities: ["Invoice"] },
  { pattern: /\bpayment|payments\b/i, entities: ["Payment"] },
  { pattern: /\baccountant|accountants|accounting\b/i, entities: ["Accountant"] },
  { pattern: /\bclient|clients|customer|customers\b/i, entities: ["Client"] },
  { pattern: /\bteam|teams\b/i, entities: ["Team"] },
  { pattern: /\bschedule|scheduling|calendar|appointment\b/i, entities: ["Schedule", "Event"] },
  { pattern: /\bauth|authentication|login|signup|user|users\b/i, entities: ["User", "Session"] },
  { pattern: /\bnote|notes|markdown\b/i, entities: ["Note"] },
];

const STOP_WORDS = new Set([
  "add",
  "app",
  "build",
  "create",
  "existing",
  "for",
  "full",
  "into",
  "map",
  "make",
  "process",
  "workflow",
  "workflows",
  "shared",
  "the",
  "with",
]);

export function compileAppProcess(input: AppProcessCompileInput): AppProcessCompileResult {
  const repoRoot = path.resolve(input.repoRoot);
  const generatedAt = new Date().toISOString();
  const objective = normalizeObjective(input.objective);
  const objectiveEvidence = evidence("objective", `Objective supplied: ${objective}`, 0.55);
  const blueprintEvidence = evidence(
    "blueprint",
    `Derived from blueprint ${input.blueprint.blueprint.blueprintId}.`,
    0.8,
  );
  const product = createProductDefinition({ objective, repoRoot });
  const architecture = createArchitecture(input.blueprint);
  const verification = createVerification(input.blueprint);
  const lifecycle = createLifecycle({ architecture, verification, blueprint: input.blueprint });
  const security = createSecurity(product);
  const ux = createUx(product);
  const repoIntelligence = createRepoIntelligence(input.blueprint.blueprint.featureIndex);
  const roadmap = createRoadmap({ product, architecture, verification });
  const backlog = {
    stories: roadmap.phases.flatMap((phase) => phase.stories),
  };
  const progressive = createProgressiveState({
    product,
    roadmap,
    backlog,
    architecture,
    ux,
    security,
    verification,
    lifecycle,
  });
  const fingerprint = fingerprintAppProcess([
    objective,
    input.blueprint.blueprint.fingerprint,
    input.blueprint.blueprint.featureIndex.fingerprint,
    product.keyEntities.join(","),
    backlog.stories.map((story) => story.storyId).join(","),
    lifecycle.stages.map((stage) => `${stage.stage}:${stage.status}`).join(","),
  ]);
  const appProcess: AppProcess = {
    schemaVersion: "app-process.v0",
    kind: "full_app_process",
    status: "partial",
    appProcessId: `app-process:${fingerprint}`,
    generatedAt,
    objective,
    repoRoot,
    blueprintRef: {
      blueprintId: input.blueprint.blueprint.blueprintId,
      fingerprint: input.blueprint.blueprint.fingerprint,
    },
    productDefinition: section(product, "ai_drafted", 0.45, [
      objectiveEvidence,
      ...productEvidence(repoRoot),
    ]),
    roadmap: section(roadmap, "ai_drafted", 0.45, [objectiveEvidence, blueprintEvidence]),
    backlog: section(backlog, "ai_drafted", 0.45, [objectiveEvidence, blueprintEvidence]),
    architecture: section(architecture, "confirmed_from_repo", 0.85, [blueprintEvidence]),
    ux: section(ux, "ai_drafted", 0.4, [objectiveEvidence]),
    security: section(security, "ai_drafted", security.posture === "high" ? 0.6 : 0.45, [
      objectiveEvidence,
      blueprintEvidence,
    ]),
    verification: section(verification, "confirmed_from_repo", 0.85, [blueprintEvidence]),
    lifecycle: section(lifecycle, "confirmed_from_repo", 0.75, [blueprintEvidence]),
    repoIntelligence,
    progressive,
  };
  const result = {
    appProcess,
    featureIndex: input.blueprint.blueprint.featureIndex,
    productMarkdown: "",
    appContextMarkdown: "",
  };
  return {
    ...result,
    productMarkdown: renderProductDefinition(result),
    appContextMarkdown: renderAppProcessContext(result),
  };
}

export function renderAppProcessContext(input: Pick<AppProcessCompileResult, "appProcess">): string {
  const appProcess = input.appProcess;
  const product = appProcess.productDefinition.value;
  const roadmap = appProcess.roadmap.value;
  const architecture = appProcess.architecture.value;
  const verificationLines = appProcess.verification.value.requiredCommands.length > 0
    ? appProcess.verification.value.requiredCommands.map(
        (command) => `- ${command.name}: ${[command.command, ...command.args].join(" ")}`,
      )
    : ["- No required verification command detected."];
  const storyLines = appProcess.backlog.value.stories
    .slice(0, 12)
    .map((story) => `- ${story.storyId} [${story.ownerLane}] ${story.title}`);
  const featureLines = appProcess.repoIntelligence.features.length > 0
    ? appProcess.repoIntelligence.features
        .slice(0, 12)
        .map((feature) => `- ${feature.featureId}: files=${feature.fileCount}, key=${feature.keyFiles.slice(0, 4).join(", ")}`)
    : ["- No feature roots detected."];
  const lifecycleLines = appProcess.lifecycle.value.stages.map((stage) => `- ${stage.stage}: ${stage.status}`);

  return [
    "# Wormhole App Process Context",
    "",
    `Objective: ${appProcess.objective}`,
    `Repo root: ${appProcess.repoRoot}`,
    `Product definition: ${appProcess.productDefinition.status}`,
    `Current phase: ${roadmap.currentPhase}`,
    `Security posture: ${product.securityPosture}`,
    "",
    "## Product",
    `Problem: ${product.problem}`,
    `Target users: ${product.targetUsers.join(", ")}`,
    `Key entities: ${product.keyEntities.join(", ")}`,
    "",
    "## Architecture",
    `Stack: ${architecture.stack.language}, ${architecture.stack.runtime}, ${architecture.stack.framework}, ${architecture.stack.database}`,
    "",
    "## Lifecycle",
    ...lifecycleLines,
    `Release readiness: ${appProcess.lifecycle.value.releaseReadiness}`,
    "",
    "## Repo Intelligence",
    `Feature index: ${appProcess.repoIntelligence.featureIndexPath}`,
    ...featureLines,
    "",
    "## Backlog",
    ...storyLines,
    "",
    "## Required Verification",
    ...verificationLines,
    "",
  ].join("\n");
}

export function renderProductDefinition(input: Pick<AppProcessCompileResult, "appProcess">): string {
  const product = input.appProcess.productDefinition.value;
  return [
    "# Product Definition",
    "",
    `Problem: ${product.problem}`,
    "",
    "## Target Users",
    ...product.targetUsers.map((user) => `- ${user}`),
    "",
    "## Jobs To Be Done",
    ...product.jobsToBeDone.map((job) => `- ${job}`),
    "",
    "## Success Metrics",
    ...product.successMetrics.map((metric) => `- ${metric}`),
    "",
    "## Non Goals",
    ...product.nonGoals.map((goal) => `- ${goal}`),
    "",
    "## Assumptions",
    ...product.assumptions.map((assumption) => `- ${assumption}`),
    "",
  ].join("\n");
}

export function validateAppProcess(appProcess: AppProcess): AppProcessValidationResult {
  const errors: string[] = [];
  if (appProcess.schemaVersion !== "app-process.v0") {
    errors.push("Unsupported app process schema version.");
  }
  if (!appProcess.objective.trim()) {
    errors.push("Objective is required.");
  }
  if (appProcess.productDefinition.value.nonGoals.length === 0) {
    errors.push("Product definition requires at least one non-goal.");
  }
  if (appProcess.productDefinition.value.keyEntities.length === 0) {
    errors.push("Product definition requires at least one key entity.");
  }
  if (appProcess.roadmap.value.phases.length === 0) {
    errors.push("Roadmap requires at least one phase.");
  }
  const lifecycleStageIds = appProcess.lifecycle.value.stages.map((stage) => stage.stage);
  if (
    lifecycleStageIds.length !== APP_PROCESS_LIFECYCLE_STAGES.length ||
    new Set(lifecycleStageIds).size !== APP_PROCESS_LIFECYCLE_STAGES.length ||
    !APP_PROCESS_LIFECYCLE_STAGES.every((stage) => lifecycleStageIds.includes(stage))
  ) {
    errors.push("Lifecycle requires environment, data_migration, ci, deployment, and release stages.");
  }
  for (const story of appProcess.backlog.value.stories) {
    if (story.acceptanceCriteria.length === 0) {
      errors.push(`${story.storyId} is missing acceptance criteria.`);
    }
    if (story.verifiableBy.length === 0) {
      errors.push(`${story.storyId} is missing verification linkage.`);
    }
    if (!APP_PROCESS_STORY_LANES.includes(story.ownerLane)) {
      errors.push(`${story.storyId} has invalid owner lane ${story.ownerLane}.`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function checkAppProcessGate(input: AppProcessGateInput): AppProcessGateResult {
  const findings: AppProcessGateFinding[] = [];
  const acceptedDraftSections = new Set(input.action.acceptedDraftSections ?? []);
  const requiresProductConfirmation = input.action.implementationClaim || input.action.completionClaim;
  findings.push(
    ...evaluateGateSignals({
      sourceConflicts: input.sourceConflicts,
      freshness: input.freshness,
      artifactFreshness: input.artifactFreshness,
      enforce: requiresProductConfirmation === true,
    }),
  );

  if (requiresProductConfirmation) {
    for (const sectionName of ["productDefinition", "roadmap", "backlog", "ux", "security"] as const) {
      const section = input.appProcess[sectionName];
      if (section.status === "ai_drafted" && !acceptedDraftSections.has(sectionName)) {
        findings.push({
          ruleId: `app-process:${sectionName}:unconfirmed`,
          severity: "block",
          message: `Accept or refine the AI-drafted ${sectionName} section before implementation or completion claims.`,
        });
      }
    }
  }

  if (input.action.completionClaim) {
    for (const requiredCommand of input.appProcess.verification.value.requiredCommands) {
      const passed = (input.action.reportedVerification ?? []).some((reportedCommand) =>
        verificationMatches(requiredCommand, reportedCommand),
      );
      if (!passed) {
        findings.push({
          ruleId: "app-process:verification-required",
          severity: "block",
          message: `Report passing verification for ${requiredCommand.name} before claiming app-process completion.`,
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

function createProductDefinition(input: { objective: string; repoRoot: string }): AppProcessProductDefinition {
  const entities = extractEntities(input.objective, readRepoSummary(input.repoRoot));
  const securityPosture = inferSecurityPosture(input.objective, entities);
  const dataClasses = inferDataClasses(input.objective, entities);
  const primaryUsers = inferTargetUsers(input.objective, entities);
  return {
    problem: `Define and deliver ${lowercaseFirst(input.objective)} with repo-specific constraints, verification, and phased scope.`,
    targetUsers: primaryUsers,
    jobsToBeDone: primaryUsers.map((user) => `${user} can complete the core ${entities[0] ?? "application"} workflow reliably.`),
    valueProposition: `Provide a focused ${entities.slice(0, 3).join(", ")} experience without drifting from the repository conventions.`,
    successMetrics: [
      "Phase 1 stories meet their acceptance criteria.",
      "Required verification passes before completion is claimed.",
      "Security and data-handling stories are represented before implementation starts.",
    ],
    nonGoals: [
      "Do not replace the detected stack or package manager without explicit approval.",
      "Do not expand beyond the selected MVP phase during implementation.",
      "Do not treat AI-drafted product assumptions as user-confirmed facts.",
    ],
    assumptions: [
      "Product intent was drafted from the objective and should be confirmed before high-risk scope changes.",
      "Roadmap phases are planning guidance, not permission to implement every phase at once.",
    ],
    keyEntities: entities,
    dataClasses,
    securityPosture,
  };
}

function createArchitecture(blueprint: BlueprintCompileResult): AppProcessArchitecture {
  const fields = blueprint.blueprint.fields;
  return {
    stack: {
      packageManager: fields.packageManager.value,
      language: fields.language.value,
      runtime: fields.runtime.value,
      framework: fields.framework.value,
      database: fields.database.value,
    },
    boundaries: [
      "Follow existing backend, frontend, tests, infra, generated, docs, and agent metadata lanes.",
      "Keep product and roadmap artifacts under .wormhole as local agent state.",
    ],
    constraints: [
      `Use ${fields.packageManager.value} for package-manager commands.`,
      `Treat database convention as ${fields.database.value}.`,
      "Report required verification before completion claims.",
    ],
  };
}

function createVerification(blueprint: BlueprintCompileResult): AppProcessVerification {
  return {
    requiredCommands: blueprint.constraints.requiredVerification,
    qualityGates: [
      "Every backlog story must have acceptance criteria.",
      "Every implementation story must link to a verification command or test lane.",
      "Completion claims must pass the blueprint verification gate.",
    ],
  };
}

function createLifecycle(input: {
  architecture: AppProcessArchitecture;
  verification: AppProcessVerification;
  blueprint: BlueprintCompileResult;
}): AppProcessLifecycle {
  const environmentStage = createEnvironmentLifecycleStage(input.architecture);
  const migrationStage = createMigrationLifecycleStage(input.architecture, input.blueprint);
  const ciStage = createCiLifecycleStage(input.verification);
  const deploymentStage = createDeploymentLifecycleStage(input.blueprint);
  const releaseStage = createReleaseLifecycleStage([
    environmentStage,
    migrationStage,
    ciStage,
    deploymentStage,
  ]);
  return {
    stages: [
      environmentStage,
      migrationStage,
      ciStage,
      deploymentStage,
      releaseStage,
    ],
    releaseReadiness: releaseStage.status === "ready" ? "ready" : "needs_attention",
    requiredSignals: [
      "environment stack",
      "database or migration convention",
      "verification command",
      "deployment artifact review",
      "release readiness",
    ],
  };
}

function createEnvironmentLifecycleStage(architecture: AppProcessArchitecture): AppProcessLifecycleStage {
  const stack = architecture.stack;
  const missing = [
    ["package manager", stack.packageManager],
    ["language", stack.language],
    ["runtime", stack.runtime],
    ["framework", stack.framework],
  ].filter(([, value]) => !isConcreteLifecycleValue(value));
  return lifecycleStage(
    "environment",
    missing.length === 0 ? "ready" : "unknown",
    [
      evidence(
        "blueprint",
        `Environment stack from blueprint: package manager ${stack.packageManager}, language ${stack.language}, runtime ${stack.runtime}, framework ${stack.framework}.`,
        missing.length === 0 ? 0.85 : 0.45,
      ),
    ],
    missing.map(([label]) => `Blueprint did not confirm ${label}.`),
  );
}

function createMigrationLifecycleStage(
  architecture: AppProcessArchitecture,
  blueprint: BlueprintCompileResult,
): AppProcessLifecycleStage {
  const database = architecture.stack.database;
  const migrationPaths = lifecycleSampleFiles(blueprint).filter(isMigrationPath);
  if (!isConcreteLifecycleValue(database)) {
    return lifecycleStage(
      "data_migration",
      "ready",
      [evidence("blueprint", "No concrete database convention detected; migration check is not required yet.", 0.65)],
      [],
    );
  }
  if (migrationPaths.length > 0) {
    return lifecycleStage(
      "data_migration",
      "ready",
      migrationPaths.slice(0, 5).map((repoPath) =>
        evidence("repo", `Migration evidence detected at ${repoPath}.`, 0.8, repoPath),
      ),
      [],
    );
  }
  return lifecycleStage(
    "data_migration",
    "warning",
    [evidence("blueprint", `Database convention ${database} was detected.`, 0.75)],
    ["Database convention detected; migration evidence is not linked yet."],
  );
}

function createCiLifecycleStage(verification: AppProcessVerification): AppProcessLifecycleStage {
  if (verification.requiredCommands.length === 0) {
    return lifecycleStage(
      "ci",
      "unknown",
      [evidence("blueprint", "No required verification command was detected.", 0.4)],
      ["No required verification command detected."],
    );
  }
  return lifecycleStage(
    "ci",
    "ready",
    verification.requiredCommands.map((command) =>
      evidence("blueprint", `Required verification command linked: ${command.name}.`, 0.85),
    ),
    [],
  );
}

function createDeploymentLifecycleStage(blueprint: BlueprintCompileResult): AppProcessLifecycleStage {
  const deploymentPaths = lifecycleSampleFiles(blueprint).filter(isDeploymentPath);
  if (deploymentPaths.length === 0) {
    return lifecycleStage(
      "deployment",
      "unknown",
      [evidence("derived", "No deployment artifact was detected in progressive lane samples.", 0.45)],
      ["No deployment artifact detected."],
    );
  }
  return lifecycleStage(
    "deployment",
    "warning",
    deploymentPaths.slice(0, 5).map((repoPath) =>
      evidence("repo", `Deployment-related artifact detected at ${repoPath}.`, 0.75, repoPath),
    ),
    ["Deployment artifacts detected; deployment readiness is not verified yet."],
  );
}

function createReleaseLifecycleStage(stages: AppProcessLifecycleStage[]): AppProcessLifecycleStage {
  const warnings = stages.filter((stage) => stage.status === "warning");
  const unknowns = stages.filter((stage) => stage.status === "unknown");
  if (warnings.length > 0) {
    return lifecycleStage(
      "release",
      "warning",
      [evidence("derived", "Release readiness aggregated from lifecycle stages.", 0.65)],
      warnings.map((stage) => `${stage.stage} needs attention before release.`),
    );
  }
  if (unknowns.length > 0) {
    return lifecycleStage(
      "release",
      "unknown",
      [evidence("derived", "Release readiness aggregated from lifecycle stages.", 0.55)],
      unknowns.map((stage) => `${stage.stage} readiness is unknown.`),
    );
  }
  return lifecycleStage(
    "release",
    "ready",
    [evidence("derived", "All local lifecycle stages are ready.", 0.75)],
    [],
  );
}

function lifecycleStage(
  stage: AppProcessLifecycleStageId,
  status: AppProcessLifecycleStageStatus,
  evidenceItems: AppProcessEvidence[],
  findings: string[],
): AppProcessLifecycleStage {
  return {
    stage,
    status,
    evidence: evidenceItems,
    findings,
  };
}

function createRepoIntelligence(featureIndex: RepoFeatureIndex): AppProcessRepoIntelligence {
  return {
    featureIndexPath: ".wormhole/feature-index.json",
    featureIndexFingerprint: featureIndex.fingerprint,
    featureCount: featureIndex.featureCount,
    features: featureIndex.features.slice(0, 24).map(toAppProcessFeatureSummary),
  };
}

function toAppProcessFeatureSummary(feature: RepoFeature): AppProcessFeatureSummary {
  const keyFiles = [
    ...feature.routes,
    ...feature.hooks,
    ...feature.tests.slice(0, 2),
    ...feature.docs.slice(0, 2),
    ...feature.files
      .filter((file) => file.roles.includes("backend") || file.roles.includes("frontend") || file.roles.includes("db"))
      .map((file) => file.path),
  ];
  return {
    featureId: feature.featureId,
    name: feature.name,
    fileCount: feature.fileCount,
    roots: feature.roots.slice(0, 8),
    keyFiles: [...new Set(keyFiles)].slice(0, 12),
    sideEffects: feature.risk.sideEffects,
  };
}

function createSecurity(product: AppProcessProductDefinition): AppProcessSecurity {
  const requiredControls = [
    "Document trust boundaries before implementing data writes.",
    "Add authorization checks for user- or tenant-scoped data.",
    "Include test coverage for security-relevant acceptance criteria.",
  ];
  if (product.securityPosture === "high") {
    requiredControls.unshift("Add auditability and least-privilege handling for high-sensitivity data.");
  }
  return {
    posture: product.securityPosture,
    dataClasses: product.dataClasses,
    requiredControls,
  };
}

function createUx(product: AppProcessProductDefinition): AppProcessUx {
  const primaryEntity = product.keyEntities[0] ?? "Item";
  return {
    primaryFlows: [
      `Create and review ${primaryEntity.toLowerCase()} records.`,
      `Resolve validation or permission issues before data is persisted.`,
    ],
    screens: [
      `${primaryEntity} list`,
      `${primaryEntity} detail`,
      `${primaryEntity} create or edit`,
      "Settings and verification status",
    ],
    informationArchitecture: [
      "Primary work queue",
      "Entity management",
      "Settings",
      "Audit or status surface",
    ],
  };
}

function createRoadmap(input: {
  product: AppProcessProductDefinition;
  architecture: AppProcessArchitecture;
  verification: AppProcessVerification;
}): AppProcessRoadmap {
  const primaryEntity = input.product.keyEntities[0] ?? "Application";
  const testVerification = verificationLabel(input.verification);
  const phases: AppProcessPhase[] = [
    {
      phase: 0,
      goal: "Confirm discovery and constraints before implementation.",
      milestone: "Product assumptions, architecture constraints, and security posture are visible to agents.",
      stories: [
        story(0, 1, "Confirm product definition and non-goals", "product", "p0", [
          "Product problem, users, non-goals, and assumptions are visible in .wormhole artifacts.",
          "Unconfirmed AI-drafted assumptions remain marked as provisional.",
        ], [], ["app_process_validate"]),
        story(0, 2, "Lock architecture and verification constraints", "architecture", "p0", [
          `Package manager is recorded as ${input.architecture.stack.packageManager}.`,
          "Required verification commands are linked from the app process.",
        ], ["APP-P0-S1"], [testVerification]),
      ],
    },
    {
      phase: 1,
      goal: `Deliver the MVP ${primaryEntity} workflow.`,
      milestone: "A usable vertical slice is ready for implementation by lane agents.",
      stories: [
        story(1, 1, `Implement ${primaryEntity} backend workflow`, "backend", "p0", [
          `${primaryEntity} data contracts and persistence boundaries are explicit.`,
          "Backend errors map to user-facing states and test expectations.",
        ], ["APP-P0-S2"], [testVerification]),
        story(1, 2, `Implement ${primaryEntity} frontend workflow`, "frontend", "p0", [
          `${primaryEntity} list and detail flows support the MVP job-to-be-done.`,
          "Loading, empty, and error states are represented.",
        ], ["APP-P1-S1"], [testVerification]),
        story(1, 3, "Verify MVP acceptance criteria", "tests", "p0", [
          "Acceptance criteria for phase 1 stories have focused tests or documented verification.",
          "Required verification command is reported before completion.",
        ], ["APP-P1-S1", "APP-P1-S2"], [testVerification]),
      ],
    },
    {
      phase: 2,
      goal: "Harden and prepare release.",
      milestone: "Security, documentation, and operational checks are ready for release review.",
      stories: [
        story(2, 1, "Harden security and data handling", "security", input.product.securityPosture === "high" ? "p0" : "p1", [
          "Security-relevant data classes have documented controls.",
          "Authorization and validation checks are covered by tests or review notes.",
        ], ["APP-P1-S3"], [testVerification]),
        story(2, 2, "Document release and agent handoff", "docs", "p1", [
          "Product scope, roadmap, and verification expectations are documented.",
          "Known assumptions remain visible for future planning.",
        ], ["APP-P2-S1"], [testVerification]),
      ],
    },
  ];
  if (input.product.securityPosture === "high") {
    phases[0]?.stories.push(
      story(0, 3, "Create high-sensitivity data handling plan", "security", "p0", [
        "Billing, identity, or customer data handling controls are listed before implementation starts.",
        "Security story is a dependency of MVP implementation work.",
      ], ["APP-P0-S1"], [testVerification]),
    );
    phases[1]?.stories.forEach((candidate) => {
      if (candidate.ownerLane === "backend" || candidate.ownerLane === "frontend") {
        candidate.dependencies.push("APP-P0-S3");
      }
    });
  }
  return {
    currentPhase: 1,
    readyToBuild: true,
    phases,
  };
}

function story(
  phase: number,
  index: number,
  title: string,
  ownerLane: AppProcessStoryLane,
  priority: AppProcessStory["priority"],
  acceptanceCriteria: string[],
  dependencies: string[],
  verifiableBy: string[],
): AppProcessStory {
  return {
    storyId: `APP-P${phase}-S${index}`,
    title,
    ownerLane,
    priority,
    phase,
    acceptanceCriteria,
    dependencies,
    verifiableBy,
    provisional: true,
  };
}

function createProgressiveState(input: {
  product: AppProcessProductDefinition;
  roadmap: AppProcessRoadmap;
  backlog: AppProcessBacklog;
  architecture: AppProcessArchitecture;
  ux: AppProcessUx;
  security: AppProcessSecurity;
  verification: AppProcessVerification;
  lifecycle: AppProcessLifecycle;
}): AppProcessProgressiveState {
  const counts: Record<AppProcessLaneId, number> = {
    discovery: input.product.assumptions.length,
    product: input.product.keyEntities.length + input.product.targetUsers.length,
    roadmap: input.roadmap.phases.length,
    backlog: input.backlog.stories.length,
    architecture: input.architecture.boundaries.length + input.architecture.constraints.length,
    ux: input.ux.primaryFlows.length + input.ux.screens.length,
    security: input.security.requiredControls.length,
    verification: input.verification.requiredCommands.length + input.verification.qualityGates.length,
    lifecycle: input.lifecycle.stages.length + input.lifecycle.requiredSignals.length,
  };
  return {
    status: "partial",
    lanes: APP_PROCESS_LANES.map((lane) => ({
      lane,
      status: "pending",
      itemCount: counts[lane],
      artifactPath: `.wormhole/lanes/${lane}.md`,
    })),
  };
}

function lifecycleSampleFiles(blueprint: BlueprintCompileResult): string[] {
  return [
    ...new Set(
      (blueprint.progressive?.lanes ?? []).flatMap((lane) =>
        lane.sampleFiles.map((sampleFile) => sampleFile.replaceAll("\\", "/")),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function isMigrationPath(repoPath: string): boolean {
  return /(^|\/)(migrations?|prisma\/migrations)(\/|$)/i.test(repoPath) ||
    /(^|\/).*migration.*\.(sql|ts|js|mjs|cjs)$/i.test(repoPath);
}

function isDeploymentPath(repoPath: string): boolean {
  return /(^|\/)(deploy|deployment|docker|infra|k8s|helm|nginx)(\/|$)/i.test(repoPath) ||
    /(^|\/)\.github\/workflows\//i.test(repoPath) ||
    /(^|\/)(dockerfile|docker-compose|vercel\.json|netlify\.toml|fly\.toml)$/i.test(repoPath);
}

function isConcreteLifecycleValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "unknown" && normalized !== "none";
}

function extractEntities(objective: string, repoSummary: string): string[] {
  const entities = new Set<string>();
  const text = `${objective}\n${repoSummary}`;
  for (const keyword of ENTITY_KEYWORDS) {
    if (keyword.pattern.test(text)) {
      for (const entity of keyword.entities) {
        entities.add(entity);
      }
    }
  }
  for (const token of objective.matchAll(/\b[A-Za-z][A-Za-z0-9-]{3,}\b/g)) {
    const value = token[0].toLowerCase();
    if (!STOP_WORDS.has(value)) {
      entities.add(titleCase(singularize(value)));
    }
  }
  if (entities.size === 0) {
    entities.add("Application");
  }
  return [...entities].slice(0, 12);
}

function inferTargetUsers(objective: string, entities: string[]): string[] {
  const lower = objective.toLowerCase();
  if (lower.includes("accountant") || entities.includes("Accountant")) {
    return ["Accountants", "Operations admins"];
  }
  if (lower.includes("team") || entities.includes("Team")) {
    return ["Team members", "Team admins"];
  }
  if (lower.includes("client") || entities.includes("Client")) {
    return ["Clients", "Internal operators"];
  }
  return ["Application users", "Workspace admins"];
}

function inferDataClasses(objective: string, entities: string[]): string[] {
  const lower = objective.toLowerCase();
  const classes = new Set<string>(["application_data"]);
  if (/\bbilling|payment|subscription|invoice\b/.test(lower) || entities.some((entity) => ["Invoice", "Payment", "Subscription"].includes(entity))) {
    classes.add("billing_data");
    classes.add("customer_data");
  }
  if (/\bauth|login|signup|user|account\b/.test(lower) || entities.includes("User")) {
    classes.add("identity_data");
  }
  if (/\bschedule|calendar|appointment\b/.test(lower) || entities.includes("Schedule")) {
    classes.add("calendar_data");
  }
  return [...classes].sort((left, right) => left.localeCompare(right));
}

function inferSecurityPosture(objective: string, entities: string[]): AppProcessSecurityPosture {
  const lower = objective.toLowerCase();
  if (/\bbilling|payment|subscription|invoice|auth|login|credential\b/.test(lower)) {
    return "high";
  }
  if (entities.some((entity) => ["Client", "User", "Accountant"].includes(entity))) {
    return "medium";
  }
  return "medium";
}

function productEvidence(repoRoot: string): AppProcessEvidence[] {
  const readmePath = path.join(repoRoot, "README.md");
  if (!existsSync(readmePath) || !statSync(readmePath).isFile()) {
    return [];
  }
  return [evidence("repo", "README.md contributed product context.", 0.55, "README.md")];
}

function readRepoSummary(repoRoot: string): string {
  const readmePath = path.join(repoRoot, "README.md");
  try {
    if (existsSync(readmePath) && statSync(readmePath).isFile()) {
      return readFileSync(readmePath, "utf8").slice(0, 12_000);
    }
  } catch {
    return "";
  }
  return "";
}

function section<T>(
  value: T,
  status: AppProcessSectionStatus,
  confidence: number,
  evidenceItems: AppProcessEvidence[],
): AppProcessSection<T> {
  return {
    value,
    status,
    confidence,
    evidence: evidenceItems,
  };
}

function evidence(
  source: AppProcessEvidence["source"],
  summary: string,
  confidence: number,
  sourcePath?: string,
): AppProcessEvidence {
  return {
    source,
    ...(sourcePath ? { sourcePath } : {}),
    summary,
    confidence,
  };
}

function verificationLabel(verification: AppProcessVerification): string {
  const firstCommand = verification.requiredCommands[0];
  if (!firstCommand) {
    return "manual_verification";
  }
  return [firstCommand.command, ...firstCommand.args].join(" ");
}

function normalizeObjective(objective: string): string {
  const trimmed = objective.trim();
  if (!trimmed) {
    return "Define the application process.";
  }
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function lowercaseFirst(value: string): string {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function singularize(value: string): string {
  if (value.endsWith("ss")) {
    return value;
  }
  if (value.endsWith("ies") && value.length > 4) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("s") && value.length > 4) {
    return value.slice(0, -1);
  }
  return value;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function fingerprintAppProcess(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

function verificationMatches(
  required: BlueprintCommand,
  reported: AppProcessGateReportedVerification,
): boolean {
  if (reported.status !== "passed" || required.command !== reported.command) {
    return false;
  }
  const requiredArgs = required.args.join(" ");
  const reportedArgs = (reported.args ?? []).join(" ");
  return requiredArgs === reportedArgs || requiredArgs.endsWith(` ${reportedArgs}`);
}
