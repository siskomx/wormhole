import { readdirSync } from "node:fs";
import path from "node:path";

export type RepoWalkSkipReason =
  | "depth_limit"
  | "directory_limit"
  | "file_limit"
  | "time_limit"
  | "unreadable";

export type RepoWalkFile = {
  absolutePath: string;
  relativePath: string;
  depth: number;
};

export type RepoWalkSkipped = {
  path: string;
  reason: RepoWalkSkipReason;
};

export type RepoWalkOptions = {
  excludedDirectories?: Set<string>;
  maxDepth?: number;
  maxDirs?: number;
  maxFiles?: number;
  maxElapsedMs?: number;
  shouldIncludeFile?: (relativePath: string) => boolean;
  shouldSkipDirectory?: (relativePath: string, name: string) => boolean;
};

export type RepoWalkResult = {
  files: RepoWalkFile[];
  skipped: RepoWalkSkipped[];
  hitLimit: boolean;
  reasons: RepoWalkSkipReason[];
};

const DEFAULT_MAX_DIRS = 50_000;

export function walkRepoFiles(repoRootInput: string, options: RepoWalkOptions = {}): RepoWalkResult {
  const repoRoot = path.resolve(repoRootInput);
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const maxDirs = options.maxDirs ?? DEFAULT_MAX_DIRS;
  const maxFiles = options.maxFiles ?? Number.POSITIVE_INFINITY;
  const startedAt = Date.now();
  const files: RepoWalkFile[] = [];
  const skipped: RepoWalkSkipped[] = [];
  let visitedDirs = 0;
  let hitLimit = false;
  const queue: Array<{ absolutePath: string; relativePath: string; depth: number }> = [
    { absolutePath: repoRoot, relativePath: "", depth: 0 },
  ];

  function elapsedLimitHit(): boolean {
    return options.maxElapsedMs !== undefined && Date.now() - startedAt >= options.maxElapsedMs;
  }

  function recordSkip(relativePath: string, reason: RepoWalkSkipReason): void {
    hitLimit = true;
    skipped.push({ path: relativePath || ".", reason });
  }

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    if (elapsedLimitHit()) {
      recordSkip(queue[queueIndex]?.relativePath ?? ".", "time_limit");
      break;
    }
    const current = queue[queueIndex];
    if (!current) {
      break;
    }
    visitedDirs += 1;
    if (visitedDirs > maxDirs) {
      recordSkip(current.relativePath || ".", "directory_limit");
      break;
    }

    let entries;
    try {
      entries = readdirSync(current.absolutePath, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    } catch {
      recordSkip(current.relativePath || ".", "unreadable");
      continue;
    }

    for (const entry of entries) {
      if (elapsedLimitHit()) {
        recordSkip(current.relativePath || ".", "time_limit");
        break;
      }
      const absolutePath = path.join(current.absolutePath, entry.name);
      const relativePath = toRepoPath(path.relative(repoRoot, absolutePath));
      const depth = relativePath.split("/").filter(Boolean).length;
      if (entry.isDirectory()) {
        if (
          options.excludedDirectories?.has(entry.name) ||
          options.shouldSkipDirectory?.(relativePath, entry.name)
        ) {
          continue;
        }
        if (depth > maxDepth) {
          recordSkip(relativePath, "depth_limit");
          continue;
        }
        queue.push({ absolutePath, relativePath, depth });
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (depth > maxDepth) {
        recordSkip(relativePath, "depth_limit");
        continue;
      }
      if (files.length >= maxFiles) {
        recordSkip(relativePath, "file_limit");
        continue;
      }
      if (options.shouldIncludeFile && !options.shouldIncludeFile(relativePath)) {
        continue;
      }
      files.push({ absolutePath, relativePath, depth });
    }
  }

  return {
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    skipped: skipped.sort((left, right) => {
      if (left.reason !== right.reason) {
        return left.reason.localeCompare(right.reason);
      }
      return left.path.localeCompare(right.path);
    }),
    hitLimit,
    reasons: [...new Set(skipped.map((entry) => entry.reason))].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/");
}
