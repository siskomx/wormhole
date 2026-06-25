import { createHash, randomUUID } from "node:crypto";

export type AgentWorkspaceVisibility = "shared" | "private";

export type AgentWorkspace = {
  workspaceId: string;
  missionId: string;
  objective?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentWorkspaceRecord = {
  recordId: string;
  workspaceId: string;
  missionId: string;
  runId?: string;
  key: string;
  value: unknown;
  valueType: string;
  contentHash: string;
  visibility: AgentWorkspaceVisibility;
  provenance?: {
    sourceTool?: string;
    evidenceIds?: string[];
    artifactIds?: string[];
  };
  createdAt: string;
  updatedAt: string;
};

export type AgentWorkspaceConflict = {
  key: string;
  recordIds: string[];
  contentHashes: string[];
  runIds: string[];
};

export type AgentWorkspaceSnapshot = {
  workspaces: AgentWorkspace[];
  records: AgentWorkspaceRecord[];
};

export type AgentWorkspaceCreateInput = {
  missionId: string;
  objective?: string;
};

export type AgentWorkspaceWriteInput = {
  workspaceId: string;
  runId?: string;
  key: string;
  value: unknown;
  visibility?: AgentWorkspaceVisibility;
  provenance?: AgentWorkspaceRecord["provenance"];
};

export type AgentWorkspaceReadInput = {
  workspaceId: string;
  key?: string;
  runId?: string;
  visibility?: AgentWorkspaceVisibility;
};

export type AgentWorkspaceMergeInput = {
  workspaceId: string;
  runIds?: string[];
};

export type AgentWorkspaceReadResult = {
  workspace: AgentWorkspace;
  records: AgentWorkspaceRecord[];
};

export type AgentWorkspaceMergeResult = AgentWorkspaceReadResult & {
  mergedRecords: AgentWorkspaceRecord[];
  conflicts: AgentWorkspaceConflict[];
};

export type AgentWorkspaceStore = {
  create(input: AgentWorkspaceCreateInput): AgentWorkspace;
  write(input: AgentWorkspaceWriteInput): AgentWorkspaceRecord;
  read(input: AgentWorkspaceReadInput): AgentWorkspaceReadResult;
  merge(input: AgentWorkspaceMergeInput): AgentWorkspaceMergeResult;
  snapshot(): AgentWorkspaceSnapshot;
};

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

function cloneWorkspace(workspace: AgentWorkspace): AgentWorkspace {
  return { ...workspace };
}

function cloneRecord(record: AgentWorkspaceRecord): AgentWorkspaceRecord {
  return {
    ...record,
    provenance: record.provenance
      ? {
          ...record.provenance,
          evidenceIds: record.provenance.evidenceIds ? [...record.provenance.evidenceIds] : undefined,
          artifactIds: record.provenance.artifactIds ? [...record.provenance.artifactIds] : undefined,
        }
      : undefined,
  };
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

export function createAgentWorkspaceStore(
  snapshot: Partial<AgentWorkspaceSnapshot> = {},
  onChange?: (snapshot: AgentWorkspaceSnapshot) => void,
): AgentWorkspaceStore {
  const workspaces = new Map<string, AgentWorkspace>(
    (snapshot.workspaces ?? []).map((workspace) => [workspace.workspaceId, cloneWorkspace(workspace)]),
  );
  const records = new Map<string, AgentWorkspaceRecord>(
    (snapshot.records ?? []).map((record) => [record.recordId, cloneRecord(record)]),
  );

  function snapshotState(): AgentWorkspaceSnapshot {
    return {
      workspaces: [...workspaces.values()].map(cloneWorkspace),
      records: [...records.values()].map(cloneRecord),
    };
  }

  function notifyChange(): void {
    onChange?.(snapshotState());
  }

  function getWorkspace(workspaceId: string): AgentWorkspace {
    const workspace = workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Agent workspace not found: ${workspaceId}`);
    }
    return workspace;
  }

  function readRecords(input: AgentWorkspaceReadInput): AgentWorkspaceRecord[] {
    return [...records.values()]
      .filter((record) => record.workspaceId === input.workspaceId)
      .filter((record) => !input.key || record.key === input.key)
      .filter((record) => !input.runId || record.runId === input.runId)
      .filter((record) => !input.visibility || record.visibility === input.visibility)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.recordId.localeCompare(right.recordId))
      .map(cloneRecord);
  }

  return {
    create(input) {
      const now = new Date().toISOString();
      const workspace: AgentWorkspace = {
        workspaceId: `agentws:${randomUUID()}`,
        missionId: input.missionId,
        objective: input.objective,
        createdAt: now,
        updatedAt: now,
      };
      workspaces.set(workspace.workspaceId, workspace);
      notifyChange();
      return cloneWorkspace(workspace);
    },

    write(input) {
      const workspace = getWorkspace(input.workspaceId);
      const now = new Date().toISOString();
      const contentHash = sha256(stableStringify(input.value));
      const record: AgentWorkspaceRecord = {
        recordId: `agentwsrec:${randomUUID()}`,
        workspaceId: input.workspaceId,
        missionId: workspace.missionId,
        runId: input.runId,
        key: input.key,
        value: input.value,
        valueType: valueType(input.value),
        contentHash,
        visibility: input.visibility ?? "shared",
        provenance: input.provenance
          ? {
              ...input.provenance,
              evidenceIds: input.provenance.evidenceIds ? [...input.provenance.evidenceIds] : undefined,
              artifactIds: input.provenance.artifactIds ? [...input.provenance.artifactIds] : undefined,
            }
          : undefined,
        createdAt: now,
        updatedAt: now,
      };
      workspace.updatedAt = now;
      records.set(record.recordId, record);
      notifyChange();
      return cloneRecord(record);
    },

    read(input) {
      return {
        workspace: cloneWorkspace(getWorkspace(input.workspaceId)),
        records: readRecords(input),
      };
    },

    merge(input) {
      const workspace = getWorkspace(input.workspaceId);
      const runSet = new Set(input.runIds ?? []);
      const candidates = readRecords({ workspaceId: input.workspaceId, visibility: "shared" })
        .filter((record) => runSet.size === 0 || (record.runId && runSet.has(record.runId)));
      const byKey = new Map<string, AgentWorkspaceRecord[]>();
      for (const record of candidates) {
        byKey.set(record.key, [...(byKey.get(record.key) ?? []), record]);
      }
      const conflicts: AgentWorkspaceConflict[] = [];
      const mergedRecords: AgentWorkspaceRecord[] = [];
      for (const [key, groupedRecords] of [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        const contentHashes = [...new Set(groupedRecords.map((record) => record.contentHash))].sort();
        if (contentHashes.length > 1) {
          conflicts.push({
            key,
            recordIds: groupedRecords.map((record) => record.recordId).sort(),
            contentHashes,
            runIds: [...new Set(groupedRecords.map((record) => record.runId).filter(Boolean) as string[])].sort(),
          });
          continue;
        }
        mergedRecords.push(
          [...groupedRecords].sort(
            (left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.recordId.localeCompare(left.recordId),
          )[0],
        );
      }
      return {
        workspace: cloneWorkspace(workspace),
        records: candidates.map(cloneRecord),
        mergedRecords: mergedRecords.map(cloneRecord),
        conflicts,
      };
    },

    snapshot: snapshotState,
  };
}
