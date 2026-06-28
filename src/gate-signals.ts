import type { SourceConflict } from "./source-authority.js";

export type GateSourceConflictsInput = SourceConflict[] | { conflicts: SourceConflict[] };

export type GateArtifactFreshness = {
  relativePath: string;
  status: "fresh" | "missing" | "stale";
  reason?: string;
  mtimeMs?: number;
};

export type GateFreshnessInput = {
  durableIndex?: {
    repoIndex?: {
      fresh: boolean;
    };
  };
  durableIndexManifest?: {
    manifest?: {
      fresh: boolean;
    };
  };
  artifacts?: GateArtifactFreshness[];
};

export type GateSignalInput = {
  sourceConflicts?: GateSourceConflictsInput;
  freshness?: GateFreshnessInput;
  artifactFreshness?: GateArtifactFreshness[];
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

  if (input.freshness?.durableIndex?.repoIndex?.fresh === false) {
    findings.push({
      ruleId: "freshness:durable-index-stale",
      severity: enforce ? "block" : "warn",
      message: "Refresh the durable repo index before relying on generated repo guidance.",
    });
  }

  if (input.freshness?.durableIndexManifest?.manifest?.fresh === false) {
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
