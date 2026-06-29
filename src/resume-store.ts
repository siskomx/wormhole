import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ResumeTrustLevel = "scratch" | "handoff" | "canonical";
export type ResumeMaterialKind =
  | "user_decision"
  | "design_direction"
  | "exact_next_action"
  | "blocker"
  | "verification"
  | "tool_error"
  | "handoff"
  | "final_response"
  | "fresh_session_recommended";

export type ResumeRecordInput = {
  repoRoot: string;
  objective: string;
  kind: ResumeMaterialKind;
  summary: string;
  detail?: unknown;
  missionId?: string;
  trust?: ResumeTrustLevel;
  evidenceIds?: string[];
  contextPackIds?: string[];
  workspaceRecordIds?: string[];
  changedFiles?: string[];
  nextActions?: string[];
  source?: "agent" | "user" | "tool" | "host";
};

export type ResumeRecord = ResumeRecordInput & {
  recordId: string;
  recordedAt: string;
  contentHash: string;
  trust: ResumeTrustLevel;
  source: "agent" | "user" | "tool" | "host";
};

export type ResumeRepoFingerprint = {
  source: "git" | "filesystem";
  head?: string;
  dirty: boolean;
  statusHash: string;
};

export type ResumeValidationGroundTruth = {
  evidenceIds: string[];
  contextPackIds: string[];
  repoFingerprint: ResumeRepoFingerprint;
  existingChangedFiles: string[];
};

export type ResumeCheckpointRecordSummary = {
  recordId: string;
  recordedAt: string;
  kind: ResumeMaterialKind;
  summary: string;
  trust: ResumeTrustLevel;
  source: "agent" | "user" | "tool" | "host";
};

export type ResumeArtifactFile = {
  relativePath: string;
  absolutePath: string;
  bytes: number;
};

export type ResumeCheckpointInput = {
  repoRoot: string;
  objective: string;
  missionId?: string;
  reason: string;
  repoFingerprint?: ResumeRepoFingerprint;
  maxRecords?: number;
  includeTrust?: ResumeTrustLevel[];
};

export type ResumeCheckpoint = {
  checkpointId: string;
  repoRoot: string;
  objective: string;
  missionId?: string;
  reason: string;
  createdAt: string;
  recordIds: string[];
  latestRecordId?: string;
  materialRecordCount: number;
  unauditedRecordCount: number;
  trustCounts: Record<ResumeTrustLevel, number>;
  nextActions: string[];
  changedFiles: string[];
  repoFingerprint: ResumeRepoFingerprint;
  recordSummaries: ResumeCheckpointRecordSummary[];
  contentHash: string;
  files?: ResumeArtifactFile[];
};

export type ResumeValidationInput = {
  repoRoot: string;
  requireCanonical?: boolean;
  groundTruth?: ResumeValidationGroundTruth;
};

export type ResumeValidationResult = {
  repoRoot: string;
  valid: boolean;
  checkpoint?: ResumeCheckpoint;
  missingCheckpoint: boolean;
  staleMaterialRecordIds: string[];
  staleScratchRecordIds: string[];
  unauditedRecordIds: string[];
  unresolvedEvidenceIds: string[];
  unresolvedContextPackIds: string[];
  missingChangedFiles: string[];
  repoFingerprintChanged: boolean;
  reasons: string[];
};

export type ResumeStoreSnapshot = {
  records: ResumeRecord[];
  checkpoints: ResumeCheckpoint[];
};

export type ResumeArtifactWriteResult = {
  repoRoot: string;
  files: ResumeArtifactFile[];
  prunedFiles: string[];
};

const MAX_RECORDS_PER_REPO = 500;
const MAX_CHECKPOINTS_PER_REPO = 50;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function cloneRecord(record: ResumeRecord): ResumeRecord {
  return JSON.parse(JSON.stringify(record)) as ResumeRecord;
}

function cloneCheckpoint(checkpoint: ResumeCheckpoint): ResumeCheckpoint {
  return JSON.parse(JSON.stringify(checkpoint)) as ResumeCheckpoint;
}

function summarizeRecord(record: ResumeRecord): ResumeCheckpointRecordSummary {
  return {
    recordId: record.recordId,
    recordedAt: record.recordedAt,
    kind: record.kind,
    summary: record.summary,
    trust: record.trust,
    source: record.source,
  };
}

function normalizeRepoRoot(repoRoot: string): string {
  return path.resolve(repoRoot);
}

export function createResumeRepoFingerprint(repoRoot: string): ResumeRepoFingerprint {
  const normalizedRoot = normalizeRepoRoot(repoRoot);
  try {
    const head = execFileSync("git", ["-C", normalizedRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const status = execFileSync("git", ["-C", normalizedRoot, "status", "--porcelain=v1"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const normalizedStatus = status
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => {
        const file = line.slice(3).replace(/\\/g, "/");
        return !file.startsWith(".wormhole/resume/") && file !== ".wormhole/runtime-state.json";
      })
      .join("\n");
    return {
      source: "git",
      head,
      dirty: normalizedStatus.length > 0,
      statusHash: sha256(normalizedStatus),
    };
  } catch {
    const entries = fingerprintFilesystemEntries(normalizedRoot);
    return {
      source: "filesystem",
      dirty: entries.length > 0,
      statusHash: sha256(entries.join("\n")),
    };
  }
}

function fingerprintFilesystemEntries(repoRoot: string): string[] {
  if (!existsSync(repoRoot)) {
    return [];
  }
  const entries: string[] = [];
  const ignoredDirectories = new Set([".git", "node_modules"]);

  function walk(directory: string): void {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
      const absolutePath = path.join(directory, name);
      const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, "/");
      if (
        ignoredDirectories.has(name) ||
        relativePath.startsWith(".wormhole/resume/") ||
        relativePath === ".wormhole/runtime-state.json"
      ) {
        continue;
      }
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        walk(absolutePath);
      } else if (stat.isFile()) {
        entries.push(`${relativePath}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
      }
    }
  }

  walk(repoRoot);
  return entries;
}

function inferTrust(input: ResumeRecordInput): ResumeTrustLevel {
  if (input.trust) {
    return input.trust;
  }
  if ((input.evidenceIds?.length ?? 0) > 0 || (input.contextPackIds?.length ?? 0) > 0) {
    return "canonical";
  }
  if (
    (input.nextActions?.length ?? 0) > 0 ||
    (input.changedFiles?.length ?? 0) > 0 ||
    (input.workspaceRecordIds?.length ?? 0) > 0
  ) {
    return "handoff";
  }
  return "scratch";
}

function recordContent(input: ResumeRecordInput, trust: ResumeTrustLevel): string {
  return stableStringify({
    repoRoot: normalizeRepoRoot(input.repoRoot),
    objective: input.objective,
    kind: input.kind,
    summary: input.summary,
    detail: input.detail,
    missionId: input.missionId,
    trust,
    evidenceIds: uniqueSorted(input.evidenceIds ?? []),
    contextPackIds: uniqueSorted(input.contextPackIds ?? []),
    workspaceRecordIds: uniqueSorted(input.workspaceRecordIds ?? []),
    changedFiles: uniqueSorted(input.changedFiles ?? []),
    nextActions: uniqueSorted(input.nextActions ?? []),
    source: input.source ?? "agent",
  });
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function checkpointRecords(records: ResumeRecord[], input: ResumeCheckpointInput): ResumeRecord[] {
  const trustSet = input.includeTrust ? new Set(input.includeTrust) : undefined;
  const filtered = records
    .filter((record) => normalizeRepoRoot(record.repoRoot) === normalizeRepoRoot(input.repoRoot))
    .filter((record) => !input.missionId || record.missionId === input.missionId)
    .filter((record) => !trustSet || trustSet.has(record.trust));
  return input.maxRecords && filtered.length > input.maxRecords
    ? filtered.slice(filtered.length - input.maxRecords)
    : filtered;
}

export function createResumeStore(
  snapshot: Partial<ResumeStoreSnapshot> = {},
  onChange?: (snapshot: ResumeStoreSnapshot) => void,
) {
  const records = new Map<string, ResumeRecord>(
    (snapshot.records ?? []).map((record) => [record.recordId, cloneRecord(record)]),
  );
  const checkpoints = new Map<string, ResumeCheckpoint>(
    (snapshot.checkpoints ?? []).map((checkpoint) => [checkpoint.checkpointId, cloneCheckpoint(checkpoint)]),
  );

  function snapshotState(): ResumeStoreSnapshot {
    return {
      records: [...records.values()].map(cloneRecord),
      checkpoints: [...checkpoints.values()].map(cloneCheckpoint),
    };
  }

  function notifyChange(): void {
    onChange?.(snapshotState());
  }

  function latestCheckpoint(repoRoot: string): ResumeCheckpoint | undefined {
    return [...checkpoints.values()]
      .filter((checkpoint) => normalizeRepoRoot(checkpoint.repoRoot) === normalizeRepoRoot(repoRoot))
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.checkpointId.localeCompare(left.checkpointId),
      )[0];
  }

  function pruneRepoState(repoRoot: string): void {
    const normalizedRoot = normalizeRepoRoot(repoRoot);
    const repoCheckpoints = [...checkpoints.values()]
      .filter((checkpoint) => normalizeRepoRoot(checkpoint.repoRoot) === normalizedRoot)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.checkpointId.localeCompare(left.checkpointId),
      );
    for (const checkpoint of repoCheckpoints.slice(MAX_CHECKPOINTS_PER_REPO)) {
      checkpoints.delete(checkpoint.checkpointId);
    }

    const retainedCheckpoints = repoCheckpoints.slice(0, MAX_CHECKPOINTS_PER_REPO);
    const repoRecords = [...records.values()]
      .filter((record) => normalizeRepoRoot(record.repoRoot) === normalizedRoot)
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt) || right.recordId.localeCompare(left.recordId));
    const retainedRecordIds = new Set(repoRecords.slice(0, MAX_RECORDS_PER_REPO).map((record) => record.recordId));
    for (const checkpoint of retainedCheckpoints) {
      for (const recordId of checkpoint.recordIds) {
        retainedRecordIds.add(recordId);
      }
    }
    for (const record of repoRecords) {
      if (!retainedRecordIds.has(record.recordId)) {
        records.delete(record.recordId);
      }
    }
  }

  return {
    record(input: ResumeRecordInput): ResumeRecord {
      const trust = inferTrust(input);
      const contentHash = sha256(recordContent(input, trust));
      const record: ResumeRecord = {
        ...input,
        repoRoot: normalizeRepoRoot(input.repoRoot),
        source: input.source ?? "agent",
        trust,
        contentHash,
        recordId: `resume-record-${randomUUID()}`,
        recordedAt: new Date().toISOString(),
        evidenceIds: input.evidenceIds ? uniqueSorted(input.evidenceIds) : undefined,
        contextPackIds: input.contextPackIds ? uniqueSorted(input.contextPackIds) : undefined,
        workspaceRecordIds: input.workspaceRecordIds ? uniqueSorted(input.workspaceRecordIds) : undefined,
        changedFiles: input.changedFiles ? uniqueSorted(input.changedFiles) : undefined,
        nextActions: input.nextActions ? uniqueSorted(input.nextActions) : undefined,
      };
      records.set(record.recordId, record);
      pruneRepoState(record.repoRoot);
      notifyChange();
      return cloneRecord(record);
    },

    checkpoint(input: ResumeCheckpointInput): ResumeCheckpoint {
      const repoFingerprint = input.repoFingerprint ?? createResumeRepoFingerprint(input.repoRoot);
      const included = checkpointRecords([...records.values()], input);
      const trustCounts = {
        scratch: included.filter((record) => record.trust === "scratch").length,
        handoff: included.filter((record) => record.trust === "handoff").length,
        canonical: included.filter((record) => record.trust === "canonical").length,
      };
      const nextActions = uniqueSorted(included.flatMap((record) => record.nextActions ?? []));
      const changedFiles = uniqueSorted(included.flatMap((record) => record.changedFiles ?? []));
      const recordSummaries = included.map(summarizeRecord);
      const contentHash = sha256(
        stableStringify({
          repoRoot: normalizeRepoRoot(input.repoRoot),
          objective: input.objective,
          missionId: input.missionId,
          reason: input.reason,
          repoFingerprint,
          recordIds: included.map((record) => record.recordId),
          trustCounts,
          nextActions,
          changedFiles,
          recordSummaries,
        }),
      );
      const checkpoint: ResumeCheckpoint = {
        checkpointId: `resume-checkpoint-${randomUUID()}`,
        repoRoot: normalizeRepoRoot(input.repoRoot),
        objective: input.objective,
        missionId: input.missionId,
        reason: input.reason,
        createdAt: new Date().toISOString(),
        recordIds: included.map((record) => record.recordId),
        latestRecordId: included.at(-1)?.recordId,
        materialRecordCount: included.length,
        unauditedRecordCount: trustCounts.scratch + trustCounts.handoff,
        trustCounts,
        nextActions,
        changedFiles,
        repoFingerprint,
        recordSummaries,
        contentHash,
      };
      checkpoints.set(checkpoint.checkpointId, checkpoint);
      pruneRepoState(checkpoint.repoRoot);
      notifyChange();
      return cloneCheckpoint(checkpoint);
    },

    validate(input: ResumeValidationInput): ResumeValidationResult {
      const checkpoint = latestCheckpoint(input.repoRoot);
      const repoRecords = [...records.values()].filter(
        (record) => normalizeRepoRoot(record.repoRoot) === normalizeRepoRoot(input.repoRoot),
      );
      const checkpointedIds = new Set(checkpoint?.recordIds ?? []);
      const checkpointRecordsForValidation = repoRecords.filter((record) => checkpointedIds.has(record.recordId));
      const uncoveredRecords = checkpoint
        ? repoRecords.filter((record) => !checkpointedIds.has(record.recordId))
        : repoRecords;
      const staleMaterialRecordIds = uncoveredRecords
        .filter((record) => !checkpoint || record.trust !== "scratch")
        .map((record) => record.recordId);
      const staleScratchRecordIds = checkpoint
        ? uncoveredRecords.filter((record) => record.trust === "scratch").map((record) => record.recordId)
        : [];
      const unauditedRecordIds = repoRecords
        .filter((record) => record.trust !== "canonical")
        .map((record) => record.recordId);
      const knownEvidenceIds = new Set(input.groundTruth?.evidenceIds ?? []);
      const knownContextPackIds = new Set(input.groundTruth?.contextPackIds ?? []);
      const unresolvedEvidenceIds = uniqueSorted(
        checkpointRecordsForValidation
          .flatMap((record) => record.evidenceIds ?? [])
          .filter((evidenceId) => !knownEvidenceIds.has(evidenceId)),
      );
      const unresolvedContextPackIds = uniqueSorted(
        checkpointRecordsForValidation
          .flatMap((record) => record.contextPackIds ?? [])
          .filter((packId) => !knownContextPackIds.has(packId)),
      );
      const existingChangedFiles = new Set(input.groundTruth?.existingChangedFiles ?? []);
      const missingChangedFiles = checkpoint
        ? checkpoint.changedFiles.filter((file) => !existingChangedFiles.has(file))
        : [];
      const repoFingerprintChanged = Boolean(
        checkpoint &&
          input.groundTruth?.repoFingerprint &&
          stableStringify(checkpoint.repoFingerprint) !== stableStringify(input.groundTruth.repoFingerprint),
      );
      const verifiedCanonicalRecords = checkpointRecordsForValidation.filter((record) => {
        const evidenceIds = record.evidenceIds ?? [];
        const contextPackIds = record.contextPackIds ?? [];
        const evidenceVerified = evidenceIds.length > 0 && evidenceIds.every((evidenceId) => knownEvidenceIds.has(evidenceId));
        const contextVerified =
          contextPackIds.length > 0 && contextPackIds.every((packId) => knownContextPackIds.has(packId));
        return record.trust === "canonical" && (evidenceVerified || contextVerified);
      });
      const reasons: string[] = [];
      if (!checkpoint) {
        reasons.push("No resume checkpoint exists for this repo.");
      }
      if (staleMaterialRecordIds.length > 0) {
        reasons.push("Material resume records exist after the latest checkpoint.");
      }
      if (input.requireCanonical && checkpoint && verifiedCanonicalRecords.length === 0) {
        reasons.push("Latest checkpoint does not include a verified canonical resume record.");
      }
      if (unresolvedEvidenceIds.length > 0) {
        reasons.push("Resume records reference evidence ids that do not exist in kernel evidence.");
      }
      if (unresolvedContextPackIds.length > 0) {
        reasons.push("Resume records reference context pack ids that do not exist in runtime context state.");
      }
      if (missingChangedFiles.length > 0) {
        reasons.push("Resume checkpoint changed files are missing from the repo.");
      }
      if (repoFingerprintChanged) {
        reasons.push("Repo fingerprint differs from the checkpoint fingerprint.");
      }
      return {
        repoRoot: normalizeRepoRoot(input.repoRoot),
        valid: reasons.length === 0,
        checkpoint: checkpoint ? cloneCheckpoint(checkpoint) : undefined,
        missingCheckpoint: !checkpoint,
        staleMaterialRecordIds,
        staleScratchRecordIds,
        unauditedRecordIds,
        unresolvedEvidenceIds,
        unresolvedContextPackIds,
        missingChangedFiles,
        repoFingerprintChanged,
        reasons,
      };
    },

    load(input: { repoRoot: string }): { checkpoint?: ResumeCheckpoint; records: ResumeRecord[] } {
      const checkpoint = latestCheckpoint(input.repoRoot);
      const checkpointIds = new Set(checkpoint?.recordIds ?? []);
      return {
        checkpoint: checkpoint ? cloneCheckpoint(checkpoint) : undefined,
        records: [...records.values()]
          .filter((record) => normalizeRepoRoot(record.repoRoot) === normalizeRepoRoot(input.repoRoot))
          .filter((record) => !checkpoint || checkpointIds.has(record.recordId))
          .map(cloneRecord),
      };
    },

    retainedCheckpointIds(input: { repoRoot: string }): string[] {
      return [...checkpoints.values()]
        .filter((checkpoint) => normalizeRepoRoot(checkpoint.repoRoot) === normalizeRepoRoot(input.repoRoot))
        .map((checkpoint) => checkpoint.checkpointId)
        .sort((left, right) => left.localeCompare(right));
    },

    snapshot: snapshotState,
  };
}

export function writeResumeArtifacts(input: {
  repoRoot: string;
  checkpoint: ResumeCheckpoint;
  retainedCheckpointIds?: string[];
}): ResumeArtifactWriteResult {
  const repoRoot = normalizeRepoRoot(input.repoRoot);
  const checkpointJson = `.wormhole/resume/checkpoints/${input.checkpoint.checkpointId}.json`;
  const checkpointMarkdown = `.wormhole/resume/checkpoints/${input.checkpoint.checkpointId}.md`;
  const latest = {
    checkpointId: input.checkpoint.checkpointId,
    checkpointPath: checkpointJson,
    resumePath: checkpointMarkdown,
  };
  const files = [
    writeArtifact(repoRoot, ".wormhole/resume/latest.json", `${JSON.stringify(latest, null, 2)}\n`),
    writeArtifact(repoRoot, ".wormhole/resume/latest.md", renderResumeMarkdown(input.checkpoint)),
    writeArtifact(repoRoot, checkpointJson, `${JSON.stringify(input.checkpoint, null, 2)}\n`),
    writeArtifact(repoRoot, checkpointMarkdown, renderResumeMarkdown(input.checkpoint)),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const prunedFiles = pruneCheckpointArtifacts(
    repoRoot,
    new Set(input.retainedCheckpointIds ?? [input.checkpoint.checkpointId]),
  );
  return { repoRoot, files, prunedFiles };
}

export function renderResumeMarkdown(checkpoint: ResumeCheckpoint): string {
  return [
    "# Wormhole Resume",
    "",
    `Checkpoint: ${checkpoint.checkpointId}`,
    `Objective: ${checkpoint.objective}`,
    `Reason: ${checkpoint.reason}`,
    `Created: ${checkpoint.createdAt}`,
    "",
    "## Trust Summary",
    "",
    `Canonical: ${checkpoint.trustCounts.canonical}`,
    `Handoff: ${checkpoint.trustCounts.handoff}`,
    `Scratch: ${checkpoint.trustCounts.scratch}`,
    "",
    "## Exact Next Actions",
    "",
    ...(checkpoint.nextActions.length > 0 ? checkpoint.nextActions.map((action) => `- ${action}`) : ["- None recorded."]),
    "",
    "## Material Records",
    "",
    ...(checkpoint.recordSummaries.length > 0
      ? checkpoint.recordSummaries.map((record) => `- [${record.trust}] ${record.kind}: ${record.summary}`)
      : ["- None recorded."]),
    "",
    "## Changed Files",
    "",
    ...(checkpoint.changedFiles.length > 0 ? checkpoint.changedFiles.map((file) => `- ${file}`) : ["- None recorded."]),
    "",
  ].join("\n");
}

function writeArtifact(repoRoot: string, relativePath: string, content: string): ResumeArtifactFile {
  const normalizedContent = `${content.trimEnd()}\n`;
  const absolutePath = resolveRepoPath(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, normalizedContent);
  return {
    relativePath,
    absolutePath,
    bytes: Buffer.byteLength(normalizedContent, "utf8"),
  };
}

function pruneCheckpointArtifacts(repoRoot: string, retainedCheckpointIds: Set<string>): string[] {
  const checkpointsDir = resolveRepoPath(repoRoot, ".wormhole/resume/checkpoints");
  if (!existsSync(checkpointsDir)) {
    return [];
  }
  const prunedFiles: string[] = [];
  for (const name of readdirSync(checkpointsDir)) {
    const parsed = path.parse(name);
    if ((parsed.ext === ".json" || parsed.ext === ".md") && !retainedCheckpointIds.has(parsed.name)) {
      const absolutePath = path.join(checkpointsDir, name);
      rmSync(absolutePath, { force: true });
      prunedFiles.push(path.relative(repoRoot, absolutePath).replace(/\\/g, "/"));
    }
  }
  return prunedFiles.sort((left, right) => left.localeCompare(right));
}

function resolveRepoPath(repoRoot: string, relativePath: string): string {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relativeToRoot = path.relative(repoRoot, absolutePath);
  if (relativeToRoot === "" || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Resume artifact path must stay within repoRoot");
  }
  return absolutePath;
}
