import path from "node:path";

export type DiffScopeDecision = "pass" | "warn" | "fail";

export type DiffScopeEvidence = {
  evidenceId?: string;
  sourcePath?: string;
  summary: string;
};

export type DiffScopeFinding = {
  kind: "unjustified_file" | "unjustified_hunk" | "empty_diff";
  severity: "warning" | "error";
  path?: string;
  line?: number;
  message: string;
};

export type DiffScopeReviewInput = {
  repoRoot: string;
  objective: string;
  diffText?: string;
  changedFiles?: string[];
  evidence?: DiffScopeEvidence[];
  approvedPaths?: string[];
  strict?: boolean;
};

export type DiffScopeReviewResult = {
  repoRoot: string;
  objective: string;
  decision: DiffScopeDecision;
  changedFiles: string[];
  reviewedHunks: number;
  findings: DiffScopeFinding[];
};

type ParsedDiffFile = {
  path: string;
  hunks: Array<{ newStart: number; addedText: string }>;
};

export function reviewDiffScope(input: DiffScopeReviewInput): DiffScopeReviewResult {
  const repoRoot = path.resolve(input.repoRoot);
  const parsedFiles = parseUnifiedDiffFiles(input.diffText ?? "");
  const explicitFiles = (input.changedFiles ?? []).map(toRepoPath);
  const files = parsedFiles.length > 0
    ? parsedFiles
    : explicitFiles.map((filePath) => ({ path: filePath, hunks: [] }));
  const severity = input.strict ? "error" : "warning";
  const objectiveTokens = tokenizeScope(input.objective);
  const evidencePaths = (input.evidence ?? [])
    .map((evidence) => evidence.sourcePath)
    .filter((value): value is string => Boolean(value))
    .map(toRepoPath);
  const approvedPaths = (input.approvedPaths ?? []).map(toRepoPath);
  const findings: DiffScopeFinding[] = [];

  if (files.length === 0) {
    findings.push({
      kind: "empty_diff",
      severity,
      message: "No changed files or unified diff hunks were supplied for scope review.",
    });
  }

  for (const file of files) {
    const fileJustified = isPathJustified(file.path, objectiveTokens, evidencePaths, approvedPaths);
    const hunkJustified = file.hunks.some((hunk) => textHasToken(hunk.addedText, objectiveTokens));
    if (!fileJustified && !hunkJustified) {
      findings.push({
        kind: "unjustified_file",
        severity,
        path: file.path,
        message: `${file.path} is not tied to the objective, evidence paths, or approved paths.`,
      });
    }
    if (fileJustified) {
      continue;
    }
    for (const hunk of file.hunks) {
      if (!textHasToken(hunk.addedText, objectiveTokens)) {
        findings.push({
          kind: "unjustified_hunk",
          severity,
          path: file.path,
          line: hunk.newStart,
          message: `${file.path}:${hunk.newStart} has added lines without objective tokens or path evidence.`,
        });
      }
    }
  }

  const decision: DiffScopeDecision = findings.length === 0
    ? "pass"
    : findings.some((finding) => finding.severity === "error")
      ? "fail"
      : "warn";
  return {
    repoRoot,
    objective: input.objective,
    decision,
    changedFiles: uniqueSorted([...explicitFiles, ...files.map((file) => file.path)]),
    reviewedHunks: files.reduce((sum, file) => sum + file.hunks.length, 0),
    findings: findings.sort(compareFindings),
  };
}

function parseUnifiedDiffFiles(diffText: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];
  let current: ParsedDiffFile | undefined;
  let currentHunk: ParsedDiffFile["hunks"][number] | undefined;
  for (const line of diffText.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
      current = match?.[2] ? { path: toRepoPath(match[2]), hunks: [] } : undefined;
      if (current) {
        files.push(current);
      }
      currentHunk = undefined;
      continue;
    }
    if (line.startsWith("+++ ") && current) {
      const nextPath = parseDiffPath(line.slice(4), "b");
      if (nextPath) {
        current.path = nextPath;
      }
      continue;
    }
    if (line.startsWith("@@ ") && current) {
      const match = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      currentHunk = { newStart: Number(match?.[1] ?? "1"), addedText: "" };
      current.hunks.push(currentHunk);
      continue;
    }
    if (currentHunk && line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.addedText += `${line.slice(1)}\n`;
    }
  }
  return files.filter((file) => file.path && file.hunks.length > 0);
}

function parseDiffPath(rawPath: string, prefix: "a" | "b"): string | undefined {
  const trimmed = rawPath.trim();
  if (trimmed === "/dev/null") {
    return undefined;
  }
  return toRepoPath(trimmed.replace(new RegExp(`^${prefix}/`), ""));
}

function isPathJustified(
  repoPath: string,
  objectiveTokens: Set<string>,
  evidencePaths: string[],
  approvedPaths: string[],
): boolean {
  const pathTokens = tokenizeScope(repoPath);
  if ([...pathTokens].some((token) => objectiveTokens.has(token))) {
    return true;
  }
  return [...evidencePaths, ...approvedPaths].some((candidate) => pathMatches(repoPath, candidate));
}

function textHasToken(text: string, tokens: Set<string>): boolean {
  const textTokens = tokenizeScope(text);
  return [...textTokens].some((token) => tokens.has(token));
}

function pathMatches(repoPath: string, candidate: string): boolean {
  return repoPath === candidate || repoPath.startsWith(`${candidate.replace(/\/+$/, "")}/`);
}

function tokenizeScope(value: string): Set<string> {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return new Set(spaced.split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
}

function compareFindings(left: DiffScopeFinding, right: DiffScopeFinding): number {
  return (
    (left.path ?? "").localeCompare(right.path ?? "") ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.kind.localeCompare(right.kind)
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
