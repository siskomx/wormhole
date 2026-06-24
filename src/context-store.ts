import { createHash } from "node:crypto";

export type ContextSourceType = "file" | "doc" | "command" | "user" | "derived";

export type ContextRecordInput = {
  source: string;
  sourceType: ContextSourceType;
  text: string;
  tags?: string[];
};

export type ContextRecord = ContextRecordInput & {
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

export type ContextStore = {
  record(input: ContextRecordInput): ContextRecord;
  query(input: ContextQueryInput): ContextQueryResult;
  createPack(input: ContextPackInput): ContextPack;
  renderPack(input: { packId: string }): string;
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

export function createContextStore(): ContextStore {
  const records = new Map<string, ContextRecord>();
  const packs = new Map<string, ContextPack>();

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
        return left.source.localeCompare(right.source);
      })
      .slice(0, limit);
  }

  return {
    record(input: ContextRecordInput): ContextRecord {
      const record: ContextRecord = {
        ...input,
        tags: input.tags ? [...input.tags].sort() : undefined,
        contextId: contextIdFor(input),
        contentHash: sha256(input.text),
        recordedAt: new Date().toISOString(),
        charCount: input.text.length,
      };
      records.set(record.contextId, record);
      return { ...record, tags: record.tags ? [...record.tags] : undefined };
    },

    query(input: ContextQueryInput): ContextQueryResult {
      return {
        query: input.query,
        results: rankedRecords(input),
      };
    },

    createPack(input: ContextPackInput): ContextPack {
      const candidates =
        input.recordIds && input.recordIds.length > 0
          ? input.recordIds
              .map((contextId) => records.get(contextId))
              .filter((record): record is ContextRecord => Boolean(record))
          : rankedRecords({ query: `${input.objective} ${input.query}`, limit: records.size }).map(
              (record) => records.get(record.contextId),
            ).filter((record): record is ContextRecord => Boolean(record));
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
      return { ...pack, contextIds: [...pack.contextIds], stats: { ...pack.stats } };
    },

    renderPack(input: { packId: string }): string {
      const pack = packs.get(input.packId);
      if (!pack) {
        throw new Error(`Context pack not found: ${input.packId}`);
      }
      return pack.rendered;
    },
  };
}
