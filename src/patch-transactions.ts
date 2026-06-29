import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { DiffScopeReviewResult } from "./diff-scope-review.js";

export type PatchFileSnapshot = {
  path: string;
  existed: boolean;
  content?: string;
  hash?: string;
};

export type PatchCheckpoint = {
  checkpointId: string;
  repoRoot: string;
  label?: string;
  createdAt: string;
  files: PatchFileSnapshot[];
};

export type PatchVerificationCommand = {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  reason?: string;
};

export type PatchTransactionStatus = "applied" | "rolled_back" | "failed";

export type PatchTransaction = {
  transactionId: string;
  checkpointId: string;
  repoRoot: string;
  status: PatchTransactionStatus;
  createdAt: string;
  updatedAt: string;
  filesChanged: string[];
  rollbackAvailable: boolean;
  before: PatchFileSnapshot[];
  verification: {
    status: "pending" | "not_required";
    commands: PatchVerificationCommand[];
  };
  scopeReview?: DiffScopeReviewResult;
  error?: string;
};

export type PatchTransactionSnapshot = {
  checkpoints: PatchCheckpoint[];
  transactions: PatchTransaction[];
};

export type PatchTransactionStatusView = {
  checkpoints: Array<Omit<PatchCheckpoint, "files"> & { files: Array<Omit<PatchFileSnapshot, "content">> }>;
  transactions: Array<Omit<PatchTransaction, "before"> & { before: Array<Omit<PatchFileSnapshot, "content">> }>;
};

type FilePatch = {
  oldPath?: string;
  newPath?: string;
  hunks: Hunk[];
};

type Hunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

type ParsedDiff = {
  patches: FilePatch[];
};

export function createPatchTransactionStore(
  snapshot: Partial<PatchTransactionSnapshot> = {},
  onChange?: (snapshot: PatchTransactionSnapshot) => void,
) {
  const checkpoints = new Map<string, PatchCheckpoint>(
    (snapshot.checkpoints ?? []).map((checkpoint) => [
      checkpoint.checkpointId,
      cloneCheckpoint(checkpoint),
    ]),
  );
  const transactions = new Map<string, PatchTransaction>(
    (snapshot.transactions ?? []).map((transaction) => [
      transaction.transactionId,
      cloneTransaction(transaction),
    ]),
  );

  function snapshotState(): PatchTransactionSnapshot {
    return {
      checkpoints: [...checkpoints.values()].map(cloneCheckpoint),
      transactions: [...transactions.values()].map(cloneTransaction),
    };
  }

  function persist(): void {
    onChange?.(snapshotState());
  }

  return {
    checkpoint(input: { repoRoot: string; label?: string; files: string[] }): PatchCheckpoint {
      const repoRoot = resolveRepoRoot(input.repoRoot);
      const checkpoint: PatchCheckpoint = {
        checkpointId: `patchcp:${randomUUID()}`,
        repoRoot,
        label: input.label,
        createdAt: new Date().toISOString(),
        files: uniqueSorted(input.files).map((filePath) => createFileSnapshot(repoRoot, filePath)),
      };
      checkpoints.set(checkpoint.checkpointId, checkpoint);
      persist();
      return cloneCheckpoint(checkpoint);
    },

    apply(input: {
      repoRoot: string;
      checkpointId: string;
      unifiedDiff: string;
      verificationCommands?: PatchVerificationCommand[];
      scopeReview?: DiffScopeReviewResult;
    }): PatchTransaction {
      const repoRoot = resolveRepoRoot(input.repoRoot);
      const checkpoint = checkpoints.get(input.checkpointId);
      if (!checkpoint) {
        throw new Error(`Patch checkpoint not found: ${input.checkpointId}`);
      }
      if (checkpoint.repoRoot !== repoRoot) {
        throw new Error("Patch checkpoint repoRoot does not match apply repoRoot");
      }

      const parsed = parseUnifiedDiff(input.unifiedDiff);
      const filesChanged = uniqueSorted(
        parsed.patches.map((patch) => patch.newPath ?? patch.oldPath ?? ""),
      );
      for (const filePath of filesChanged) {
        resolveRepoFile(repoRoot, filePath);
      }
      assertCheckpointFresh(repoRoot, checkpoint, filesChanged);

      const transaction: PatchTransaction = {
        transactionId: `patch:${randomUUID()}`,
        checkpointId: checkpoint.checkpointId,
        repoRoot,
        status: "applied",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        filesChanged,
        rollbackAvailable: true,
        before: filesChanged.map((filePath) => createFileSnapshot(repoRoot, filePath)),
        verification: {
          status: (input.verificationCommands?.length ?? 0) > 0 ? "pending" : "not_required",
          commands: (input.verificationCommands ?? []).map((command) => ({ ...command })),
        },
        ...(input.scopeReview ? { scopeReview: cloneScopeReview(input.scopeReview) } : {}),
      };

      try {
        applyParsedDiff(repoRoot, parsed);
      } catch (error) {
        for (const snapshot of transaction.before) {
          restoreFileSnapshot(repoRoot, snapshot);
        }
        transaction.status = "failed";
        transaction.rollbackAvailable = true;
        transaction.error = error instanceof Error ? error.message : String(error);
        transaction.updatedAt = new Date().toISOString();
        transactions.set(transaction.transactionId, transaction);
        persist();
        throw error;
      }

      transaction.updatedAt = new Date().toISOString();
      transactions.set(transaction.transactionId, transaction);
      persist();
      return cloneTransaction(transaction);
    },

    status(input: { repoRoot?: string; checkpointId?: string; transactionId?: string } = {}): PatchTransactionStatusView {
      const repoRoot = input.repoRoot ? resolveRepoRoot(input.repoRoot) : undefined;
      const filteredCheckpoints = [...checkpoints.values()].filter((checkpoint) => {
        if (repoRoot && checkpoint.repoRoot !== repoRoot) {
          return false;
        }
        return !input.checkpointId || checkpoint.checkpointId === input.checkpointId;
      });
      const filteredTransactions = [...transactions.values()].filter((transaction) => {
        if (repoRoot && transaction.repoRoot !== repoRoot) {
          return false;
        }
        return !input.transactionId || transaction.transactionId === input.transactionId;
      });
      return {
        checkpoints: filteredCheckpoints.map(redactCheckpoint),
        transactions: filteredTransactions.map(redactTransaction),
      };
    },

    rollback(input: { repoRoot: string; transactionId: string }): PatchTransaction {
      const repoRoot = resolveRepoRoot(input.repoRoot);
      const transaction = transactions.get(input.transactionId);
      if (!transaction) {
        throw new Error(`Patch transaction not found: ${input.transactionId}`);
      }
      if (transaction.repoRoot !== repoRoot) {
        throw new Error("Patch transaction repoRoot does not match rollback repoRoot");
      }
      if (!transaction.rollbackAvailable) {
        throw new Error(`Patch transaction cannot be rolled back: ${input.transactionId}`);
      }

      for (const snapshot of transaction.before) {
        restoreFileSnapshot(repoRoot, snapshot);
      }
      transaction.status = "rolled_back";
      transaction.rollbackAvailable = false;
      transaction.updatedAt = new Date().toISOString();
      transactions.set(transaction.transactionId, transaction);
      persist();
      return cloneTransaction(transaction);
    },

    snapshot: snapshotState,
  };
}

function resolveRepoRoot(repoRoot: string): string {
  return path.resolve(repoRoot);
}

function resolveRepoFile(repoRoot: string, relativePath: string): string {
  if (!relativePath.trim()) {
    throw new Error("Patch file path is required");
  }
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, absolutePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Patch path is outside repo root: ${relativePath}`);
  }
  return absolutePath;
}

function repoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(repoPath).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function createFileSnapshot(repoRoot: string, relativePath: string): PatchFileSnapshot {
  const normalizedPath = repoPath(relativePath);
  const absolutePath = resolveRepoFile(repoRoot, normalizedPath);
  if (!existsSync(absolutePath)) {
    return { path: normalizedPath, existed: false };
  }
  const content = readFileSync(absolutePath, "utf8");
  return {
    path: normalizedPath,
    existed: true,
    content,
    hash: sha256(content),
  };
}

function restoreFileSnapshot(repoRoot: string, snapshot: PatchFileSnapshot): void {
  const absolutePath = resolveRepoFile(repoRoot, snapshot.path);
  if (!snapshot.existed) {
    rmSync(absolutePath, { force: true });
    return;
  }
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, snapshot.content ?? "", "utf8");
}

function assertCheckpointFresh(
  repoRoot: string,
  checkpoint: PatchCheckpoint,
  filesChanged: string[],
): void {
  const snapshots = new Map(checkpoint.files.map((file) => [file.path, file]));
  for (const filePath of filesChanged) {
    const checkpointSnapshot = snapshots.get(filePath);
    if (!checkpointSnapshot) {
      continue;
    }
    const current = createFileSnapshot(repoRoot, filePath);
    if (checkpointSnapshot.existed !== current.existed || checkpointSnapshot.hash !== current.hash) {
      throw new Error(`Patch checkpoint is stale for ${filePath}`);
    }
  }
}

function parseUnifiedDiff(diff: string): ParsedDiff {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const patches: FilePatch[] = [];
  let current: FilePatch | undefined;
  let currentHunk: Hunk | undefined;

  function ensureCurrent(): FilePatch {
    if (!current) {
      current = { hunks: [] };
      patches.push(current);
    }
    return current;
  }

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
      current = {
        oldPath: match?.[1] ? repoPath(match[1]) : undefined,
        newPath: match?.[2] ? repoPath(match[2]) : undefined,
        hunks: [],
      };
      patches.push(current);
      currentHunk = undefined;
      continue;
    }

    if (line.startsWith("--- ")) {
      ensureCurrent().oldPath = parseDiffPath(line.slice(4), "a");
      continue;
    }

    if (line.startsWith("+++ ")) {
      ensureCurrent().newPath = parseDiffPath(line.slice(4), "b");
      continue;
    }

    if (line.startsWith("@@ ")) {
      currentHunk = parseHunkHeader(line);
      ensureCurrent().hunks.push(currentHunk);
      continue;
    }

    if (currentHunk && isPatchLine(line)) {
      currentHunk.lines.push(line);
    }
  }

  const usablePatches = patches.filter((patch) => patch.hunks.length > 0);
  if (usablePatches.length === 0) {
    throw new Error("Unified diff did not contain any hunks");
  }
  return { patches: usablePatches };
}

function parseDiffPath(rawPath: string, prefix: "a" | "b"): string | undefined {
  const trimmed = rawPath.trim();
  if (trimmed === "/dev/null") {
    return undefined;
  }
  return repoPath(trimmed.replace(new RegExp(`^${prefix}/`), ""));
}

function parseHunkHeader(header: string): Hunk {
  const match = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!match) {
    throw new Error(`Invalid unified diff hunk header: ${header}`);
  }
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? "1"),
    lines: [],
  };
}

function isPatchLine(line: string): boolean {
  return (
    line.startsWith(" ") ||
    line.startsWith("-") ||
    line.startsWith("+") ||
    line.startsWith("\\ No newline")
  );
}

function applyParsedDiff(repoRoot: string, diff: ParsedDiff): void {
  const operations: Array<
    | { kind: "delete"; absolutePath: string }
    | { kind: "write"; absolutePath: string; content: string }
  > = [];

  for (const patch of diff.patches) {
    const targetPath = patch.newPath ?? patch.oldPath;
    if (!targetPath) {
      throw new Error("Patch file target is missing");
    }
    const absolutePath = resolveRepoFile(repoRoot, targetPath);
    const originalContent = existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
    const nextContent = applyFilePatch(originalContent, patch);
    if (patch.newPath === undefined) {
      operations.push({ kind: "delete", absolutePath });
      continue;
    }
    operations.push({ kind: "write", absolutePath, content: nextContent });
  }

  for (const operation of operations) {
    if (operation.kind === "delete") {
      rmSync(operation.absolutePath, { force: true });
      continue;
    }
    mkdirSync(path.dirname(operation.absolutePath), { recursive: true });
    writeFileSync(operation.absolutePath, operation.content, "utf8");
  }
}

function applyFilePatch(content: string, patch: FilePatch): string {
  const { lines, trailingNewline } = splitContentLines(content);
  const output: string[] = [];
  let oldIndex = 0;

  for (const hunk of patch.hunks) {
    const hunkStart = Math.max(0, hunk.oldStart - 1);
    while (oldIndex < hunkStart) {
      output.push(lines[oldIndex] ?? "");
      oldIndex += 1;
    }

    for (const line of hunk.lines) {
      if (line.startsWith("\\ No newline")) {
        continue;
      }
      const marker = line[0];
      const value = line.slice(1);
      if (marker === " ") {
        assertLineMatch(lines[oldIndex], value, patch);
        output.push(value);
        oldIndex += 1;
        continue;
      }
      if (marker === "-") {
        assertLineMatch(lines[oldIndex], value, patch);
        oldIndex += 1;
        continue;
      }
      if (marker === "+") {
        output.push(value);
      }
    }
  }

  while (oldIndex < lines.length) {
    output.push(lines[oldIndex] ?? "");
    oldIndex += 1;
  }

  const next = output.join("\n");
  return trailingNewline || content.length === 0 ? `${next}\n` : next;
}

function assertLineMatch(actual: string | undefined, expected: string, patch: FilePatch): void {
  if (actual !== expected) {
    throw new Error(
      `Patch hunk did not match ${patch.newPath ?? patch.oldPath}: expected ${JSON.stringify(
        expected,
      )}, found ${JSON.stringify(actual)}`,
    );
  }
}

function splitContentLines(content: string): { lines: string[]; trailingNewline: boolean } {
  const normalized = content.replace(/\r\n/g, "\n");
  const trailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (trailingNewline) {
    lines.pop();
  }
  return { lines, trailingNewline };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function cloneCheckpoint(checkpoint: PatchCheckpoint): PatchCheckpoint {
  return {
    ...checkpoint,
    files: checkpoint.files.map((file) => ({ ...file })),
  };
}

function cloneTransaction(transaction: PatchTransaction): PatchTransaction {
  return {
    ...transaction,
    filesChanged: [...transaction.filesChanged],
    before: transaction.before.map((file) => ({ ...file })),
    verification: {
      status: transaction.verification.status,
      commands: transaction.verification.commands.map((command) => ({ ...command })),
    },
    ...(transaction.scopeReview ? { scopeReview: cloneScopeReview(transaction.scopeReview) } : {}),
  };
}

function cloneScopeReview(review: DiffScopeReviewResult): DiffScopeReviewResult {
  return {
    ...review,
    changedFiles: [...review.changedFiles],
    findings: review.findings.map((finding) => ({ ...finding })),
  };
}

function redactCheckpoint(
  checkpoint: PatchCheckpoint,
): PatchTransactionStatusView["checkpoints"][number] {
  return {
    ...checkpoint,
    files: checkpoint.files.map(({ content: _content, ...file }) => file),
  };
}

function redactTransaction(
  transaction: PatchTransaction,
): PatchTransactionStatusView["transactions"][number] {
  return {
    ...transaction,
    before: transaction.before.map(({ content: _content, ...file }) => file),
  };
}
