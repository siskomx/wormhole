export type IndexHealthStatus = "fresh" | "degraded" | "stale" | "missing" | "unknown";

export type IndexHealthRecommendedAction =
  | "use_as_is"
  | "refresh_index"
  | "build_index"
  | "inspect_index_limits";

export type IndexHealthSource =
  | "repo_index"
  | "durable_repo_index"
  | "durable_sqlite_index"
  | "durable_index_manifest"
  | "project_model";

export type IndexHealthSnapshot = {
  schemaVersion: 1;
  source: IndexHealthSource;
  status: IndexHealthStatus;
  fresh?: boolean;
  truncated: boolean;
  builtAt?: string;
  fingerprint?: string;
  indexPath?: string;
  fileCount?: number;
  skippedFileCount: number;
  skippedFiles: string[];
  reasons: string[];
  recommendedAction: IndexHealthRecommendedAction;
};

export type IndexHealthInput = {
  source: IndexHealthSource;
  present?: boolean;
  fresh?: boolean;
  truncated?: boolean;
  builtAt?: string;
  fingerprint?: string;
  indexPath?: string;
  fileCount?: number;
  skippedFiles?: string[];
  reasons?: string[];
};

const MAX_SKIPPED_FILE_SAMPLE = 20;

export function createIndexHealthSnapshot(input: IndexHealthInput): IndexHealthSnapshot {
  const present = input.present ?? true;
  const truncated = input.truncated ?? false;
  const skippedFiles = [...(input.skippedFiles ?? [])].sort((left, right) => left.localeCompare(right));
  const status = statusFor({
    present,
    fresh: input.fresh,
    truncated,
  });
  const reasons = uniqueSorted([
    ...reasonForStatus(status),
    ...(truncated ? ["Index is truncated; some repository files were not indexed."] : []),
    ...criticalSkippedArtifactReasons(skippedFiles),
    ...(input.reasons ?? []),
  ]);

  return {
    schemaVersion: 1,
    source: input.source,
    status,
    ...(input.fresh === undefined ? {} : { fresh: input.fresh }),
    truncated,
    ...(input.builtAt ? { builtAt: input.builtAt } : {}),
    ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
    ...(input.indexPath ? { indexPath: input.indexPath } : {}),
    ...(input.fileCount === undefined ? {} : { fileCount: input.fileCount }),
    skippedFileCount: skippedFiles.length,
    skippedFiles: skippedFiles.slice(0, MAX_SKIPPED_FILE_SAMPLE),
    reasons,
    recommendedAction: recommendedActionFor(status),
  };
}

function statusFor(input: {
  present: boolean;
  fresh?: boolean;
  truncated: boolean;
}): IndexHealthStatus {
  if (!input.present) {
    return "missing";
  }
  if (input.fresh === false) {
    return "stale";
  }
  if (input.truncated) {
    return "degraded";
  }
  if (input.fresh === true) {
    return "fresh";
  }
  return "unknown";
}

function recommendedActionFor(status: IndexHealthStatus): IndexHealthRecommendedAction {
  switch (status) {
    case "fresh":
      return "use_as_is";
    case "degraded":
      return "inspect_index_limits";
    case "missing":
      return "build_index";
    case "stale":
    case "unknown":
      return "refresh_index";
  }
}

function reasonForStatus(status: IndexHealthStatus): string[] {
  switch (status) {
    case "missing":
      return ["Index is missing."];
    case "stale":
      return ["Index is stale; refresh before relying on generated repo guidance."];
    case "unknown":
      return ["Index freshness is unknown."];
    case "degraded":
    case "fresh":
      return [];
  }
}

function criticalSkippedArtifactReasons(skippedFiles: string[]): string[] {
  const critical = skippedFiles.filter(isGeneratedApiContractPath).sort((left, right) => left.localeCompare(right));
  if (critical.length === 0) {
    return [];
  }
  const sample = critical.slice(0, 8);
  const suffix = critical.length > sample.length ? `, and ${critical.length - sample.length} more` : "";
  return [`Skipped generated/API contract artifacts: ${sample.join(", ")}${suffix}.`];
}

function isGeneratedApiContractPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized === "public/api-docs/openapi.json" ||
    normalized === "public/api-docs/openapi-agents.json" ||
    normalized === "src/generated/openapi.ts" ||
    /(^|\/)openapi[^/]*\.json$/i.test(normalized)
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
