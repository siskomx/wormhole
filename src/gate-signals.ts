import type { SourceConflict } from "./source-authority.js";
import type { IndexHealthSnapshot } from "./index-health.js";

export type GateSourceConflictsInput = SourceConflict[] | { conflicts: SourceConflict[] };

export type GateArtifactFreshness = {
  relativePath: string;
  status: "fresh" | "missing" | "stale";
  reason?: string;
  mtimeMs?: number;
};

export type GateFreshnessInput = {
  indexHealth?: IndexHealthSnapshot;
  durableIndex?: {
    repoIndex?: {
      fresh: boolean;
      indexHealth?: IndexHealthSnapshot;
    };
    sqliteIndex?: {
      fresh: boolean;
      indexHealth?: IndexHealthSnapshot;
    };
  };
  durableIndexManifest?: {
    manifest?: {
      fresh: boolean;
      indexHealth?: IndexHealthSnapshot;
    };
  };
  artifacts?: GateArtifactFreshness[];
};

export type GateRuntimeBehaviorInput = {
  summary?: {
    status?: "ok" | "warning" | "blocker" | string;
    missingToolCount?: number;
    failedToolCount?: number;
    skippedToolCount?: number;
    uncoveredRequiredToolCount?: number;
    orderingViolationCount?: number;
  };
  status?: "ok" | "warning" | "blocker" | string;
  blockingReasons?: string[];
};

export type GateLoopHealthInput = {
  status?: "ok" | "warning" | "blocked" | string;
  blockers?: Array<{
    code?: string;
    message?: string;
  }>;
  stopConditions?: Array<{
    code?: string;
    status?: string;
    message?: string;
  }>;
};

export type GateSignalInput = {
  sourceConflicts?: GateSourceConflictsInput;
  freshness?: GateFreshnessInput;
  artifactFreshness?: GateArtifactFreshness[];
  runtimeBehavior?: GateRuntimeBehaviorInput;
  loopHealth?: GateLoopHealthInput;
  enforce?: boolean;
};

export type GateSignalFinding = {
  ruleId: string;
  severity: "warn" | "block";
  message: string;
};

export function evaluateGateSignals(input: GateSignalInput): GateSignalFinding[] {
  const findings: GateSignalFinding[] = [];
  const enforce = input.enforce ?? false;

  for (const conflict of sourceConflicts(input.sourceConflicts)) {
    if (isStaleGeneratedArtifactConflict(conflict)) {
      findings.push({
        ruleId: "source-conflict:stale-generated-artifact",
        severity: enforce ? "block" : "warn",
        message: `Resolve stale generated artifact conflict for ${conflict.subject}: ${conflict.message}`,
      });
      continue;
    }
    if (conflict.severity === "blocking") {
      findings.push({
        ruleId: "source-conflict:blocking",
        severity: "block",
        message: `Resolve blocking source conflict for ${conflict.subject}: ${conflict.message}`,
      });
      continue;
    }
    findings.push({
      ruleId: "source-conflict:needs-review",
      severity: "warn",
      message: `Review source conflict for ${conflict.subject}: ${conflict.message}`,
    });
  }

  for (const health of indexHealthInputs(input.freshness)) {
    const finding = gateFindingForIndexHealth(health, enforce);
    if (finding) {
      findings.push(finding);
    }
  }

  const runtimeFinding = gateFindingForRuntimeBehavior(input.runtimeBehavior);
  if (runtimeFinding) {
    findings.push(runtimeFinding);
  }

  const loopFinding = gateFindingForLoopHealth(input.loopHealth);
  if (loopFinding) {
    findings.push(loopFinding);
  }

  if (
    !input.freshness?.durableIndex?.repoIndex?.indexHealth &&
    input.freshness?.durableIndex?.repoIndex?.fresh === false
  ) {
    findings.push({
      ruleId: "freshness:durable-index-stale",
      severity: enforce ? "block" : "warn",
      message: "Refresh the durable repo index before relying on generated repo guidance.",
    });
  }

  if (
    !input.freshness?.durableIndexManifest?.manifest?.indexHealth &&
    input.freshness?.durableIndexManifest?.manifest?.fresh === false
  ) {
    findings.push({
      ruleId: "freshness:durable-index-manifest-stale",
      severity: enforce ? "block" : "warn",
      message: "Refresh the durable index manifest before relying on generated repo guidance.",
    });
  }

  for (const artifact of [...(input.freshness?.artifacts ?? []), ...(input.artifactFreshness ?? [])]) {
    if (artifact.status === "fresh") {
      continue;
    }
    findings.push({
      ruleId: `artifact-freshness:${artifact.status}`,
      severity: enforce ? "block" : "warn",
      message: `${artifact.relativePath} is ${artifact.status}${artifact.reason ? `: ${artifact.reason}` : "."}`,
    });
  }

  return uniqueFindings(findings);
}

function gateFindingForRuntimeBehavior(runtimeBehavior: GateRuntimeBehaviorInput | undefined): GateSignalFinding | undefined {
  if (!runtimeBehavior) {
    return undefined;
  }
  const status = runtimeBehavior.summary?.status ?? runtimeBehavior.status;
  if (status === "blocker" || status === "blocked") {
    const reason = runtimeBehavior.blockingReasons?.[0];
    return {
      ruleId: "runtime-behavior:blocker",
      severity: "block",
      message: reason ? `Runtime behavior audit is blocking: ${reason}` : "Runtime behavior audit is blocking.",
    };
  }
  if (status === "warning") {
    return {
      ruleId: "runtime-behavior:warning",
      severity: "warn",
      message: "Runtime behavior audit has warnings.",
    };
  }
  return undefined;
}

function gateFindingForLoopHealth(loopHealth: GateLoopHealthInput | undefined): GateSignalFinding | undefined {
  if (!loopHealth) {
    return undefined;
  }
  if (loopHealth.status === "blocked") {
    const blocker = loopHealth.blockers?.[0] ?? loopHealth.stopConditions?.find((condition) => condition.status === "blocked");
    const suffix = blocker?.message ? `: ${blocker.message}` : blocker?.code ? `: ${blocker.code}` : ".";
    return {
      ruleId: "agent-loop-health:blocked",
      severity: "block",
      message: `Agent loop health is blocked${suffix}`,
    };
  }
  if (loopHealth.status === "warning") {
    return {
      ruleId: "agent-loop-health:warning",
      severity: "warn",
      message: "Agent loop health has warnings.",
    };
  }
  return undefined;
}

function indexHealthInputs(freshness: GateFreshnessInput | undefined): IndexHealthSnapshot[] {
  return [
    freshness?.indexHealth,
    freshness?.durableIndex?.repoIndex?.indexHealth,
    freshness?.durableIndex?.sqliteIndex?.indexHealth,
    freshness?.durableIndexManifest?.manifest?.indexHealth,
  ].filter((health): health is IndexHealthSnapshot => Boolean(health));
}

function gateFindingForIndexHealth(
  health: IndexHealthSnapshot,
  enforce: boolean,
): GateSignalFinding | undefined {
  const blockingCoverageReasons = (health.languageCoverage ?? [])
    .filter((coverage) => coverage.status === "blocker")
    .flatMap((coverage) => coverage.reasons);
  if (blockingCoverageReasons.length > 0) {
    return {
      ruleId: "index-health:language-coverage",
      severity: enforce ? "block" : "warn",
      message: blockingCoverageReasons.join(" "),
    };
  }
  if (health.status === "fresh") {
    return undefined;
  }
  if (health.status === "degraded") {
    return {
      ruleId: "index-health:degraded",
      severity: "warn",
      message: indexHealthMessage(health),
    };
  }
  if (health.status === "stale" || health.status === "missing") {
    return {
      ruleId: `index-health:${health.status}`,
      severity: enforce ? "block" : "warn",
      message: indexHealthMessage(health),
    };
  }
  return {
    ruleId: "index-health:unknown",
    severity: "warn",
    message: indexHealthMessage(health),
  };
}

function indexHealthMessage(health: IndexHealthSnapshot): string {
  return `Index health is ${health.status} for ${health.source}; recommended action: ${health.recommendedAction}.`;
}

export function blockingGateSignalMessages(input: GateSignalInput): string[] {
  return evaluateGateSignals({ ...input, enforce: true })
    .filter((finding) => finding.severity === "block")
    .map((finding) => finding.message);
}

function sourceConflicts(input: GateSourceConflictsInput | undefined): SourceConflict[] {
  if (!input) {
    return [];
  }
  return Array.isArray(input) ? input : input.conflicts;
}

function isStaleGeneratedArtifactConflict(conflict: SourceConflict): boolean {
  return conflict.conflicting.some(
    (source) =>
      source.freshness === "stale" &&
      (source.sourcePath.startsWith(".wormhole/") || conflict.subject.startsWith(".wormhole/")),
  );
}

function uniqueFindings(findings: GateSignalFinding[]): GateSignalFinding[] {
  const byKey = new Map<string, GateSignalFinding>();
  for (const finding of findings) {
    byKey.set(`${finding.ruleId}\0${finding.message}`, finding);
  }
  return [...byKey.values()];
}
