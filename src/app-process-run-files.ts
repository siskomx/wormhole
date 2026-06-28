import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AppProcess } from "./app-process.js";
import { compileBootstrapBlueprint } from "./blueprint.js";
import { createFeatureIndex } from "./feature-index.js";
import {
  acceptAppProcessSection,
  createAppProcessRunStatus,
  createInitialAppProcessRunState,
  continueAppProcessRun,
  recordAppProcessVerification,
  type AppProcessArtifactFreshness,
  type AppProcessDraftSectionId,
  type AppProcessRunEvent,
  type AppProcessRunState,
  type AppProcessRunStatusReport,
} from "./app-process-run.js";

export type AppProcessObjectiveFreshness = {
  status: "fresh" | "stale";
  actualObjective: string;
  expectedObjective?: string;
  reason?: string;
};

export type AppProcessFingerprintComparison = {
  status: "fresh" | "stale";
  expected: string;
  actual: string;
  reason?: string;
};

export type AppProcessFingerprintFreshness = {
  status: "fresh" | "stale";
  featureIndex: AppProcessFingerprintComparison;
  blueprint: AppProcessFingerprintComparison;
};

export type AppProcessRunBundle = {
  repoRoot: string;
  appProcess: AppProcess;
  runState: AppProcessRunState;
  artifacts: AppProcessArtifactFreshness[];
  objectiveFreshness?: AppProcessObjectiveFreshness;
  fingerprintFreshness?: AppProcessFingerprintFreshness;
  status: AppProcessRunStatusReport;
};

export type AppProcessRunFileMutationResult = AppProcessRunBundle & {
  event?: AppProcessRunEvent;
};

export function loadAppProcessRunBundle(input: {
  repoRoot: string;
  objective?: string;
  now?: string;
}): AppProcessRunBundle {
  const repoRoot = path.resolve(input.repoRoot);
  const appProcess = readJson<AppProcess>(repoRoot, ".wormhole/app-process.json");
  const runState = readRunState(repoRoot) ?? createInitialAppProcessRunState({
    appProcess,
    now: input.now,
  });
  const objectiveFreshness = evaluateObjectiveFreshness(appProcess, input.objective);
  const fingerprintFreshness = evaluateFingerprintFreshness(repoRoot, appProcess, input.objective);
  const artifacts = applyAppProcessFreshness(
    collectArtifactFreshness(repoRoot, appProcess),
    objectiveFreshness,
    fingerprintFreshness,
  );
  const status = createAppProcessRunStatus({ appProcess, runState, artifacts });
  return {
    repoRoot,
    appProcess,
    runState,
    artifacts,
    objectiveFreshness,
    fingerprintFreshness,
    status,
  };
}

export function acceptAppProcessRunSectionFile(input: {
  repoRoot: string;
  section: AppProcessDraftSectionId;
  acceptedBy?: string;
  note?: string;
  now?: string;
}): AppProcessRunFileMutationResult {
  const bundle = loadAppProcessRunBundle({ repoRoot: input.repoRoot, now: input.now });
  const previousEventCount = persistedRunStateExists(bundle.repoRoot) ? bundle.runState.events.length : 0;
  const result = acceptAppProcessSection({
    appProcess: bundle.appProcess,
    runState: bundle.runState,
    section: input.section,
    acceptedBy: input.acceptedBy,
    note: input.note,
    now: input.now,
  });
  persistRunState(bundle.repoRoot, result.runState, result.runState.events.slice(previousEventCount));
  return bundleFromState(bundle.repoRoot, bundle.appProcess, result.runState, result.event);
}

export function continueAppProcessRunFile(input: {
  repoRoot: string;
  now?: string;
}): AppProcessRunFileMutationResult {
  const bundle = loadAppProcessRunBundle({ repoRoot: input.repoRoot, now: input.now });
  const previousEventCount = persistedRunStateExists(bundle.repoRoot) ? bundle.runState.events.length : 0;
  const result = continueAppProcessRun({
    appProcess: bundle.appProcess,
    runState: bundle.runState,
    now: input.now,
  });
  persistRunState(bundle.repoRoot, result.runState, result.runState.events.slice(previousEventCount));
  return bundleFromState(bundle.repoRoot, bundle.appProcess, result.runState, result.event);
}

export function recordAppProcessVerificationFile(input: {
  repoRoot: string;
  command: string;
  args?: string[];
  status: "passed" | "failed" | "skipped";
  evidencePath?: string;
  summary?: string;
  now?: string;
}): AppProcessRunFileMutationResult {
  const bundle = loadAppProcessRunBundle({ repoRoot: input.repoRoot, now: input.now });
  const previousEventCount = persistedRunStateExists(bundle.repoRoot) ? bundle.runState.events.length : 0;
  const result = recordAppProcessVerification({
    appProcess: bundle.appProcess,
    runState: bundle.runState,
    command: input.command,
    args: input.args,
    status: input.status,
    evidencePath: input.evidencePath,
    summary: input.summary,
    now: input.now,
  });
  persistRunState(bundle.repoRoot, result.runState, result.runState.events.slice(previousEventCount));
  return bundleFromState(bundle.repoRoot, bundle.appProcess, result.runState, result.event);
}

function bundleFromState(
  repoRoot: string,
  appProcess: AppProcess,
  runState: AppProcessRunState,
  event?: AppProcessRunEvent,
): AppProcessRunFileMutationResult {
  const artifacts = collectArtifactFreshness(repoRoot, appProcess);
  return {
    repoRoot,
    appProcess,
    runState,
    artifacts,
    status: createAppProcessRunStatus({ appProcess, runState, artifacts }),
    ...(event ? { event } : {}),
  };
}

function readRunState(repoRoot: string): AppProcessRunState | undefined {
  const statePath = resolveRepoPath(repoRoot, ".wormhole/app-process/run-state.json");
  if (!existsSync(statePath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(statePath, "utf8")) as AppProcessRunState;
}

function persistedRunStateExists(repoRoot: string): boolean {
  return existsSync(resolveRepoPath(repoRoot, ".wormhole/app-process/run-state.json"));
}

function persistRunState(
  repoRoot: string,
  runState: AppProcessRunState,
  events: AppProcessRunEvent[],
): void {
  mkdirSync(resolveRepoPath(repoRoot, ".wormhole/app-process"), { recursive: true });
  writeFileSync(
    resolveRepoPath(repoRoot, ".wormhole/app-process/run-state.json"),
    `${JSON.stringify(runState, null, 2)}\n`,
  );
  if (events.length > 0) {
    appendFileSync(
      resolveRepoPath(repoRoot, ".wormhole/app-process/events.jsonl"),
      events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    );
  }
}

function collectArtifactFreshness(repoRoot: string, appProcess: AppProcess): AppProcessArtifactFreshness[] {
  const artifactPaths = [
    ".wormhole/app-context.md",
    ".wormhole/app-process.md",
    ".wormhole/app-process.json",
    ".wormhole/feature-index.json",
    ".wormhole/backlog.json",
    ".wormhole/product-definition.md",
    ".wormhole/roadmap.json",
    ...appProcess.roadmap.value.phases.map((phase) => `.wormhole/app-process/phases/phase-${phase.phase}.json`),
    ...appProcess.progressive.lanes.map((lane) => lane.artifactPath),
  ];
  return [...new Set(artifactPaths)].sort((left, right) => left.localeCompare(right)).map((relativePath) => {
    const absolutePath = resolveRepoPath(repoRoot, relativePath);
    if (!existsSync(absolutePath)) {
      return {
        relativePath,
        status: "missing",
        reason: "Expected app-process artifact is missing.",
      };
    }
    const stats = statSync(absolutePath);
    return {
      relativePath,
      status: "fresh",
      mtimeMs: stats.mtimeMs,
    };
  });
}

function evaluateObjectiveFreshness(
  appProcess: AppProcess,
  expectedObjective: string | undefined,
): AppProcessObjectiveFreshness | undefined {
  if (!expectedObjective) {
    return undefined;
  }
  const actualObjective = appProcess.objective;
  const fresh = normalizeObjective(expectedObjective) === normalizeObjective(actualObjective);
  return {
    status: fresh ? "fresh" : "stale",
    actualObjective,
    expectedObjective,
    ...(fresh ? {} : { reason: "App-process objective does not match requested objective." }),
  };
}

function evaluateFingerprintFreshness(
  repoRoot: string,
  appProcess: AppProcess,
  requestedObjective: string | undefined,
): AppProcessFingerprintFreshness {
  const objective = requestedObjective ?? appProcess.objective;
  const currentFeatureIndex = createFeatureIndex({ repoRoot });
  const currentBlueprint = compileBootstrapBlueprint({ repoRoot, objective });
  const featureIndex = compareFingerprint({
    expected: currentFeatureIndex.fingerprint,
    actual: appProcess.repoIntelligence.featureIndexFingerprint,
    reason: "App-process feature index fingerprint does not match the current repo feature index.",
  });
  const blueprint = compareFingerprint({
    expected: currentBlueprint.blueprint.fingerprint,
    actual: appProcess.blueprintRef.fingerprint,
    reason: "App-process blueprint fingerprint does not match the current repo blueprint.",
  });
  return {
    status: featureIndex.status === "fresh" && blueprint.status === "fresh" ? "fresh" : "stale",
    featureIndex,
    blueprint,
  };
}

function compareFingerprint(input: {
  expected: string;
  actual: string;
  reason: string;
}): AppProcessFingerprintComparison {
  const fresh = input.expected === input.actual;
  return {
    status: fresh ? "fresh" : "stale",
    expected: input.expected,
    actual: input.actual,
    ...(fresh ? {} : { reason: input.reason }),
  };
}

function applyAppProcessFreshness(
  artifacts: AppProcessArtifactFreshness[],
  objectiveFreshness: AppProcessObjectiveFreshness | undefined,
  fingerprintFreshness: AppProcessFingerprintFreshness,
): AppProcessArtifactFreshness[] {
  const staleReasons = [
    objectiveFreshness?.status === "stale" ? objectiveFreshness.reason : undefined,
    fingerprintFreshness.featureIndex.status === "stale" ? fingerprintFreshness.featureIndex.reason : undefined,
    fingerprintFreshness.blueprint.status === "stale" ? fingerprintFreshness.blueprint.reason : undefined,
  ].filter((reason): reason is string => Boolean(reason));
  if (staleReasons.length === 0) {
    return artifacts;
  }
  return artifacts.map((artifact) =>
    artifact.relativePath === ".wormhole/app-process.json"
      ? {
          relativePath: artifact.relativePath,
          status: "stale",
          reason: staleReasons.join(" "),
          mtimeMs: artifact.mtimeMs,
        }
      : artifact,
  );
}

function normalizeObjective(objective: string): string {
  return objective.trim().toLowerCase().replace(/\s+/g, " ");
}

function readJson<T>(repoRoot: string, relativePath: string): T {
  return JSON.parse(readFileSync(resolveRepoPath(repoRoot, relativePath), "utf8")) as T;
}

function resolveRepoPath(repoRoot: string, relativePath: string): string {
  const absoluteRoot = path.resolve(repoRoot);
  const absolutePath = path.resolve(absoluteRoot, relativePath);
  const relativeToRoot = path.relative(absoluteRoot, absolutePath);
  if (relativeToRoot === "" || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("App process run path must stay within repoRoot");
  }
  return absolutePath;
}
