import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type RepoFileChangeKind = "added" | "modified" | "deleted";

export type RepoFileChange = {
  path: string;
  kind: RepoFileChangeKind;
  previousHash?: string;
  currentHash?: string;
  previousSize?: number;
  currentSize?: number;
};

export type RepoGitStatus = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
};

export type RepoGitDiffSnapshot = {
  available: boolean;
  changedFiles: string[];
  status: RepoGitStatus[];
  diffText: string;
  stagedDiffText: string;
  warnings: string[];
};

export type RepoActivityKind =
  | "watch_started"
  | "file_changed"
  | "git_diff_detected"
  | "command_run"
  | "verification"
  | "graph_refreshed"
  | "note";

export type RepoActivityEvent = {
  eventId: string;
  repoRoot: string;
  kind: RepoActivityKind;
  summary: string;
  createdAt: string;
  paths: string[];
  missionId?: string;
  watchId?: string;
  metadata?: Record<string, unknown>;
  evidenceId?: string;
};

export type RepoWatchOptions = {
  include?: string[];
  exclude?: string[];
  autoRecord?: boolean;
  autoRefreshGraph?: boolean;
};

export type RepoWatchSession = {
  watchId: string;
  repoRoot: string;
  missionId?: string;
  status: "active" | "stopped";
  startedAt: string;
  stoppedAt?: string;
  lastScanAt?: string;
  options: RepoWatchOptions;
  baseline: Record<string, RepoFileSnapshot>;
  lastChangedFiles: string[];
};

export type RepoActivitySnapshot = {
  sessions: RepoWatchSession[];
  events: RepoActivityEvent[];
};

export type RepoWatchStartInput = RepoWatchOptions & {
  repoRoot: string;
  missionId?: string;
};

export type RepoWatchScanInput = {
  watchId: string;
};

export type RepoChangeScanInput = RepoWatchOptions & {
  repoRoot: string;
};

export type RepoActivityRecordInput = {
  repoRoot: string;
  kind: RepoActivityKind;
  summary: string;
  paths?: string[];
  missionId?: string;
  watchId?: string;
  metadata?: Record<string, unknown>;
};

export type RepoWatchStartResult = Omit<RepoWatchSession, "baseline"> & {
  fileCount: number;
};

export type RepoWatchScanResult = {
  watchId: string;
  repoRoot: string;
  scannedAt: string;
  changedFiles: string[];
  fileChanges: RepoFileChange[];
  git: RepoGitDiffSnapshot;
  events: RepoActivityEvent[];
};

export type RepoChangeScanResult = {
  repoRoot: string;
  scannedAt: string;
  changedFiles: string[];
  fileChanges: RepoFileChange[];
  git: RepoGitDiffSnapshot;
};

export type RepoWatchStatusResult = {
  sessions: RepoWatchStartResult[];
  events: RepoActivityEvent[];
};

type RepoFileSnapshot = {
  path: string;
  size: number;
  mtimeMs: number;
  hash: string;
};

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".wormhole",
  "build",
  "coverage",
  "dist",
  "graphify-out",
  "node_modules",
  "out",
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function activityId(parts: string[]): string {
  return `activity:${hashText(parts.join("\n")).slice(0, 16)}`;
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizePathList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(toRepoPath).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function matchesPattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = toRepoPath(pattern);
  if (normalizedPattern.includes("*")) {
    const source = `^${normalizedPattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`;
    return new RegExp(source).test(relativePath);
  }
  if (normalizedPattern.includes("/")) {
    return relativePath === normalizedPattern || relativePath.startsWith(`${normalizedPattern}/`);
  }
  return relativePath.split("/").includes(normalizedPattern);
}

function shouldIncludePath(relativePath: string, options: RepoWatchOptions): boolean {
  const include = options.include ?? [];
  const exclude = options.exclude ?? [];
  if (include.length > 0 && !include.some((pattern) => matchesPattern(relativePath, pattern))) {
    return false;
  }
  return !exclude.some((pattern) => matchesPattern(relativePath, pattern));
}

function listSnapshotFiles(repoRoot: string, options: RepoWatchOptions): string[] {
  const files: string[] = [];

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toRepoPath(path.relative(repoRoot, absolutePath));
      if (entry.isDirectory()) {
        if (DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name) || !shouldIncludePath(relativePath, options)) {
          continue;
        }
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !shouldIncludePath(relativePath, options)) {
        continue;
      }
      try {
        if (lstatSync(absolutePath).isSymbolicLink()) {
          continue;
        }
      } catch {
        continue;
      }
      files.push(relativePath);
    }
  }

  visit(repoRoot);
  return files;
}

function createFileSnapshot(repoRoot: string, relativePath: string): RepoFileSnapshot {
  const absolutePath = path.join(repoRoot, relativePath);
  const stat = statSync(absolutePath);
  const content = readFileSync(absolutePath);
  return {
    path: relativePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    hash: createHash("sha256").update(content).digest("hex"),
  };
}

function createRepoSnapshot(repoRootInput: string, options: RepoWatchOptions): Record<string, RepoFileSnapshot> {
  const repoRoot = path.resolve(repoRootInput);
  const snapshot: Record<string, RepoFileSnapshot> = {};
  for (const relativePath of listSnapshotFiles(repoRoot, options)) {
    snapshot[relativePath] = createFileSnapshot(repoRoot, relativePath);
  }
  return snapshot;
}

function compareSnapshots(
  previous: Record<string, RepoFileSnapshot>,
  current: Record<string, RepoFileSnapshot>,
): RepoFileChange[] {
  const paths = normalizePathList([...Object.keys(previous), ...Object.keys(current)]);
  const changes: RepoFileChange[] = [];
  for (const repoPath of paths) {
    const before = previous[repoPath];
    const after = current[repoPath];
    if (!before && after) {
      changes.push({
        path: repoPath,
        kind: "added",
        currentHash: after.hash,
        currentSize: after.size,
      });
      continue;
    }
    if (before && !after) {
      changes.push({
        path: repoPath,
        kind: "deleted",
        previousHash: before.hash,
        previousSize: before.size,
      });
      continue;
    }
    if (before && after && before.hash !== after.hash) {
      changes.push({
        path: repoPath,
        kind: "modified",
        previousHash: before.hash,
        currentHash: after.hash,
        previousSize: before.size,
        currentSize: after.size,
      });
    }
  }
  return changes;
}

function runGit(repoRoot: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseGitStatus(output: string): RepoGitStatus[] {
  const records: RepoGitStatus[] = [];
  const entries = output.split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    if (entry.length < 4) {
      continue;
    }
    const indexStatus = entry[0] ?? " ";
    const worktreeStatus = entry[1] ?? " ";
    const repoPath = toRepoPath(entry.slice(3));
    let originalPath: string | undefined;
    if (indexStatus === "R" || indexStatus === "C") {
      originalPath = toRepoPath(entries[index + 1] ?? "");
      index += 1;
    }
    records.push({
      path: repoPath,
      indexStatus,
      worktreeStatus,
      ...(originalPath ? { originalPath } : {}),
    });
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

export function readGitDiffSnapshot(repoRootInput: string): RepoGitDiffSnapshot {
  const repoRoot = path.resolve(repoRootInput);
  if (!existsSync(path.join(repoRoot, ".git"))) {
    return {
      available: false,
      changedFiles: [],
      status: [],
      diffText: "",
      stagedDiffText: "",
      warnings: ["No .git directory found for repo diff detection."],
    };
  }

  const status = runGit(repoRoot, ["status", "--porcelain=v1", "-z"]);
  if (status.status !== 0) {
    return {
      available: false,
      changedFiles: [],
      status: [],
      diffText: "",
      stagedDiffText: "",
      warnings: [status.stderr.trim() || "git status failed"],
    };
  }

  const diff = runGit(repoRoot, ["diff", "--no-ext-diff", "--"]);
  const stagedDiff = runGit(repoRoot, ["diff", "--cached", "--no-ext-diff", "--"]);
  const parsedStatus = parseGitStatus(status.stdout);
  const changedFiles = normalizePathList(
    parsedStatus.flatMap((record) => [record.path, record.originalPath ?? ""]),
  );
  const warnings = [
    ...(diff.status === 0 ? [] : [diff.stderr.trim() || "git diff failed"]),
    ...(stagedDiff.status === 0 ? [] : [stagedDiff.stderr.trim() || "git diff --cached failed"]),
  ];

  return {
    available: true,
    changedFiles,
    status: parsedStatus,
    diffText: diff.stdout,
    stagedDiffText: stagedDiff.stdout,
    warnings,
  };
}

function publicWatch(session: RepoWatchSession): RepoWatchStartResult {
  const { baseline, ...rest } = session;
  return {
    ...clone(rest),
    fileCount: Object.keys(baseline).length,
  };
}

function createActivityEvent(input: RepoActivityRecordInput): RepoActivityEvent {
  const createdAt = nowIso();
  const repoRoot = path.resolve(input.repoRoot);
  const paths = normalizePathList(input.paths);
  return {
    eventId: activityId([createdAt, repoRoot, input.kind, input.summary, ...paths]),
    repoRoot,
    kind: input.kind,
    summary: input.summary,
    createdAt,
    paths,
    ...(input.missionId ? { missionId: input.missionId } : {}),
    ...(input.watchId ? { watchId: input.watchId } : {}),
    ...(input.metadata ? { metadata: clone(input.metadata) } : {}),
  };
}

export function createRepoActivityStore(
  snapshot: Partial<RepoActivitySnapshot> = {},
  onChange?: (snapshot: RepoActivitySnapshot) => void,
) {
  const sessions = new Map<string, RepoWatchSession>();
  for (const session of snapshot.sessions ?? []) {
    sessions.set(session.watchId, clone(session));
  }
  const events = [...(snapshot.events ?? [])].map(clone);

  function emitChange(): void {
    onChange?.({
      sessions: [...sessions.values()].map(clone),
      events: events.map(clone),
    });
  }

  function appendEvent(input: RepoActivityRecordInput): RepoActivityEvent {
    const event = createActivityEvent(input);
    events.push(event);
    emitChange();
    return event;
  }

  return {
    startWatch(input: RepoWatchStartInput): RepoWatchStartResult {
      const repoRoot = path.resolve(input.repoRoot);
      const startedAt = nowIso();
      const baseline = createRepoSnapshot(repoRoot, input);
      const watchId = `watch:${hashText([repoRoot, startedAt, input.missionId ?? ""].join("\n")).slice(0, 16)}`;
      const session: RepoWatchSession = {
        watchId,
        repoRoot,
        status: "active",
        startedAt,
        options: {
          include: input.include,
          exclude: input.exclude,
          autoRecord: input.autoRecord,
          autoRefreshGraph: input.autoRefreshGraph,
        },
        baseline,
        lastChangedFiles: [],
        ...(input.missionId ? { missionId: input.missionId } : {}),
      };
      sessions.set(watchId, session);
      appendEvent({
        repoRoot,
        watchId,
        missionId: input.missionId,
        kind: "watch_started",
        summary: `Started repo watch with ${Object.keys(baseline).length} files in baseline.`,
        paths: [],
      });
      return publicWatch(session);
    },

    scanWatch(input: RepoWatchScanInput): RepoWatchScanResult {
      const session = sessions.get(input.watchId);
      if (!session || session.status !== "active") {
        throw new Error(`Active repo watch not found: ${input.watchId}`);
      }
      const current = createRepoSnapshot(session.repoRoot, session.options);
      const fileChanges = compareSnapshots(session.baseline, current);
      const git = readGitDiffSnapshot(session.repoRoot);
      const changedFiles = normalizePathList([
        ...fileChanges.map((change) => change.path),
        ...git.changedFiles,
      ]);
      const scannedAt = nowIso();
      session.baseline = current;
      session.lastScanAt = scannedAt;
      session.lastChangedFiles = changedFiles;

      const scanEvents =
        changedFiles.length > 0
          ? [
              appendEvent({
                repoRoot: session.repoRoot,
                watchId: session.watchId,
                missionId: session.missionId,
                kind: "file_changed",
                summary: `Detected ${changedFiles.length} changed file(s): ${changedFiles.join(", ")}.`,
                paths: changedFiles,
                metadata: { fileChanges },
              }),
            ]
          : [];
      if (git.changedFiles.length > 0) {
        scanEvents.push(
          appendEvent({
            repoRoot: session.repoRoot,
            watchId: session.watchId,
            missionId: session.missionId,
            kind: "git_diff_detected",
            summary: `Detected git changes in ${git.changedFiles.length} file(s): ${git.changedFiles.join(", ")}.`,
            paths: git.changedFiles,
            metadata: { status: git.status },
          }),
        );
      }
      emitChange();
      return {
        watchId: session.watchId,
        repoRoot: session.repoRoot,
        scannedAt,
        changedFiles,
        fileChanges,
        git,
        events: scanEvents,
      };
    },

    scanChanges(input: RepoChangeScanInput): RepoChangeScanResult {
      const repoRoot = path.resolve(input.repoRoot);
      const git = readGitDiffSnapshot(repoRoot);
      return {
        repoRoot,
        scannedAt: nowIso(),
        changedFiles: git.changedFiles,
        fileChanges: [],
        git,
      };
    },

    status(input: { repoRoot?: string; watchId?: string } = {}): RepoWatchStatusResult {
      const repoRoot = input.repoRoot ? path.resolve(input.repoRoot) : undefined;
      const selectedSessions = [...sessions.values()].filter(
        (session) =>
          (!repoRoot || session.repoRoot === repoRoot) && (!input.watchId || session.watchId === input.watchId),
      );
      const selectedEvents = events.filter(
        (event) =>
          (!repoRoot || event.repoRoot === repoRoot) && (!input.watchId || event.watchId === input.watchId),
      );
      return {
        sessions: selectedSessions.map(publicWatch),
        events: selectedEvents.map(clone),
      };
    },

    stopWatch(input: { watchId: string }): RepoWatchStartResult {
      const session = sessions.get(input.watchId);
      if (!session) {
        throw new Error(`Repo watch not found: ${input.watchId}`);
      }
      session.status = "stopped";
      session.stoppedAt = nowIso();
      emitChange();
      return publicWatch(session);
    },

    recordActivity(input: RepoActivityRecordInput): RepoActivityEvent {
      return appendEvent(input);
    },

    snapshot(): RepoActivitySnapshot {
      return {
        sessions: [...sessions.values()].map(clone),
        events: events.map(clone),
      };
    },
  };
}
