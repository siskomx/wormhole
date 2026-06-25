import {
  analyzeBlastRadius,
  generateProjectContextPack,
  type BlastRadiusAnalysis,
  type ProjectContextPack,
} from "./project-intelligence.js";
import type { DiagnosticRecord, DiagnosticSeverity } from "./diagnostics.js";
import type { SourceType } from "./kernel.js";

export type MissionDeltaEvidenceRecord = {
  evidenceId: string;
  sourceType: SourceType;
  sourcePath?: string;
  summary: string;
  recordedAt?: string;
};

export type StaleEvidenceWarning = MissionDeltaEvidenceRecord & {
  reason: string;
};

export type MissionDeltaReplanInput = {
  repoRoot: string;
  missionId?: string;
  objective: string;
  changedFiles: string[];
  diffText?: string;
  diagnostics?: DiagnosticRecord[];
  evidenceRecords?: MissionDeltaEvidenceRecord[];
  maxContextChars?: number;
};

export type MissionDeltaReplanReport = {
  missionId?: string;
  repoRoot: string;
  objective: string;
  status: "current" | "needs_replan";
  changedFiles: string[];
  generatedAt: string;
  blastRadius: BlastRadiusAnalysis;
  focusedVerification: {
    riskLevel: BlastRadiusAnalysis["verification"]["riskLevel"];
    likelyTests: BlastRadiusAnalysis["verification"]["likelyTests"];
    commands: string[];
    reasons: string[];
  };
  diagnosticsSummary: Record<`${DiagnosticSeverity}Count`, number> & {
    totalCount: number;
    files: string[];
  };
  staleEvidence: StaleEvidenceWarning[];
  contextPack: ProjectContextPack;
  gateRecommendation: {
    open: boolean;
    reasons: string[];
  };
  planRevision: {
    requiredSteps: string[];
    recommendedApproach: string;
  };
};

export function createMissionDeltaReplan(input: MissionDeltaReplanInput): MissionDeltaReplanReport {
  const changedFiles = uniqueSorted(input.changedFiles.map(normalizeRepoPath));
  const diagnostics = [...(input.diagnostics ?? [])].sort(compareDiagnostic);
  const blastRadius = analyzeBlastRadius({
    repoRoot: input.repoRoot,
    changedFiles,
    diffText: input.diffText,
  });
  const contextPack = generateProjectContextPack({
    repoRoot: input.repoRoot,
    objective: input.objective,
    query: contextQueryFor(input.objective, changedFiles, diagnostics),
    changedFiles,
    maxChars: input.maxContextChars ?? 6_000,
  });
  const staleEvidence = findStaleEvidence(input.evidenceRecords ?? [], changedFiles, blastRadius);
  const diagnosticsSummary = summarizeDiagnostics(diagnostics);
  const gateReasons = createGateReasons({
    changedFiles,
    diagnosticsSummary,
    staleEvidence,
  });
  const planRevision = createPlanRevision({
    changedFiles,
    blastRadius,
    diagnosticsSummary,
    staleEvidence,
  });
  return {
    missionId: input.missionId,
    repoRoot: input.repoRoot,
    objective: input.objective,
    status: gateReasons.length > 0 ? "needs_replan" : "current",
    changedFiles,
    generatedAt: new Date().toISOString(),
    blastRadius,
    focusedVerification: {
      riskLevel: blastRadius.verification.riskLevel,
      likelyTests: blastRadius.verification.likelyTests,
      commands: verificationCommands(blastRadius),
      reasons: blastRadius.verification.reasons,
    },
    diagnosticsSummary,
    staleEvidence,
    contextPack,
    gateRecommendation: {
      open: gateReasons.length === 0,
      reasons: gateReasons.length > 0 ? gateReasons : ["No mission delta blockers detected."],
    },
    planRevision,
  };
}

function contextQueryFor(
  objective: string,
  changedFiles: string[],
  diagnostics: DiagnosticRecord[],
): string {
  return uniqueSorted([
    objective,
    ...changedFiles,
    ...diagnostics.map((diagnostic) => diagnostic.file ?? ""),
    ...diagnostics.map((diagnostic) => diagnostic.message),
  ]).join(" ");
}

function findStaleEvidence(
  records: MissionDeltaEvidenceRecord[],
  changedFiles: string[],
  blastRadius: BlastRadiusAnalysis,
): StaleEvidenceWarning[] {
  const changedSet = new Set(changedFiles);
  const impactedSet = new Set(blastRadius.impactedFiles.map((file) => file.path));
  return records
    .filter((record) => record.sourceType === "file" && record.sourcePath)
    .map((record): StaleEvidenceWarning | undefined => {
      const sourcePath = normalizeRepoPath(record.sourcePath ?? "");
      if (changedSet.has(sourcePath)) {
        return {
          ...record,
          sourcePath,
          reason: "Evidence source changed in the latest delta.",
        };
      }
      if (impactedSet.has(sourcePath)) {
        return {
          ...record,
          sourcePath,
          reason: "Evidence source is in the impacted blast radius.",
        };
      }
      return undefined;
    })
    .filter((record): record is StaleEvidenceWarning => Boolean(record))
    .sort((left, right) => left.sourcePath?.localeCompare(right.sourcePath ?? "") ?? 0);
}

function summarizeDiagnostics(
  diagnostics: DiagnosticRecord[],
): MissionDeltaReplanReport["diagnosticsSummary"] {
  const counts = {
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    hintCount: 0,
    totalCount: diagnostics.length,
    files: uniqueSorted(diagnostics.map((diagnostic) => diagnostic.file ?? "").filter(Boolean)),
  };
  for (const diagnostic of diagnostics) {
    counts[`${diagnostic.severity}Count`] += 1;
  }
  return counts;
}

function createGateReasons(input: {
  changedFiles: string[];
  diagnosticsSummary: MissionDeltaReplanReport["diagnosticsSummary"];
  staleEvidence: StaleEvidenceWarning[];
}): string[] {
  const reasons: string[] = [];
  if (input.changedFiles.length > 0) {
    reasons.push("Changed files require fresh evidence before reusing the prior plan.");
  }
  if (input.staleEvidence.length > 0) {
    reasons.push("Existing evidence references changed or impacted files.");
  }
  if (input.diagnosticsSummary.errorCount > 0) {
    reasons.push("Diagnostics contain errors that require plan revision.");
  }
  return reasons;
}

function createPlanRevision(input: {
  changedFiles: string[];
  blastRadius: BlastRadiusAnalysis;
  diagnosticsSummary: MissionDeltaReplanReport["diagnosticsSummary"];
  staleEvidence: StaleEvidenceWarning[];
}): MissionDeltaReplanReport["planRevision"] {
  const requiredSteps: string[] = [];
  if (input.changedFiles.length > 0) {
    requiredSteps.push(`Record fresh evidence for changed files: ${input.changedFiles.join(", ")}.`);
  }
  if (input.blastRadius.impactedEntrypoints.length > 0) {
    requiredSteps.push(
      `Review impacted entrypoints: ${input.blastRadius.impactedEntrypoints
        .map((entrypoint) => entrypoint.path)
        .join(", ")}.`,
    );
  }
  if (input.blastRadius.verification.likelyTests.length > 0) {
    requiredSteps.push(
      `Run focused tests: ${input.blastRadius.verification.likelyTests
        .map((test) => test.path)
        .join(", ")}.`,
    );
  }
  if (input.diagnosticsSummary.errorCount > 0) {
    requiredSteps.push("Address or explicitly triage current error diagnostics before emitting a revised plan.");
  }
  if (input.staleEvidence.length > 0) {
    requiredSteps.push(
      `Replace stale evidence records: ${input.staleEvidence
        .map((evidence) => evidence.evidenceId)
        .join(", ")}.`,
    );
  }
  if (requiredSteps.length === 0) {
    requiredSteps.push("No plan revision required by the current mission delta.");
  }
  return {
    requiredSteps,
    recommendedApproach:
      requiredSteps.length === 1 && requiredSteps[0] === "No plan revision required by the current mission delta."
        ? "Continue with the current plan."
        : "Pause plan emission, refresh evidence for changed or impacted files, resolve diagnostics, then emit a revised plan.",
  };
}

function verificationCommands(blastRadius: BlastRadiusAnalysis): string[] {
  if (blastRadius.verification.likelyTests.length === 0) {
    return ["Run the project verification command selected by test_plan_select."];
  }
  return blastRadius.verification.likelyTests.map((test) => `Run focused verification for ${test.path}.`);
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function compareDiagnostic(left: DiagnosticRecord, right: DiagnosticRecord): number {
  const fileCompare = (left.file ?? "").localeCompare(right.file ?? "");
  if (fileCompare !== 0) {
    return fileCompare;
  }
  return (left.line ?? 0) - (right.line ?? 0);
}
