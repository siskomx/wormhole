import { createHash } from "node:crypto";
import { classifySourceProvenance, type SourceProvenance } from "./source-authority.js";

export type ContextSourceType = "file" | "doc" | "command" | "user" | "derived";

export type ContextRecordInput = {
  source: string;
  sourceType: ContextSourceType;
  text: string;
  tags?: string[];
  sourceAuthority?: SourceProvenance;
};

export type ContextRecord = Omit<ContextRecordInput, "sourceAuthority"> & {
  sourceAuthority: SourceProvenance;
  contextId: string;
  contentHash: string;
  recordedAt: string;
  charCount: number;
};

export type ContextQueryInput = {
  query: string;
  limit?: number;
};

export type ContextQueryResult = {
  query: string;
  results: Array<ContextRecord & { score: number; excerpt: string }>;
};

export type ContextPackInput = {
  objective: string;
  query: string;
  maxChars: number;
  recordIds?: string[];
};

export type ContextPackBudgetReviewInput = ContextPackInput & {
  pinnedRecordIds?: string[];
  staleRecordIds?: string[];
  changedFiles?: string[];
};

export type ContextPackBudgetDecision = {
  contextId: string;
  source: string;
  reason: "pinned" | "changed_file" | "query_match" | "budget" | "stale";
  priority: number;
  charCount: number;
};

export type ContextPackBudgetReview = {
  objective: string;
  query: string;
  retained: ContextPackBudgetDecision[];
  evicted: ContextPackBudgetDecision[];
  stats: {
    charBudget: number;
    retainedChars: number;
    retainedCount: number;
    evictedCount: number;
  };
};

export type ContextPackRefreshResult = {
  review: ContextPackBudgetReview;
  pack: ContextPack;
};

export type ContextPack = {
  packId: string;
  objective: string;
  query: string;
  contextIds: string[];
  rendered: string;
  stats: {
    includedCount: number;
    omittedCount: number;
    charBudget: number;
    renderedChars: number;
  };
};

export type ContextStoreSnapshot = {
  records: ContextRecord[];
  packs: ContextPack[];
};

export type ContextStore = {
  record(input: ContextRecordInput): ContextRecord;
  query(input: ContextQueryInput): ContextQueryResult;
  createPack(input: ContextPackInput): ContextPack;
  reviewPackBudget(input: ContextPackBudgetReviewInput): ContextPackBudgetReview;
  refreshPack(input: ContextPackBudgetReviewInput): ContextPackRefreshResult;
  renderPack(input: { packId: string }): string;
  snapshot(): ContextStoreSnapshot;
};

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function contextIdFor(input: ContextRecordInput): string {
  return `ctx:${sha256(`${input.source}\n${input.sourceType}\n${input.text}`)}`;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_$]+/i)
    .filter(Boolean);
}

function scoreRecord(record: ContextRecord, query: string): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return 0;
  }
  const haystack = `${record.source} ${record.tags?.join(" ") ?? ""} ${record.text}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function authorityScore(record: ContextRecord): number {
  return record.sourceAuthority.authorityScore;
}

function excerpt(text: string, maxChars = 180): string {
  const compacted = text.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxChars) {
    return compacted;
  }
  return `${compacted.slice(0, maxChars - 3).trimEnd()}...`;
}

function renderPack(objective: string, records: ContextRecord[]): string {
  return [
    `# Context Pack`,
    ``,
    `Objective: ${objective}`,
    ``,
    ...records.flatMap((record, index) => [
      `[${index + 1}] ${record.source}`,
      `id: ${record.contextId}`,
      `tags: ${(record.tags ?? []).join(", ") || "none"}`,
      ``,
      record.text,
      ``,
    ]),
  ].join("\n");
}

function cloneRecord(record: ContextRecord): ContextRecord {
  return {
    ...record,
    tags: record.tags ? [...record.tags] : undefined,
  };
}

function clonePack(pack: ContextPack): ContextPack {
  return {
    ...pack,
    contextIds: [...pack.contextIds],
    stats: { ...pack.stats },
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function sourceMatchesChangedFile(source: string, changedFiles: Set<string>): boolean {
  const normalizedSource = normalizePath(source);
  return changedFiles.has(normalizedSource);
}

export function createContextStore(
  snapshot: Partial<ContextStoreSnapshot> = {},
  onChange?: (snapshot: ContextStoreSnapshot) => void,
): ContextStore {
  const records = new Map<string, ContextRecord>(
    (snapshot.records ?? []).map((record) => [record.contextId, cloneRecord(record)]),
  );
  const packs = new Map<string, ContextPack>(
    (snapshot.packs ?? []).map((pack) => [pack.packId, clonePack(pack)]),
  );

  function snapshotState(): ContextStoreSnapshot {
    return {
      records: [...records.values()].map(cloneRecord),
      packs: [...packs.values()].map(clonePack),
    };
  }

  function emitChange(): void {
    onChange?.(snapshotState());
  }

  function rankedRecords(input: ContextQueryInput): Array<ContextRecord & { score: number; excerpt: string }> {
    const limit = input.limit ?? 10;
    return [...records.values()]
      .map((record) => ({
        ...record,
        score: scoreRecord(record, input.query),
        excerpt: excerpt(record.text),
      }))
      .filter((record) => record.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        const authorityDelta = authorityScore(right) - authorityScore(left);
        if (authorityDelta !== 0) {
          return authorityDelta;
        }
        return left.source.localeCompare(right.source);
      })
      .slice(0, limit);
  }

  function recordsForPackInput(input: ContextPackInput): ContextRecord[] {
    return input.recordIds && input.recordIds.length > 0
      ? input.recordIds
          .map((contextId) => records.get(contextId))
          .filter((record): record is ContextRecord => Boolean(record))
      : rankedRecords({ query: `${input.objective} ${input.query}`, limit: records.size })
          .map((record) => records.get(record.contextId))
          .filter((record): record is ContextRecord => Boolean(record));
  }

  function reviewPackBudget(input: ContextPackBudgetReviewInput): ContextPackBudgetReview {
    const pinnedIds = new Set(input.pinnedRecordIds ?? []);
    const staleIds = new Set(input.staleRecordIds ?? []);
    const changedFiles = new Set((input.changedFiles ?? []).map(normalizePath));
    const query = `${input.objective} ${input.query}`;
    const scored = recordsForPackInput(input)
      .map((record) => {
        const pinned = pinnedIds.has(record.contextId);
        const stale = staleIds.has(record.contextId);
        const changed = sourceMatchesChangedFile(record.source, changedFiles);
        const queryScore = scoreRecord(record, query);
        const priority =
          (pinned ? 1_000 : 0) +
          (changed ? 100 : 0) +
          queryScore * 10 +
          authorityScore(record) -
          (stale ? 10_000 : 0);
        const reason: ContextPackBudgetDecision["reason"] = stale
          ? "stale"
          : pinned
            ? "pinned"
            : changed
              ? "changed_file"
              : "query_match";
        return { record, priority, reason };
      })
      .sort((left, right) => {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }
        const dateCompare = right.record.recordedAt.localeCompare(left.record.recordedAt);
        if (dateCompare !== 0) {
          return dateCompare;
        }
        return left.record.source.localeCompare(right.record.source);
      });

    const retained: ContextPackBudgetDecision[] = [];
    const evicted: ContextPackBudgetDecision[] = [];
    let retainedChars = 0;
    for (const candidate of scored) {
      const decision = {
        contextId: candidate.record.contextId,
        source: candidate.record.source,
        reason: candidate.reason,
        priority: candidate.priority,
        charCount: candidate.record.charCount,
      };
      if (candidate.reason === "stale") {
        evicted.push(decision);
        continue;
      }
      if (retainedChars + candidate.record.charCount <= input.maxChars || retained.length === 0) {
        retained.push(decision);
        retainedChars += candidate.record.charCount;
        continue;
      }
      evicted.push({ ...decision, reason: "budget" });
    }

    return {
      objective: input.objective,
      query: input.query,
      retained,
      evicted,
      stats: {
        charBudget: input.maxChars,
        retainedChars,
        retainedCount: retained.length,
        evictedCount: evicted.length,
      },
    };
  }

  return {
    record(input: ContextRecordInput): ContextRecord {
      const contentHash = sha256(input.text);
      const record: ContextRecord = {
        ...input,
        tags: input.tags ? [...input.tags].sort() : undefined,
        contextId: contextIdFor(input),
        contentHash,
        sourceAuthority:
          input.sourceAuthority ??
          classifySourceProvenance({
            sourcePath: input.source,
            sourceHash: contentHash,
            authority: sourceAuthorityForContextSourceType(input.sourceType),
          }),
        recordedAt: new Date().toISOString(),
        charCount: input.text.length,
      };
      records.set(record.contextId, record);
      emitChange();
      return cloneRecord(record);
    },

    query(input: ContextQueryInput): ContextQueryResult {
      return {
        query: input.query,
        results: rankedRecords(input),
      };
    },

    createPack(input: ContextPackInput): ContextPack {
      const candidates = recordsForPackInput(input);
      const included: ContextRecord[] = [];
      let usedChars = 0;
      for (const record of candidates) {
        const nextSize = record.text.length + record.source.length + 64;
        if (included.length > 0 && usedChars + nextSize > input.maxChars) {
          continue;
        }
        included.push(record);
        usedChars += nextSize;
      }
      const rendered = renderPack(input.objective, included);
      const packId = `ctxpack:${sha256(
        `${input.objective}\n${input.query}\n${input.maxChars}\n${included
          .map((record) => record.contextId)
          .join("\n")}`,
      )}`;
      const pack: ContextPack = {
        packId,
        objective: input.objective,
        query: input.query,
        contextIds: included.map((record) => record.contextId),
        rendered,
        stats: {
          includedCount: included.length,
          omittedCount: Math.max(0, candidates.length - included.length),
          charBudget: input.maxChars,
          renderedChars: rendered.length,
        },
      };
      packs.set(packId, pack);
      emitChange();
      return clonePack(pack);
    },

    reviewPackBudget,

    refreshPack(input: ContextPackBudgetReviewInput): ContextPackRefreshResult {
      const review = reviewPackBudget(input);
      const pack = this.createPack({
        objective: input.objective,
        query: input.query,
        maxChars: input.maxChars,
        recordIds: review.retained.map((decision) => decision.contextId),
      });
      return { review, pack };
    },

    renderPack(input: { packId: string }): string {
      const pack = packs.get(input.packId);
      if (!pack) {
        throw new Error(`Context pack not found: ${input.packId}`);
      }
      return pack.rendered;
    },

    snapshot: snapshotState,
  };
}

function sourceAuthorityForContextSourceType(sourceType: ContextSourceType): SourceProvenance["authority"] | undefined {
  if (sourceType === "doc") {
    return "supporting_doc";
  }
  if (sourceType === "command" || sourceType === "derived") {
    return "derived_code_fact";
  }
  return undefined;
}
