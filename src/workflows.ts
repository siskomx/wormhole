import { createHash } from "node:crypto";
import type { AgentToolCall, AgentRoute, StateMaintenanceAdvice } from "./agent-routing.js";
import {
  createFeatureIndex,
  type FeatureSideEffect,
  type RepoFeature,
  type RepoFeatureIndex,
} from "./feature-index.js";
import { detectProjectContract } from "./project-contract.js";
import { buildRepoIndex } from "./repo-index.js";
import {
  classifySourceProvenance,
  compareSourceProvenance,
  type SourceConflict,
  type SourceProvenance,
} from "./source-authority.js";
import { analyzeSourceConflicts } from "./source-conflicts.js";

export type WorkflowKind =
  | "workflow_start_feature"
  | "workflow_fix_bug"
  | "workflow_review_pr"
  | "workflow_onboard_repo";

export type WorkflowPhaseName =
  | "orient"
  | "impact"
  | "context"
  | "act"
  | "verify"
  | "gate"
  | "maintain";

export type WorkflowPhase = {
  name: WorkflowPhaseName;
  goal: string;
  calls: AgentToolCall[];
  evidence: string[];
  gate: {
    requiredBeforeProceeding: string[];
    stopWhen: string[];
  };
};

export type WorkflowRunState = {
  schemaVersion: "workflow-run.v0";
  runId: string;
  workflow: WorkflowKind;
  repoRoot: string;
  objective: string;
  missionId?: string;
  createdAt: string;
  updatedAt: string;
  status: "planned" | "blocked";
  currentPhase: WorkflowPhaseName;
  completedPhases: WorkflowPhaseName[];
  featureIds: string[];
};

export type WorkflowFeatureBinding = {
  featureId: string;
  name: string;
  featureIndexPath: string;
  fileCount: number;
  roots: string[];
  keyFiles: string[];
  routes: string[];
  hooks: string[];
  dbTables: string[];
  tests: string[];
  docs: string[];
  sourceOfTruth: SourceProvenance[];
  supportingDocs: SourceProvenance[];
  conflicts: SourceConflict[];
  sideEffects: FeatureSideEffect[];
  evidence: string[];
};

export type WorkflowExactNextAction = AgentToolCall & {
  phase: WorkflowPhaseName;
};

export type WorkflowVerificationContract = {
  tier: "focused" | "standard" | "review" | "onboarding";
  commandsSource: "test_plan_select";
  requiredTools: string[];
  changedFiles: string[];
  featureIds: string[];
  evidenceRequired: string[];
};

export type WorkflowArtifactRequirement = {
  path: string;
  kind: "workflow_state" | "workflow_resume" | "workflow_latest";
  status: "required";
  description: string;
};

export type WorkflowArtifactWriteStatus = {
  generated: boolean;
  status: "not_written";
  writerTool: "workflow_write_artifacts";
  message: string;
};

export type WorkflowResume = {
  artifactPath: string;
  summary: string;
  exactNextAction: string;
  featureIds: string[];
  sourceOfTruth: SourceProvenance[];
  supportingDocs: SourceProvenance[];
  conflicts: SourceConflict[];
};

export type WorkflowFeatureIndexSummary = {
  path: ".wormhole/feature-index.json";
  fingerprint: string;
  featureCount: number;
};

export type WorkflowSequence = {
  workflow: WorkflowKind;
  repoRoot: string;
  objective: string;
  mode: AgentRoute;
  run: WorkflowRunState;
  featureIndex: WorkflowFeatureIndexSummary;
  featureBindings: WorkflowFeatureBinding[];
  artifactWriteStatus: WorkflowArtifactWriteStatus;
  exactNextAction: WorkflowExactNextAction;
  verificationContract: WorkflowVerificationContract;
  requiredArtifacts: WorkflowArtifactRequirement[];
  resume: WorkflowResume;
  nextCalls: AgentToolCall[];
  phases: WorkflowPhase[];
  stateMaintenance: StateMaintenanceAdvice;
  stopRule: string;
};

export type WorkflowInput = {
  repoRoot: string;
  objective: string;
  query?: string;
  missionId?: string;
  changedFiles?: string[];
  diffText?: string;
  diagnosticSource?: string;
};

const DEFAULT_CONTEXT_CHARS = 6_000;

export function createFeatureWorkflow(input: WorkflowInput): WorkflowSequence {
  const changedFiles = input.changedFiles ?? [];
  return workflow({
    kind: "workflow_start_feature",
    input,
    mode: changedFiles.length > 3 ? "deep" : "balanced",
    nextCalls: [
      toolCall("project_onboard", 100, "Onboard the repo and collect contract, index, safety, and policy signals.", {
        repoRoot: input.repoRoot,
        changedFiles,
      }),
      toolCall("mission_route", 95, "Create the task route before lower-level tools.", routeInput(input)),
      toolCall("agent_context_prepare", 90, "Prepare a context pack and exact next calls for the feature.", {
        ...routeInput(input),
        query: input.query ?? input.objective,
      }),
    ],
    phases: [
      phase("orient", "Build the repo map and route before broad reads.", [
        toolCall("project_onboard", 100, "Collect project, safety, dependency, and policy signals.", {
          repoRoot: input.repoRoot,
          changedFiles,
        }),
        toolCall("architecture_map", 90, "Map modules, ownership, dependencies, and evidence.", {
          repoRoot: input.repoRoot,
        }),
      ], ["Project contract and architecture evidence"], ["project_onboard"]),
      phase("context", "Create a bounded source-backed pack for the feature.", [
        toolCall("context_pack_generate", 100, "Render task context before editing.", {
          repoRoot: input.repoRoot,
          objective: input.objective,
          query: input.query ?? input.objective,
          changedFiles,
          maxChars: DEFAULT_CONTEXT_CHARS,
        }),
      ], ["Context pack source list"], ["context_pack_generate"]),
      phase("act", "Prepare reversible and policy-reviewed implementation work.", [
        toolCall("tool_admission_review", 100, "Review write/execute tools before side effects.", {
          toolNames: ["patch_apply", "verification_run"],
        }),
        toolCall("action_policy_review", 95, "Review intended commands and writes before patching.", {
          operations: [],
        }),
        toolCall("patch_checkpoint", 90, "Create rollback checkpoint before applying patch transactions.", {
          repoRoot: input.repoRoot,
          files: changedFiles,
        }, ["files to checkpoint"]),
      ], ["Policy review and checkpoint id"], ["action_policy_review", "patch_checkpoint"]),
      phase("verify", "Run focused verification before claiming completion.", [
        toolCall("test_plan_select", 90, "Select focused verification commands.", {
          repoRoot: input.repoRoot,
          changedFiles,
        }),
        toolCall("verification_run", 85, "Run selected verification commands.", {}, ["commands from test_plan_select"]),
      ], ["Verification result hashes"], ["verification_run"]),
      gatePhase(),
    ],
    stopRule: "Stop if policy review requires unavailable approval, checkpoint creation fails, verification fails, or the evidence gate closes.",
  });
}

export function createBugfixWorkflow(input: WorkflowInput): WorkflowSequence {
  const changedFiles = input.changedFiles ?? [];
  return workflow({
    kind: "workflow_fix_bug",
    input,
    mode: "balanced",
    nextCalls: [
      toolCall("diagnostics_from_command", 100, "Normalize the failing command or repro output first.", {
        source: input.diagnosticSource ?? "repro",
        output: "",
      }, ["failing output"]),
      toolCall("blast_radius_analyze", 95, "Scope affected files and likely tests from the failing area.", {
        repoRoot: input.repoRoot,
        changedFiles,
        diffText: input.diffText,
      }),
      toolCall("context_pack_generate", 90, "Prepare a bug-focused context pack.", {
        repoRoot: input.repoRoot,
        objective: input.objective,
        query: input.query ?? input.objective,
        changedFiles,
        maxChars: DEFAULT_CONTEXT_CHARS,
      }),
    ],
    phases: [
      phase("orient", "Capture the repro signal before changing code.", [
        toolCall("diagnostics_from_command", 100, "Convert repro or test output into structured diagnostics.", {
          source: input.diagnosticSource ?? "repro",
          output: "",
        }, ["failing output"]),
        toolCall("project_onboard", 85, "Refresh project contract and index context.", {
          repoRoot: input.repoRoot,
          changedFiles,
        }),
      ], ["Reproduction diagnostics"], ["diagnostics_from_command"]),
      phase("impact", "Bound the bug blast radius and likely tests.", [
        toolCall("blast_radius_analyze", 100, "Analyze affected files, modules, entrypoints, and tests.", {
          repoRoot: input.repoRoot,
          changedFiles,
          diffText: input.diffText,
        }),
        toolCall("test_impact_analyze_v2", 90, "Map changed hunks and symbols to likely tests.", {
          repoRoot: input.repoRoot,
          changedFiles,
          diffText: input.diffText,
        }),
      ], ["Blast radius and test impact evidence"], ["blast_radius_analyze"]),
      phase("context", "Prepare only the bug-relevant source context.", [
        toolCall("context_pack_generate", 100, "Render focused bug context.", {
          repoRoot: input.repoRoot,
          objective: input.objective,
          query: input.query ?? input.objective,
          changedFiles,
          maxChars: DEFAULT_CONTEXT_CHARS,
        }),
      ], ["Context pack source list"], ["context_pack_generate"]),
      phase("act", "Patch only after repro, impact, policy, and checkpoint are ready.", [
        toolCall("tool_admission_review", 95, "Review patch and verification tool preflights.", {
          toolNames: ["patch_apply", "verification_run"],
        }),
        toolCall("patch_checkpoint", 90, "Checkpoint changed files before patching.", {
          repoRoot: input.repoRoot,
          files: changedFiles,
        }, ["files to checkpoint"]),
      ], ["Checkpoint id"], ["patch_checkpoint"]),
      phase("verify", "Run repro/focused tests before completion.", [
        toolCall("test_plan_select", 95, "Select focused verification for the bug.", {
          repoRoot: input.repoRoot,
          changedFiles,
        }),
        toolCall("verification_run", 90, "Run focused verification and preserve hashes.", {}, [
          "commands from test_plan_select",
        ]),
      ], ["Focused verification result"], ["verification_run"]),
      gatePhase(),
    ],
    stopRule: "Stop when reproduction is missing, the fix cannot be checkpointed, verification fails, or the evidence gate closes.",
  });
}

export function createReviewWorkflow(input: WorkflowInput): WorkflowSequence {
  const changedFiles = input.changedFiles ?? [];
  return workflow({
    kind: "workflow_review_pr",
    input,
    mode: changedFiles.length > 5 ? "deep" : "balanced",
    nextCalls: [
      toolCall("repo_change_scan", 100, "Detect changed files and diff scope for review.", {
        repoRoot: input.repoRoot,
      }),
      toolCall("blast_radius_analyze", 95, "Analyze the review blast radius.", {
        repoRoot: input.repoRoot,
        changedFiles,
        diffText: input.diffText,
      }),
      toolCall("test_plan_select", 90, "Select review verification tiers.", {
        repoRoot: input.repoRoot,
        changedFiles,
      }),
    ],
    phases: [
      phase("orient", "Collect diff and project context for review.", [
        toolCall("repo_change_scan", 100, "Read local changed-file and git diff state.", {
          repoRoot: input.repoRoot,
        }),
        toolCall("project_onboard", 90, "Refresh project index and policy context.", {
          repoRoot: input.repoRoot,
          changedFiles,
          diffText: input.diffText,
        }),
      ], ["Changed-file and project context"], ["repo_change_scan"]),
      phase("impact", "Assess what the PR can affect.", [
        toolCall("blast_radius_analyze", 100, "Analyze impacted modules, entrypoints, and likely tests.", {
          repoRoot: input.repoRoot,
          changedFiles,
          diffText: input.diffText,
        }),
        toolCall("test_impact_analyze_v2", 90, "Map changed hunks to tests.", {
          repoRoot: input.repoRoot,
          changedFiles,
          diffText: input.diffText,
        }),
      ], ["Blast radius evidence"], ["blast_radius_analyze"]),
      phase("verify", "Run security, dependency, and verification review checks.", [
        toolCall("secret_scan", 95, "Scan changed repo scope for likely secrets.", {
          repoRoot: input.repoRoot,
        }),
        toolCall("dependency_security_report", 90, "Review dependency and lockfile metadata.", {
          repoRoot: input.repoRoot,
        }),
        toolCall("test_plan_select", 85, "Select verification commands for the changed lanes.", {
          repoRoot: input.repoRoot,
          changedFiles,
        }),
        toolCall("verification_run", 80, "Run selected verification commands.", {}, ["commands from test_plan_select"]),
      ], ["Security and verification findings"], ["secret_scan", "verification_run"]),
      gatePhase(),
    ],
    stopRule: "Review workflows are read-only by default; stop on secret findings, verification failure, or closed evidence gate.",
  });
}

export function createOnboardingWorkflow(input: WorkflowInput): WorkflowSequence {
  return workflow({
    kind: "workflow_onboard_repo",
    input,
    mode: "balanced",
    nextCalls: [
      toolCall("project_onboard", 100, "Create the first repo contract, index, safety, and verification snapshot.", {
        repoRoot: input.repoRoot,
      }),
      toolCall("architecture_map", 95, "Map modules and ownership.", {
        repoRoot: input.repoRoot,
      }),
      toolCall("entrypoint_flow_discover", 90, "Find API, CLI, worker, and script entrypoints.", {
        repoRoot: input.repoRoot,
      }),
    ],
    phases: [
      phase("orient", "Build the repo operating picture.", [
        toolCall("project_onboard", 100, "Collect contract, repo index, safety, dependency, and policy signals.", {
          repoRoot: input.repoRoot,
        }),
        toolCall("architecture_map", 95, "Map modules and ownership.", {
          repoRoot: input.repoRoot,
        }),
        toolCall("entrypoint_flow_discover", 90, "Discover operational entrypoints.", {
          repoRoot: input.repoRoot,
        }),
      ], ["Project onboarding report"], ["project_onboard"]),
      phase("context", "Prepare a compact repo orientation pack.", [
        toolCall("project_intelligence_snapshot", 95, "Return compact route and repo intelligence snapshot.", {
          repoRoot: input.repoRoot,
          objective: input.objective,
          query: input.query ?? input.objective,
        }),
        toolCall("context_pack_generate", 90, "Render onboarding context.", {
          repoRoot: input.repoRoot,
          objective: input.objective,
          query: input.query ?? input.objective,
          maxChars: DEFAULT_CONTEXT_CHARS,
        }),
      ], ["Project-intelligence snapshot"], ["project_intelligence_snapshot"]),
      phase("maintain", "Choose the visible tool surface for the agent.", [
        toolCall("tool_exposure_profile", 100, "Start from guided or layered profile before raw tools.", {
          mode: "guided",
        }),
        toolCall("tool_catalog_query", 95, "Query only the next needed pack.", {
          pack: "core",
        }),
      ], ["Tool exposure profile"], ["tool_exposure_profile"]),
      gatePhase(),
    ],
    stopRule: "Stop after producing the onboarding map, context pack, and evidence gate status.",
  });
}

function workflow(input: {
  kind: WorkflowKind;
  input: WorkflowInput;
  mode: AgentRoute;
  nextCalls: AgentToolCall[];
  phases: WorkflowPhase[];
  stopRule: string;
}): WorkflowSequence {
  const now = new Date().toISOString();
  const featureIndex = createFeatureIndex({
    repoRoot: input.input.repoRoot,
    generatedAt: now,
  });
  const sourceConflicts = collectWorkflowSourceConflicts(input.input.repoRoot);
  const featureBindings = bindWorkflowFeatures({
    featureIndex,
    sourceConflicts,
    objective: input.input.objective,
    query: input.input.query,
    changedFiles: input.input.changedFiles ?? [],
    workflow: input.kind,
  });
  const exactNextAction = createExactNextAction(input.phases, input.nextCalls);
  const runId = createWorkflowRunId({
    workflow: input.kind,
    repoRoot: input.input.repoRoot,
    objective: input.input.objective,
    missionId: input.input.missionId,
    featureIds: featureBindings.map((feature) => feature.featureId),
  });
  const requiredArtifacts = createRequiredArtifacts(runId);
  const verificationContract = createVerificationContract({
    workflow: input.kind,
    phases: input.phases,
    changedFiles: input.input.changedFiles ?? [],
    featureBindings,
  });
  const run: WorkflowRunState = {
    schemaVersion: "workflow-run.v0",
    runId,
    workflow: input.kind,
    repoRoot: input.input.repoRoot,
    objective: input.input.objective,
    ...(input.input.missionId ? { missionId: input.input.missionId } : {}),
    createdAt: now,
    updatedAt: now,
    status: "planned",
    currentPhase: exactNextAction.phase,
    completedPhases: [],
    featureIds: featureBindings.map((feature) => feature.featureId),
  };
  return {
    workflow: input.kind,
    repoRoot: input.input.repoRoot,
    objective: input.input.objective,
    mode: input.mode,
    run,
    featureIndex: {
      path: ".wormhole/feature-index.json",
      fingerprint: featureIndex.fingerprint,
      featureCount: featureIndex.featureCount,
    },
    featureBindings,
    artifactWriteStatus: {
      generated: false,
      status: "not_written",
      writerTool: "workflow_write_artifacts",
      message: "Workflow artifacts are planned but not written; call workflow_write_artifacts to create files.",
    },
    exactNextAction,
    verificationContract,
    requiredArtifacts,
    resume: createWorkflowResume({
      runId,
      workflow: input.kind,
      objective: input.input.objective,
      exactNextAction,
      featureBindings,
    }),
    nextCalls: input.nextCalls,
    phases: input.phases,
    stateMaintenance: stateMaintenanceAdvice(),
    stopRule: input.stopRule,
  };
}

function phase(
  name: WorkflowPhaseName,
  goal: string,
  calls: AgentToolCall[],
  evidence: string[],
  requiredBeforeProceeding: string[],
  stopWhen: string[] = ["required evidence is missing", "a recommended gate closes"],
): WorkflowPhase {
  return {
    name,
    goal,
    calls,
    evidence,
    gate: {
      requiredBeforeProceeding,
      stopWhen,
    },
  };
}

function gatePhase(): WorkflowPhase {
  return phase("gate", "Record evidence and request the Wormhole gate before the final response.", [
    toolCall("record_evidence", 100, "Record source-backed workflow findings before final claims.", {}, [
      "missionId",
      "source evidence fields",
    ]),
    toolCall("gate_request", 95, "Check whether evidence and open questions permit the final response.", {}, [
      "missionId",
    ]),
  ], ["Recorded evidence ids"], ["record_evidence", "gate_request"]);
}

function toolCall(
  toolName: string,
  priority: number,
  reason: string,
  input: AgentToolCall["input"],
  missingInput?: string[],
): AgentToolCall {
  return {
    toolName,
    priority,
    reason,
    input,
    ...(missingInput ? { missingInput } : {}),
  };
}

function routeInput(input: WorkflowInput): AgentToolCall["input"] {
  return {
    repoRoot: input.repoRoot,
    objective: input.objective,
    query: input.query ?? input.objective,
    changedFiles: input.changedFiles ?? [],
    ...(input.diffText ? { diffText: input.diffText } : {}),
  };
}

function bindWorkflowFeatures(input: {
  featureIndex: RepoFeatureIndex;
  sourceConflicts: SourceConflict[];
  objective: string;
  query?: string;
  changedFiles: string[];
  workflow: WorkflowKind;
}): WorkflowFeatureBinding[] {
  const changedFiles = new Set(input.changedFiles.map(toRepoPath));
  const objectiveText = normalizeLookup(`${input.objective} ${input.query ?? ""}`);
  const scoredFeatures = input.featureIndex.features
    .map((feature) => ({
      feature,
      score: scoreFeatureBinding({
        feature,
        changedFiles,
        objectiveText,
      }),
    }))
    .filter((entry) => entry.score > 0 || input.workflow === "workflow_onboard_repo")
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      return scoreDelta === 0 ? left.feature.featureId.localeCompare(right.feature.featureId) : scoreDelta;
    })
    .slice(0, input.workflow === "workflow_onboard_repo" ? 5 : 3);

  return scoredFeatures.map(({ feature }) => toFeatureBinding(feature, input.sourceConflicts));
}

function scoreFeatureBinding(input: {
  feature: RepoFeature;
  changedFiles: Set<string>;
  objectiveText: string;
}): number {
  let score = 0;
  const featureText = normalizeLookup(input.feature.featureId);
  const featureWords = normalizeLookup(input.feature.featureId.replace(/-/g, " "));
  if (input.objectiveText.includes(featureText) || input.objectiveText.includes(featureWords)) {
    score += 50 + input.feature.featureId.split("-").length * 20;
  }
  for (const file of input.feature.files) {
    if (input.changedFiles.has(toRepoPath(file.path))) {
      score += 100;
    }
  }
  for (const root of input.feature.roots) {
    const normalizedRoot = `${toRepoPath(root)}/`;
    if (!normalizeLookup(root).includes(featureText)) {
      continue;
    }
    if ([...input.changedFiles].some((file) => file.startsWith(normalizedRoot))) {
      score += 25;
    }
  }
  return score;
}

function toFeatureBinding(feature: RepoFeature, sourceConflicts: SourceConflict[]): WorkflowFeatureBinding {
  return {
    featureId: feature.featureId,
    name: feature.name,
    featureIndexPath: ".wormhole/feature-index.json",
    fileCount: feature.fileCount,
    roots: feature.roots,
    keyFiles: feature.files.slice(0, 20).map((file) => file.path),
    routes: feature.routes,
    hooks: feature.hooks,
    dbTables: feature.dbTables,
    tests: feature.tests,
    docs: feature.docs,
    sourceOfTruth: feature.sourceOfTruth,
    supportingDocs: feature.supportingDocs,
    conflicts: uniqueSourceConflicts([
      ...feature.conflicts,
      ...sourceConflicts.filter((conflict) => conflictBelongsToFeature(conflict, feature)),
    ]),
    sideEffects: feature.risk.sideEffects,
    evidence: feature.evidence,
  };
}

function collectWorkflowSourceConflicts(repoRoot: string): SourceConflict[] {
  try {
    const index = buildRepoIndex({ repoRoot });
    return analyzeSourceConflicts({
      repoRoot,
      index,
      contract: detectProjectContract({ repoRoot }),
    }).conflicts;
  } catch {
    return [];
  }
}

function conflictBelongsToFeature(conflict: SourceConflict, feature: RepoFeature): boolean {
  const featurePaths = new Set(feature.files.map((file) => toRepoPath(file.path)));
  const featureRoots = feature.roots
    .map(toRepoPath)
    .filter((root) => isSpecificFeatureRoot(root, feature.featureId));
  const conflictPaths = [
    ...conflictingSourcePathsFromConflict(conflict),
    ...subjectPathsFromConflict(conflict.subject),
  ];

  return conflictPaths.some((repoPath) => pathBelongsToFeature(repoPath, featurePaths, featureRoots));
}

function pathBelongsToFeature(pathInput: string, featurePaths: Set<string>, featureRoots: string[]): boolean {
  const repoPath = toRepoPath(pathInput);
  return featurePaths.has(repoPath) || featureRoots.some((root) => repoPath === root || repoPath.startsWith(`${root}/`));
}

function isSpecificFeatureRoot(rootInput: string, featureId: string): boolean {
  const root = toRepoPath(rootInput);
  if (root === "." || root.startsWith("docs/") || root === "migrations" || root.startsWith("migrations/")) {
    return false;
  }
  return normalizeLookup(root).includes(normalizeLookup(featureId));
}

function conflictingSourcePathsFromConflict(conflict: SourceConflict): string[] {
  return conflict.conflicting
    .map((source) => source.sourcePath)
    .filter((sourcePath): sourcePath is string => Boolean(sourcePath));
}

function subjectPathsFromConflict(subject: string): string[] {
  return subject.includes(" -> ") ? subject.split(" -> ") : [];
}

function uniqueSourceConflicts(conflicts: SourceConflict[]): SourceConflict[] {
  const byKey = new Map<string, SourceConflict>();
  for (const conflict of conflicts) {
    byKey.set(`${conflict.subject}\0${conflict.message}`, conflict);
  }
  return [...byKey.values()].sort((left, right) => left.subject.localeCompare(right.subject));
}

function createExactNextAction(
  phases: WorkflowPhase[],
  nextCalls: AgentToolCall[],
): WorkflowExactNextAction {
  const firstPhase = phases[0];
  const firstCall = firstPhase?.calls[0] ?? nextCalls[0];
  if (!firstPhase || !firstCall) {
    throw new Error("Workflow requires at least one phase and one tool call");
  }
  return {
    phase: firstPhase.name,
    ...firstCall,
  };
}

function createVerificationContract(input: {
  workflow: WorkflowKind;
  phases: WorkflowPhase[];
  changedFiles: string[];
  featureBindings: WorkflowFeatureBinding[];
}): WorkflowVerificationContract {
  const verifyPhase = input.phases.find((phaseItem) => phaseItem.name === "verify");
  const requiredTools = [
    ...new Set((verifyPhase?.calls ?? []).map((call) => call.toolName).filter((toolName) => toolName !== "secret_scan")),
  ];
  return {
    tier: verificationTier(input.workflow, input.changedFiles),
    commandsSource: "test_plan_select",
    requiredTools,
    changedFiles: input.changedFiles.map(toRepoPath),
    featureIds: input.featureBindings.map((feature) => feature.featureId),
    evidenceRequired: [
      "test_plan_select selected commands",
      "verification_run result",
      "record_evidence ids",
      "gate_request status",
    ],
  };
}

function verificationTier(
  workflow: WorkflowKind,
  changedFiles: string[],
): WorkflowVerificationContract["tier"] {
  if (workflow === "workflow_review_pr") {
    return "review";
  }
  if (workflow === "workflow_onboard_repo") {
    return "onboarding";
  }
  return changedFiles.length > 0 ? "focused" : "standard";
}

function createWorkflowRunId(input: {
  workflow: WorkflowKind;
  repoRoot: string;
  objective: string;
  missionId?: string;
  featureIds: string[];
}): string {
  const hash = createHash("sha256")
    .update([
      input.workflow,
      input.repoRoot,
      input.objective,
      input.missionId ?? "",
      input.featureIds.join(","),
    ].join("\n"))
    .digest("hex")
    .slice(0, 12);
  return `${input.workflow.replace(/^workflow_/, "")}-${hash}`;
}

function createRequiredArtifacts(runId: string): WorkflowArtifactRequirement[] {
  return [
    {
      path: `.wormhole/workflows/${runId}.json`,
      kind: "workflow_state",
      status: "required",
      description: "Durable workflow run state for handoff and resume.",
    },
    {
      path: `.wormhole/workflows/${runId}.md`,
      kind: "workflow_resume",
      status: "required",
      description: "Human-readable workflow resume with exact next action.",
    },
    {
      path: ".wormhole/workflows/latest.json",
      kind: "workflow_latest",
      status: "required",
      description: "Pointer to the latest workflow run artifact.",
    },
  ];
}

function createWorkflowResume(input: {
  runId: string;
  workflow: WorkflowKind;
  objective: string;
  exactNextAction: WorkflowExactNextAction;
  featureBindings: WorkflowFeatureBinding[];
}): WorkflowResume {
  const featureIds = input.featureBindings.map((feature) => feature.featureId);
  const sourceOfTruth = [
    classifySourceProvenance({
      sourcePath: `.wormhole/workflows/${input.runId}.json`,
      authority: "derived_code_fact",
      freshness: "current",
      reason: "Durable workflow state generated from current repo workflow planning.",
    }),
    classifySourceProvenance({
      sourcePath: ".wormhole/feature-index.json",
      authority: "derived_code_fact",
      freshness: "current",
      reason: "Feature index generated from current repo files.",
    }),
    classifySourceProvenance({
      sourcePath: "workflow.verificationContract",
      authority: "derived_code_fact",
      freshness: "current",
      reason: "Verification contract generated by the workflow planner.",
    }),
    ...input.featureBindings.flatMap((feature) => feature.sourceOfTruth),
  ].sort(compareSourceProvenance);
  const supportingDocs = input.featureBindings
    .flatMap((feature) => feature.supportingDocs)
    .sort(compareSourceProvenance);
  const conflicts = input.featureBindings.flatMap((feature) => feature.conflicts);
  return {
    artifactPath: `.wormhole/workflows/${input.runId}.md`,
    summary: `${input.workflow} planned for: ${input.objective}`,
    exactNextAction: `${input.exactNextAction.toolName} (${input.exactNextAction.phase}): ${input.exactNextAction.reason}`,
    featureIds,
    sourceOfTruth,
    supportingDocs,
    conflicts,
  };
}

function normalizeLookup(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function stateMaintenanceAdvice(): StateMaintenanceAdvice {
  return {
    coordinator: {
      toolName: "state_maintenance_run",
      purpose: "Run graph, context, evidence, route, and shared-workspace maintenance as one audited pass.",
      useWhen: [
        "repo changes need graph and context refresh together",
        "parallel workers need shared maintenance state",
        "a handoff needs durable state refresh status",
      ],
    },
    discovery: {
      firstTools: ["tool_layer_map", "tool_exposure_profile", "tool_catalog_query"],
      purpose: "Keep agents on the golden path before specialist tools are needed.",
    },
    graph: {
      ownerTools: ["repo_graph_refresh_full", "repo_graph_refresh_incremental", "durable_index_status"],
      refreshWhen: ["repo changes are known", "index status is stale"],
    },
    context: {
      ownerTools: ["ctx_pack_budget_review", "ctx_pack_refresh", "context_pack_generate"],
      refreshWhen: ["context exceeds budget", "changed files alter the task scope"],
    },
    workspace: {
      ownerTools: ["agent_workspace_create", "agent_workspace_write", "agent_workspace_read", "agent_workspace_merge"],
      useWhen: ["multiple agents share findings", "handoffs need attributed state"],
    },
  };
}
