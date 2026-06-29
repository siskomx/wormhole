import path from "node:path";
import type { ProjectContract } from "./project-contract.js";
import type { RepoIndex } from "./repo-index.js";
import { analyzeSourceConflicts } from "./source-conflicts.js";

export type DocsSyncDecision = "pass" | "warn" | "fail";

export type DocsSyncFinding = {
  kind: "source_conflict" | "missing_docs_update";
  severity: "warning" | "error";
  path?: string;
  message: string;
};

export type DocsSyncResult = {
  repoRoot: string;
  decision: DocsSyncDecision;
  changedFiles: string[];
  docsChanged: boolean;
  publicSurfaceChanged: string[];
  findings: DocsSyncFinding[];
};

export function checkDocsSync(input: {
  repoRoot: string;
  index: RepoIndex;
  contract?: ProjectContract;
  changedFiles?: string[];
  diffText?: string;
  requireDocsForPublicChanges?: boolean;
}): DocsSyncResult {
  const repoRoot = path.resolve(input.repoRoot);
  const changedFiles = uniqueSorted([...(input.changedFiles ?? []), ...changedFilesFromDiff(input.diffText ?? "")]);
  const docsChanged = changedFiles.some(isDocsFile);
  const publicSurfaceChanged = changedFiles.filter(isPublicSurfaceFile);
  const sourceConflicts = analyzeSourceConflicts({ repoRoot, index: input.index, contract: input.contract });
  const findings: DocsSyncFinding[] = [
    ...sourceConflicts.conflicts.map((conflict): DocsSyncFinding => ({
      kind: "source_conflict",
      severity: "warning",
      path: conflict.conflicting[0]?.sourcePath,
      message: conflict.message,
    })),
  ];

  if (publicSurfaceChanged.length > 0 && !docsChanged) {
    findings.push(
      ...publicSurfaceChanged.map((filePath): DocsSyncFinding => ({
        kind: "missing_docs_update",
        severity: input.requireDocsForPublicChanges ? "error" : "warning",
        path: filePath,
        message: `${filePath} changes public surface area but no docs file changed in the same scope.`,
      })),
    );
  }

  const decision: DocsSyncDecision = findings.length === 0
    ? "pass"
    : findings.some((finding) => finding.severity === "error")
      ? "fail"
      : "warn";
  return {
    repoRoot,
    decision,
    changedFiles,
    docsChanged,
    publicSurfaceChanged,
    findings: findings.sort((left, right) => (left.path ?? "").localeCompare(right.path ?? "")),
  };
}

function changedFilesFromDiff(diffText: string): string[] {
  const files: string[] = [];
  for (const line of diffText.split(/\r?\n/)) {
    const match = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
    if (match?.[2]) {
      files.push(toRepoPath(match[2]));
    }
  }
  return files;
}

function isDocsFile(filePath: string): boolean {
  const normalized = toRepoPath(filePath).toLowerCase();
  return (
    normalized.startsWith("docs/") ||
    normalized === "readme.md" ||
    normalized === "changelog.md" ||
    /\.(md|mdx)$/.test(normalized)
  );
}

function isPublicSurfaceFile(filePath: string): boolean {
  const normalized = toRepoPath(filePath).toLowerCase();
  const basename = normalized.split("/").pop() ?? normalized;
  return (
    /(^|\/)(routes?|api|controllers?)\//.test(normalized) ||
    /openapi|swagger/.test(normalized) ||
    /(^|\/)migrations?\//.test(normalized) ||
    /(^|\/)schema\//.test(normalized) ||
    /^package(-lock)?\.json$/.test(basename) ||
    /^(pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|cargo\.toml|cargo\.lock)$/.test(basename) ||
    /(^|\/)src\/(?:.*\/)?index\.[cm]?[jt]sx?$/.test(normalized) ||
    /\.(config|conf)\.[cm]?[jt]s$/.test(normalized)
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(toRepoPath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
