import { createHash } from "node:crypto";

export type SemanticRecordInput = {
  id: string;
  path?: string;
  text: string;
};

export type SemanticIndexRecord = SemanticRecordInput & {
  tokens: string[];
};

export type SemanticIndex = {
  indexId: string;
  provider: "deterministic-token-overlap";
  records: SemanticIndexRecord[];
};

export type SemanticSearchResult = {
  query: string;
  provider: SemanticIndex["provider"];
  results: Array<{
    id: string;
    path?: string;
    score: number;
    excerpt: string;
  }>;
};

export function buildSemanticIndex(input: {
  records: SemanticRecordInput[];
}): SemanticIndex {
  const records = input.records.map((record) => ({
    ...record,
    tokens: tokenize(record.text),
  }));
  return {
    indexId: `semantic:${createHash("sha256")
      .update(JSON.stringify(records.map((record) => [record.id, record.path, record.text])))
      .digest("hex")
      .slice(0, 16)}`,
    provider: "deterministic-token-overlap",
    records,
  };
}

export function semanticSearch(
  index: SemanticIndex,
  input: { query: string; limit?: number },
): SemanticSearchResult {
  const queryTokens = tokenize(input.query);
  if (queryTokens.length === 0) {
    return { query: input.query, provider: index.provider, results: [] };
  }
  const limit = input.limit ?? 10;
  const querySet = new Set(queryTokens);
  const results = index.records
    .map((record) => {
      const recordSet = new Set(record.tokens);
      const overlap = [...querySet].filter((token) => recordSet.has(token)).length;
      const exactPhraseBoost = record.text.toLowerCase().includes(input.query.toLowerCase().trim()) ? 2 : 0;
      const score = overlap / Math.max(querySet.size, 1) + exactPhraseBoost;
      return {
        id: record.id,
        path: record.path,
        score,
        excerpt: excerpt(record.text),
      };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, limit);
  return { query: input.query, provider: index.provider, results };
}

function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length > 1)
        .map(stemToken),
    ),
  ].sort();
}

function stemToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function excerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}
