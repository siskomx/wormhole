import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const DEFAULT_GIT_TIMEOUT_MS = 10_000;
export const MAX_GIT_TIMEOUT_MS = 30_000;
const DEFAULT_CONFLICT_FILE_BYTES = 128 * 1024;
const DEFAULT_CONFLICT_TOTAL_BYTES = 512 * 1024;

export type GitLifecycleStatusEntry = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
};

export type GitLifecycleStatus = {
  repoRoot: string;
  isGitRepo: boolean;
  branch?: string;
  head?: string;
  upstream?: string;
  baseRef?: string;
  ahead: number;
  behind: number;
  clean: boolean;
  changedFiles: string[];
  staged: GitLifecycleStatusEntry[];
  unstaged: GitLifecycleStatusEntry[];
  untracked: GitLifecycleStatusEntry[];
  warnings: string[];
};

export type GitRefusal = {
  refused: true;
  reason: string;
  hint?: string;
};

export type GitBranchPreparation = {
  branchName: string;
  slug: string;
  prefix?: string;
};

export type GitCommitPreparation = {
  advisory: true;
  message: string;
  type: string;
  scope?: string;
  changedFiles: string[];
  evidenceSummaries: string[];
  warnings: string[];
};

export type GitPrPreparation = {
  title: string;
  body: string;
  baseRef: string;
  headRef: string;
  commitSummaries: string[];
  changedFiles: string[];
  checklist: string[];
  commandHints: string[];
};

export type GitConflictAnalysis = {
  repoRoot: string;
  conflictFiles: Array<{ path: string }>;
  markerFiles: Array<{ path: string; markerCount: number }>;
  scannedFiles: number;
  bytesScanned: number;
  truncated: boolean;
  warnings: string[];
};

export type GitBranchCreateResult = GitRefusal | {
  refused?: false;
  created: true;
  branchName: string;
  checkedOut: boolean;
  stdout: string;
};

export type GitCommitCreateResult = GitRefusal | {
  refused?: false;
  committed: true;
  commitHash: string;
  files: string[];
  message: string;
  stdout: string;
};

type GitCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export function gitLifecycleStatus(input: { repoRoot: string; baseRef?: string; timeoutMs?: number }): GitLifecycleStatus {
  const repoRoot = path.resolve(input.repoRoot);
  const warnings: string[] = [];
  if (!isGitRepo(repoRoot, input.timeoutMs)) {
    return {
      repoRoot,
      isGitRepo: false,
      ahead: 0,
      behind: 0,
      clean: true,
      changedFiles: [],
      staged: [],
      unstaged: [],
      untracked: [],
      warnings: ["Repo root is not a git worktree."],
    };
  }

  const branch = runGit(repoRoot, ["branch", "--show-current"], input.timeoutMs).stdout.trim() || undefined;
  const head = runGit(repoRoot, ["rev-parse", "--short", "HEAD"], input.timeoutMs).stdout.trim() || undefined;
  const upstreamResult = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], input.timeoutMs);
  const upstream = upstreamResult.status === 0 ? upstreamResult.stdout.trim() || undefined : undefined;
  const baseRef = input.baseRef ?? upstream;
  let ahead = 0;
  let behind = 0;
  if (baseRef) {
    const counts = runGit(repoRoot, ["rev-list", "--left-right", "--count", `${baseRef}...HEAD`], input.timeoutMs);
    if (counts.status === 0) {
      const [behindText, aheadText] = counts.stdout.trim().split(/\s+/);
      behind = Number(behindText ?? "0") || 0;
      ahead = Number(aheadText ?? "0") || 0;
    } else {
      warnings.push(`Unable to compare HEAD with ${baseRef}.`);
    }
  }

  const entries = parsePorcelain(runGit(repoRoot, ["status", "--porcelain=v1"], input.timeoutMs).stdout);
  const staged = entries.filter((entry) => entry.indexStatus !== " " && entry.indexStatus !== "?");
  const untracked = entries.filter((entry) => entry.indexStatus === "?" && entry.worktreeStatus === "?");
  const unstaged = entries.filter((entry) => entry.indexStatus !== "?" && entry.worktreeStatus !== " ");
  const changedFiles = uniqueSorted(entries.map((entry) => entry.path));
  return {
    repoRoot,
    isGitRepo: true,
    branch,
    head,
    upstream,
    baseRef,
    ahead,
    behind,
    clean: entries.length === 0,
    changedFiles,
    staged,
    unstaged,
    untracked,
    warnings,
  };
}

export function prepareGitBranch(input: { objective: string; prefix?: string }): GitBranchPreparation {
  const slug = slugify(input.objective);
  const prefix = input.prefix?.trim().replace(/^\/+|\/+$/g, "");
  return {
    branchName: prefix ? `${prefix}/${slug}` : slug,
    slug,
    ...(prefix ? { prefix } : {}),
  };
}

export function prepareGitCommit(input: {
  repoRoot: string;
  objective: string;
  evidence?: Array<{ sourcePath?: string; summary: string }>;
}): GitCommitPreparation {
  const status = gitLifecycleStatus({ repoRoot: input.repoRoot });
  const type = inferCommitType(status.changedFiles);
  const scope = inferScope(status.changedFiles);
  const subject = slugWords(input.objective).join(" ") || "update repository";
  return {
    advisory: true,
    message: `${type}${scope ? `(${scope})` : ""}: ${subject}`,
    type,
    ...(scope ? { scope } : {}),
    changedFiles: status.changedFiles,
    evidenceSummaries: (input.evidence ?? []).map((evidence) => evidence.summary),
    warnings: [
      "Commit preparation is advisory only and does not write to the repository.",
      "Caller-supplied evidence is not trusted provenance.",
    ],
  };
}

export function prepareGitPr(input: {
  repoRoot: string;
  baseRef?: string;
  objective?: string;
}): GitPrPreparation {
  const status = gitLifecycleStatus({ repoRoot: input.repoRoot, baseRef: input.baseRef });
  const baseRef = input.baseRef ?? status.baseRef ?? "main";
  const headRef = status.branch ?? "HEAD";
  const objective = input.objective?.trim() || "Repository update";
  const log = runGit(path.resolve(input.repoRoot), ["log", "--oneline", `${baseRef}..HEAD`]);
  const diff = runGit(path.resolve(input.repoRoot), ["diff", "--name-only", `${baseRef}...HEAD`]);
  const commitSummaries = log.status === 0
    ? log.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  const changedFiles = diff.status === 0
    ? uniqueSorted(diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    : status.changedFiles;
  const checklist = ["Run focused verification", "Run full typecheck/test suite", "Record evidence before final claim"];
  const body = [
    "## Summary",
    "",
    `- ${objective}`,
    changedFiles.length > 0 ? `- Changed files: ${changedFiles.slice(0, 12).join(", ")}` : "- No changed files detected",
    "",
    "## Verification",
    "",
    ...checklist.map((item) => `- [ ] ${item}`),
  ].join("\n");
  return {
    title: objective,
    body,
    baseRef,
    headRef,
    commitSummaries,
    changedFiles,
    checklist,
    commandHints: [`gh pr create --base ${baseRef} --head ${headRef} --title "${objective}" --body-file <file>`],
  };
}

export function analyzeGitConflicts(input: {
  repoRoot: string;
  timeoutMs?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  unmergedFilesForTest?: string[];
}): GitConflictAnalysis {
  const repoRoot = path.resolve(input.repoRoot);
  const maxFileBytes = Math.max(1, input.maxFileBytes ?? DEFAULT_CONFLICT_FILE_BYTES);
  const maxTotalBytes = Math.max(1, input.maxTotalBytes ?? DEFAULT_CONFLICT_TOTAL_BYTES);
  const unmergedFiles = input.unmergedFilesForTest ?? unmergedGitFiles(repoRoot, input.timeoutMs);
  const markerFiles: Array<{ path: string; markerCount: number }> = [];
  let scannedFiles = 0;
  let bytesScanned = 0;
  let truncated = false;
  const warnings: string[] = [];

  for (const repoPath of unmergedFiles) {
    if (bytesScanned >= maxTotalBytes) {
      truncated = true;
      break;
    }
    const safePath = resolveRepoFile(repoRoot, repoPath);
    if (!safePath) {
      warnings.push(`Skipped unsafe conflict path: ${repoPath}`);
      continue;
    }
    if (!existsSync(safePath.absolutePath) || lstatSync(safePath.absolutePath).isDirectory()) {
      continue;
    }
    const remaining = maxTotalBytes - bytesScanned;
    const limit = Math.min(maxFileBytes, remaining);
    const text = readFileSync(safePath.absolutePath, "utf8").slice(0, limit);
    bytesScanned += Buffer.byteLength(text);
    scannedFiles += 1;
    if (Buffer.byteLength(readFileSync(safePath.absolutePath)) > limit) {
      truncated = true;
    }
    const markerCount = (text.match(/^(<<<<<<<|=======|>>>>>>>)(?: .*)?$/gm) ?? []).length;
    if (markerCount > 0) {
      markerFiles.push({ path: safePath.repoPath, markerCount });
    }
  }

  return {
    repoRoot,
    conflictFiles: unmergedFiles.map((repoPath) => ({ path: toRepoPath(repoPath) })),
    markerFiles: markerFiles.sort((left, right) => left.path.localeCompare(right.path)),
    scannedFiles,
    bytesScanned,
    truncated,
    warnings,
  };
}

export function createGitBranch(input: {
  repoRoot: string;
  branchName: string;
  checkout?: boolean;
  timeoutMs?: number;
}): GitBranchCreateResult {
  const repoRoot = path.resolve(input.repoRoot);
  const branchName = input.branchName.trim();
  if (!isGitRepo(repoRoot, input.timeoutMs)) {
    return { refused: true, reason: "Repo root is not a git worktree." };
  }
  const validation = runGit(repoRoot, ["check-ref-format", "--branch", branchName], input.timeoutMs);
  if (!branchName || validation.status !== 0) {
    return { refused: true, reason: `Invalid branch name: ${input.branchName}` };
  }
  const args = input.checkout ? ["switch", "-c", branchName] : ["branch", branchName];
  const result = runGit(repoRoot, args, input.timeoutMs);
  if (result.status !== 0) {
    return { refused: true, reason: result.stderr.trim() || `git ${args.join(" ")} failed` };
  }
  return {
    created: true,
    branchName,
    checkedOut: Boolean(input.checkout),
    stdout: result.stdout.trim(),
  };
}

export function createGitCommit(input: {
  repoRoot: string;
  files: string[];
  message: string;
  timeoutMs?: number;
}): GitCommitCreateResult {
  const repoRoot = path.resolve(input.repoRoot);
  const message = input.message.trim();
  if (!isGitRepo(repoRoot, input.timeoutMs)) {
    return { refused: true, reason: "Repo root is not a git worktree." };
  }
  if (!message) {
    return { refused: true, reason: "Commit message is required." };
  }
  if (input.files.length === 0) {
    return { refused: true, reason: "At least one explicit repo-relative file is required." };
  }
  const safeFiles: string[] = [];
  for (const filePath of input.files) {
    const safePath = validateCommitPath(repoRoot, filePath);
    if ("refused" in safePath) {
      return safePath;
    }
    safeFiles.push(safePath.repoPath);
  }
  const add = runGit(repoRoot, ["add", "--", ...safeFiles], input.timeoutMs);
  if (add.status !== 0) {
    return { refused: true, reason: add.stderr.trim() || "git add failed." };
  }
  const commit = runGit(repoRoot, ["commit", "--no-verify", `--message=${message}`], input.timeoutMs);
  if (commit.status !== 0) {
    return { refused: true, reason: commit.stderr.trim() || "git commit failed." };
  }
  const hash = runGit(repoRoot, ["rev-parse", "--short", "HEAD"], input.timeoutMs).stdout.trim();
  return {
    committed: true,
    commitHash: hash,
    files: uniqueSorted(safeFiles),
    message,
    stdout: commit.stdout.trim(),
  };
}

function isGitRepo(repoRoot: string, timeoutMs?: number): boolean {
  return runGit(repoRoot, ["rev-parse", "--is-inside-work-tree"], timeoutMs).stdout.trim() === "true";
}

function runGit(repoRoot: string, args: string[], timeoutMs?: number): GitCommandResult {
  const timeout = clampTimeout(timeoutMs, DEFAULT_GIT_TIMEOUT_MS, MAX_GIT_TIMEOUT_MS);
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: Boolean(result.error && result.error.message.includes("ETIMEDOUT")),
  };
}

function parsePorcelain(output: string): GitLifecycleStatusEntry[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      indexStatus: line.slice(0, 1),
      worktreeStatus: line.slice(1, 2),
      path: toRepoPath(line.slice(3).replace(/^.* -> /, "")),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function unmergedGitFiles(repoRoot: string, timeoutMs?: number): string[] {
  const diff = runGit(repoRoot, ["diff", "--name-only", "--diff-filter=U"], timeoutMs);
  if (diff.status === 0 && diff.stdout.trim()) {
    return uniqueSorted(diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  }
  return parsePorcelain(runGit(repoRoot, ["status", "--porcelain=v1"], timeoutMs).stdout)
    .filter((entry) => ["U", "A", "D"].includes(entry.indexStatus) && ["U", "A", "D"].includes(entry.worktreeStatus))
    .map((entry) => entry.path);
}

function validateCommitPath(repoRoot: string, filePath: string): { repoPath: string } | GitRefusal {
  if (path.isAbsolute(filePath)) {
    return { refused: true, reason: `Commit file must be repo-relative: ${filePath}` };
  }
  const safePath = resolveRepoFile(repoRoot, filePath);
  if (!safePath) {
    return { refused: true, reason: `Commit file escapes repo root: ${filePath}` };
  }
  if (!existsSync(safePath.absolutePath)) {
    return { refused: true, reason: `Commit file does not exist: ${filePath}` };
  }
  const stat = lstatSync(safePath.absolutePath);
  if (stat.isDirectory()) {
    return { refused: true, reason: `Commit file is a directory: ${filePath}` };
  }
  const realRoot = realpathSync(repoRoot);
  const realTarget = realpathSync(safePath.absolutePath);
  if (!isInside(realRoot, realTarget)) {
    return { refused: true, reason: `Commit file resolves outside repo: ${filePath}` };
  }
  return { repoPath: safePath.repoPath };
}

function resolveRepoFile(repoRoot: string, repoPath: string): { repoPath: string; absolutePath: string } | undefined {
  const absolutePath = path.resolve(repoRoot, repoPath);
  if (!isInside(repoRoot, absolutePath)) {
    return undefined;
  }
  return {
    repoPath: toRepoPath(path.relative(repoRoot, absolutePath)),
    absolutePath,
  };
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function inferCommitType(files: string[]): string {
  if (files.length > 0 && files.every((file) => /\.(md|mdx)$/i.test(file) || file.startsWith("docs/"))) {
    return "docs";
  }
  if (files.some((file) => /(^|\/)tests?\//.test(file) || /\.test\.[cm]?[jt]sx?$/.test(file))) {
    return "test";
  }
  if (files.some((file) => /(^|\/)package(-lock)?\.json$|pnpm-lock\.yaml|yarn\.lock/.test(file))) {
    return "chore";
  }
  return "feat";
}

function inferScope(files: string[]): string | undefined {
  const first = files.find((file) => file.includes("/"));
  return first?.split("/", 1)[0]?.replace(/[^a-z0-9-]/gi, "").toLowerCase();
}

function slugify(value: string): string {
  return slugWords(value).join("-") || "work";
}

function slugWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 0)
    .slice(0, 8);
}

function clampTimeout(value: number | undefined, defaultMs: number, maxMs: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return defaultMs;
  }
  return Math.min(Math.floor(value), maxMs);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(toRepoPath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
