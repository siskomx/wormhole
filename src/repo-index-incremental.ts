import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  REPO_INDEX_EXTRACTOR_VERSION,
  assembleRepoIndex,
  buildRepoIndex,
  createRepoIndexFingerprintFromEntries,
  extractRepoIndexFile,
  normalizeRepoIndexBuildOptions,
  type NormalizedRepoIndexBuildOptions,
  type RepoIndex,
  type RepoIndexBuildOptions,
  type RepoIndexFile,
} from "./repo-index.js";
import { createRepoFactGraphFromIndex, type RepoFactGraph } from "./repo-facts.js";

export type IncrementalRepoIndexFallbackReason =
  | "previous_index_missing"
  | "previous_index_stale"
  | "extractor_version_changed"
  | "build_options_changed"
  | "changed_file_outside_index_scope"
  | "file_read_failed"
  | "unsupported_prior_index_version";

export type IncrementalRepoIndexRefreshResult = {
  repoRoot: string;
  refreshMode: "incremental" | "full_rebuild";
  incremental: boolean;
  fallbackReason?: IncrementalRepoIndexFallbackReason;
  previousFingerprint?: string;
  fingerprint: string;
  extractorVersion: string;
  changedFiles: string[];
  removedFiles: string[];
  reindexedFiles: string[];
  reusedFileCount: number;
  index: RepoIndex;
  factGraph: RepoFactGraph;
  warnings: string[];
};

export function refreshRepoIndexIncremental(input: {
  repoRoot: string;
  changedFiles: string[];
  previousIndex?: RepoIndex;
  buildOptions?: Omit<RepoIndexBuildOptions, "repoRoot">;
}): IncrementalRepoIndexRefreshResult {
  const repoRoot = path.resolve(input.repoRoot);
  const changedFiles = normalizeChangedFiles(repoRoot, input.changedFiles);
  const previousIndex = input.previousIndex ?? readPreviousRepoIndex(repoRoot);

  if (changedFiles.outsideScope) {
    return fullRebuildResult({
      repoRoot,
      changedFiles: changedFiles.paths,
      buildOptions: normalizeRepoIndexBuildOptions({ repoRoot, ...(input.buildOptions ?? {}) }),
      fallbackReason: "changed_file_outside_index_scope",
      previousIndex,
    });
  }

  if (!previousIndex) {
    return fullRebuildResult({
      repoRoot,
      changedFiles: changedFiles.paths,
      buildOptions: normalizeRepoIndexBuildOptions({ repoRoot, ...(input.buildOptions ?? {}) }),
      fallbackReason: "previous_index_missing",
    });
  }

  const priorSupport = validatePriorIndexSupport(previousIndex);
  if (priorSupport) {
    return fullRebuildResult({
      repoRoot,
      changedFiles: changedFiles.paths,
      buildOptions: normalizeRepoIndexBuildOptions({ repoRoot, ...(input.buildOptions ?? previousIndex.buildOptions) }),
      fallbackReason: priorSupport,
      previousIndex,
    });
  }

  if (path.resolve(previousIndex.repoRoot) !== repoRoot) {
    return fullRebuildResult({
      repoRoot,
      changedFiles: changedFiles.paths,
      buildOptions: normalizeRepoIndexBuildOptions({ repoRoot, ...(input.buildOptions ?? previousIndex.buildOptions) }),
      fallbackReason: "previous_index_stale",
      previousIndex,
    });
  }

  if (previousIndex.extractorVersion !== REPO_INDEX_EXTRACTOR_VERSION) {
    return fullRebuildResult({
      repoRoot,
      changedFiles: changedFiles.paths,
      buildOptions: normalizeRepoIndexBuildOptions({ repoRoot, ...(input.buildOptions ?? previousIndex.buildOptions) }),
      fallbackReason: "extractor_version_changed",
      previousIndex,
    });
  }

  const buildOptions = normalizeRepoIndexBuildOptions({
    repoRoot,
    ...(input.buildOptions ?? previousIndex.buildOptions),
  });

  if (!sameBuildOptions(buildOptions, previousIndex.buildOptions)) {
    return fullRebuildResult({
      repoRoot,
      changedFiles: changedFiles.paths,
      buildOptions,
      fallbackReason: "build_options_changed",
      previousIndex,
    });
  }

  if (!isPriorFingerprintSelfConsistent(previousIndex)) {
    return fullRebuildResult({
      repoRoot,
      changedFiles: changedFiles.paths,
      buildOptions,
      fallbackReason: "previous_index_stale",
      previousIndex,
    });
  }

  const previousFiles = new Map(previousIndex.files.map((file) => [normalizeRepoPath(file.path), file]));
  const changedSet = new Set(changedFiles.paths);
  const reindexedFiles = new Map<string, { file: RepoIndexFile; statSize: number }>();
  const removedFiles: string[] = [];

  for (const changedFile of changedFiles.paths) {
    if (!previousFiles.has(changedFile)) {
      return fullRebuildResult({
        repoRoot,
        changedFiles: changedFiles.paths,
        buildOptions,
        fallbackReason: "changed_file_outside_index_scope",
        previousIndex,
      });
    }

    const status = inspectChangedFile(repoRoot, changedFile, buildOptions);
    if (status.kind === "removed") {
      removedFiles.push(changedFile);
      continue;
    }
    if (status.kind === "outside_scope" || status.kind === "read_failed") {
      return fullRebuildResult({
        repoRoot,
        changedFiles: changedFiles.paths,
        buildOptions,
        fallbackReason:
          status.kind === "outside_scope"
            ? "changed_file_outside_index_scope"
            : "file_read_failed",
        previousIndex,
      });
    }
    reindexedFiles.set(changedFile, { file: status.file, statSize: status.statSize });
  }

  const mergedFiles = previousIndex.files
    .filter((file) => !changedSet.has(normalizeRepoPath(file.path)))
    .concat([...reindexedFiles.values()].map((entry) => entry.file))
    .sort((left, right) => left.path.localeCompare(right.path));

  if (mergedFiles.length > buildOptions.maxFiles || totalByteLength(mergedFiles) > buildOptions.maxTotalBytes) {
    return fullRebuildResult({
      repoRoot,
      changedFiles: changedFiles.paths,
      buildOptions,
      fallbackReason: "changed_file_outside_index_scope",
      previousIndex,
    });
  }

  const fingerprintEntries = createIncrementalFingerprintEntries({
    previousIndex,
    mergedFiles,
    reindexedFiles,
  });
  const index = assembleRepoIndex({
    repoRoot,
    buildOptions,
    files: mergedFiles,
    skippedFiles: previousIndex.skippedFiles,
    skipReasons: previousIndex.skipReasons,
    fingerprintEntries,
  });
  const factGraph = createRepoFactGraphFromIndex({ index });
  const reindexed = [...reindexedFiles.keys()].sort((left, right) => left.localeCompare(right));
  const removed = removedFiles.sort((left, right) => left.localeCompare(right));

  return {
    repoRoot,
    refreshMode: "incremental",
    incremental: true,
    previousFingerprint: previousIndex.fingerprint,
    fingerprint: index.fingerprint,
    extractorVersion: index.extractorVersion ?? REPO_INDEX_EXTRACTOR_VERSION,
    changedFiles: changedFiles.paths,
    removedFiles: removed,
    reindexedFiles: reindexed,
    reusedFileCount: mergedFiles.length - reindexed.length,
    index,
    factGraph,
    warnings: [],
  };
}

type NormalizedChangedFiles = {
  paths: string[];
  outsideScope: boolean;
};

type ChangedFileStatus =
  | { kind: "removed" }
  | { kind: "outside_scope" }
  | { kind: "read_failed" }
  | { kind: "file"; file: RepoIndexFile; statSize: number };

function fullRebuildResult(input: {
  repoRoot: string;
  changedFiles: string[];
  buildOptions: NormalizedRepoIndexBuildOptions;
  fallbackReason: IncrementalRepoIndexFallbackReason;
  previousIndex?: RepoIndex;
}): IncrementalRepoIndexRefreshResult {
  const index = buildRepoIndex({ repoRoot: input.repoRoot, ...input.buildOptions });
  const factGraph = createRepoFactGraphFromIndex({ index });
  return {
    repoRoot: input.repoRoot,
    refreshMode: "full_rebuild",
    incremental: false,
    fallbackReason: input.fallbackReason,
    ...(input.previousIndex ? { previousFingerprint: input.previousIndex.fingerprint } : {}),
    fingerprint: index.fingerprint,
    extractorVersion: index.extractorVersion ?? REPO_INDEX_EXTRACTOR_VERSION,
    changedFiles: input.changedFiles,
    removedFiles: [],
    reindexedFiles: index.files.map((file) => file.path),
    reusedFileCount: 0,
    index,
    factGraph,
    warnings: [`Incremental repo index refresh fell back to a full rebuild: ${input.fallbackReason}.`],
  };
}

function validatePriorIndexSupport(
  index: RepoIndex,
): Extract<IncrementalRepoIndexFallbackReason, "unsupported_prior_index_version"> | undefined {
  if (!index.buildOptions || !Array.isArray(index.files) || !Array.isArray(index.symbols) || !Array.isArray(index.edges)) {
    return "unsupported_prior_index_version";
  }
  if (!index.fingerprintEntries || index.fingerprintEntries.length === 0) {
    return "unsupported_prior_index_version";
  }
  return undefined;
}

function isPriorFingerprintSelfConsistent(index: RepoIndex): boolean {
  const entries = index.fingerprintEntries;
  if (!entries || createRepoIndexFingerprintFromEntries(entries) !== index.fingerprint) {
    return false;
  }

  const indexedEntries = new Map<string, string>();
  for (const entry of entries) {
    const parsed = parseIndexedFingerprintEntry(entry);
    if (parsed) {
      indexedEntries.set(parsed.path, entry);
    }
  }

  return index.files.every((file) => {
    const entry = indexedEntries.get(normalizeRepoPath(file.path));
    return Boolean(entry && entry.endsWith(`:${file.hash}`));
  });
}

function createIncrementalFingerprintEntries(input: {
  previousIndex: RepoIndex;
  mergedFiles: RepoIndexFile[];
  reindexedFiles: Map<string, { file: RepoIndexFile; statSize: number }>;
}): string[] {
  const previousEntries = input.previousIndex.fingerprintEntries ?? [];
  const previousIndexed = new Map<string, string>();
  for (const entry of previousEntries) {
    const parsed = parseIndexedFingerprintEntry(entry);
    if (parsed) {
      previousIndexed.set(parsed.path, entry);
    }
  }

  return [
    ...previousEntries.filter((entry) => !parseIndexedFingerprintEntry(entry)),
    ...input.mergedFiles.map((file) => {
      const normalizedPath = normalizeRepoPath(file.path);
      const reindexed = input.reindexedFiles.get(normalizedPath);
      if (reindexed) {
        return `indexed:${normalizedPath}:${reindexed.statSize}:${reindexed.file.hash}`;
      }
      return previousIndexed.get(normalizedPath) ?? `indexed:${normalizedPath}:${file.byteLength}:${file.hash}`;
    }),
  ];
}

function inspectChangedFile(
  repoRoot: string,
  relativePath: string,
  buildOptions: NormalizedRepoIndexBuildOptions,
): ChangedFileStatus {
  const absolutePath = path.join(repoRoot, relativePath);
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch (error) {
    return isMissingFileError(error) ? { kind: "removed" } : { kind: "read_failed" };
  }

  if (!stat.isFile() || stat.size > buildOptions.maxFileBytes) {
    return { kind: "outside_scope" };
  }

  try {
    const file = extractRepoIndexFile({ repoRoot, relativePath });
    if (!file) {
      return { kind: "outside_scope" };
    }
    return { kind: "file", file, statSize: stat.size };
  } catch {
    return { kind: "read_failed" };
  }
}

function normalizeChangedFiles(repoRoot: string, changedFiles: readonly string[]): NormalizedChangedFiles {
  const paths = new Set<string>();
  let outsideScope = false;

  for (const changedFile of changedFiles) {
    const trimmed = changedFile.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const absolutePath = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(repoRoot, trimmed);
    const relativePath = path.relative(repoRoot, absolutePath);
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      outsideScope = true;
      continue;
    }
    const normalized = normalizeRepoPath(relativePath);
    if (normalized === "." || normalized.startsWith("../")) {
      outsideScope = true;
      continue;
    }
    paths.add(normalized);
  }

  return {
    paths: [...paths].sort((left, right) => left.localeCompare(right)),
    outsideScope,
  };
}

function sameBuildOptions(
  left: NormalizedRepoIndexBuildOptions,
  right: NormalizedRepoIndexBuildOptions,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readPreviousRepoIndex(repoRoot: string): RepoIndex | undefined {
  const indexPath = path.join(repoRoot, ".wormhole", "indexes", "repo-index.json");
  if (!existsSync(indexPath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(indexPath, "utf8")) as RepoIndex;
  } catch {
    return undefined;
  }
}

function parseIndexedFingerprintEntry(entry: string): { path: string } | undefined {
  const match = /^indexed:(.*):\d+:[a-f0-9]{64}$/i.exec(entry);
  if (!match) {
    return undefined;
  }
  return { path: normalizeRepoPath(match[1] ?? "") };
}

function totalByteLength(files: readonly RepoIndexFile[]): number {
  return files.reduce((total, file) => total + file.byteLength, 0);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function normalizeRepoPath(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, "/").replace(/^\.\//, ""));
}
