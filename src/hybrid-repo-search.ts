import path from "node:path";
import {
  durableIndexStatus,
  queryDurableShardedRepoIndex,
} from "./durable-index-store.js";
import {
  searchGraphNodeSemanticIndex,
  type GraphNodeKind,
} from "./graph-node-semantic.js";
import { queryRepoRelations } from "./relation-query.js";

export type HybridRepoSearchSource =
  | "lexical"
  | "sqlite"
  | "semantic"
  | "relation"
  | "graph_distance";

export type HybridRepoSearchResult = {
  query: string;
  repoRoot: string;
  fingerprint?: string;
  results: Array<{
    path: string;
    line?: number;
    kind: "file" | "symbol" | "community" | "flow";
    title: string;
    score: number;
    sources: HybridRepoSearchSource[];
    evidence: string[];
    excerpt: string;
  }>;
  warnings: string[];
};

type HybridResultItem = HybridRepoSearchResult["results"][number];

export function hybridRepoSearch(input: {
  repoRoot: string;
  query: string;
  changedFiles?: string[];
  limit?: number;
  requireFresh?: boolean;
}): HybridRepoSearchResult {
  const repoRoot = path.resolve(input.repoRoot);
  const limit = normalizeLimit(input.limit);
  const status = durableIndexStatus({ repoRoot });
  const fingerprint = status.repoIndex?.summary.indexHealth.fingerprint ?? status.sqliteIndex?.summary.indexHealth.fingerprint;
  const warnings: string[] = [];
  const byKey = new Map<string, HybridResultItem>();

  const lexical = queryDurableShardedRepoIndex({
    repoRoot,
    query: input.query,
    limit: Math.max(limit * 2, 10),
    requireFresh: input.requireFresh,
  });
  warnings.push(...lexical.warnings);
  for (const result of lexical.results) {
    addResult(byKey, {
      path: result.path,
      ...(result.line === undefined ? {} : { line: result.line }),
      kind: result.kind,
      title: result.title,
      score: normalizeScore(result.score),
      sources: uniqueSources(["lexical", lexical.usedSqlite ? "sqlite" : "lexical"]),
      evidence: [`${lexical.retrievalMode ?? "repo_index"}:${result.title}`],
      excerpt: result.excerpt,
    }, input.query);
  }

  const semantic = searchGraphNodeSemanticIndex({
    repoRoot,
    query: input.query,
    limit: Math.max(limit * 2, 10),
    ...(fingerprint ? { currentFingerprint: fingerprint } : {}),
  });
  if (semantic.refused) {
    warnings.push(semantic.reason ?? "Graph-node semantic index is unavailable.");
    if (semantic.hint) {
      warnings.push(semantic.hint);
    }
  } else {
    for (const result of semantic.results) {
      if (!result.path && result.kind !== "community") {
        continue;
      }
      const itemPath = result.path ?? result.id;
      addResult(byKey, {
        path: itemPath,
        kind: graphKindToHybridKind(result.kind),
        title: result.id,
        score: normalizeScore(result.score),
        sources: ["semantic"],
        evidence: [`semantic:${semantic.provider}:${result.id}`],
        excerpt: result.excerpt,
      }, input.query);
    }
  }

  for (const changedFile of uniqueSorted((input.changedFiles ?? []).map(toRepoPath))) {
    const relations = queryRepoRelations({
      repoRoot,
      from: changedFile,
      direction: "both",
      maxDepth: 1,
      limit: 50,
      requireFresh: input.requireFresh,
    });
    warnings.push(...relations.warnings);
    for (const edge of relations.edges) {
      const relatedPath = relatedPathFor(changedFile, edge.from, edge.to);
      if (!relatedPath) {
        continue;
      }
      addResult(byKey, {
        path: relatedPath,
        kind: "file",
        title: relatedPath,
        score: 0.2,
        sources: ["relation", "graph_distance"],
        evidence: [`relation:${edge.from}-${edge.kind}->${edge.to}`],
        excerpt: `Related to changed file ${changedFile} by ${edge.kind}.`,
      }, input.query);
    }
  }

  const results = [...byKey.values()]
    .map((result) => ({
      ...result,
      score: finalScore(result, input.query),
      sources: uniqueSources(result.sources),
      evidence: uniqueSorted(result.evidence),
    }))
    .sort(compareResults)
    .slice(0, limit);

  return {
    query: input.query,
    repoRoot,
    ...(fingerprint ? { fingerprint } : {}),
    results,
    warnings: uniqueSorted(warnings),
  };
}

function addResult(
  byKey: Map<string, HybridResultItem>,
  item: HybridResultItem,
  query: string,
): void {
  const key = resultKey(item);
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, item);
    return;
  }
  byKey.set(key, {
    ...existing,
    score: Math.max(existing.score, item.score),
    sources: uniqueSources([...existing.sources, ...item.sources]),
    evidence: uniqueSorted([...existing.evidence, ...item.evidence]),
    excerpt: existing.excerpt.length >= item.excerpt.length ? existing.excerpt : item.excerpt,
  });

  const merged = byKey.get(key);
  if (merged && exactMatchBonus(merged, query) > 0) {
    byKey.set(key, { ...merged, score: merged.score + exactMatchBonus(merged, query) });
  }
}

function resultKey(item: HybridResultItem): string {
  if (item.kind === "file") {
    return `${item.kind}:${item.path}`;
  }
  return `${item.kind}:${item.path}:${item.line ?? ""}:${item.title}`;
}

function finalScore(result: HybridResultItem, query: string): number {
  const sourceAgreement = result.sources.length > 1 ? 0.15 : 0;
  return Number((result.score + exactMatchBonus(result, query) + relationBonus(result) + sourceAgreement).toFixed(4));
}

function exactMatchBonus(result: HybridResultItem, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return 0;
  }
  const titleHaystack = `${result.path} ${result.title}`.toLowerCase();
  if (result.kind === "symbol" && titleHaystack.includes(needle)) {
    return 0.7;
  }
  const haystack = `${titleHaystack} ${result.excerpt}`.toLowerCase();
  return haystack.includes(needle) ? 0.3 : 0;
}

function relationBonus(result: HybridResultItem): number {
  return result.sources.includes("relation") || result.sources.includes("graph_distance") ? 0.2 : 0;
}

function normalizeScore(score: number): number {
  if (!Number.isFinite(score) || score <= 0) {
    return 0;
  }
  return Math.min(1, score / Math.max(score, 20));
}

function graphKindToHybridKind(kind: GraphNodeKind): HybridResultItem["kind"] {
  if (kind === "community" || kind === "flow" || kind === "symbol") {
    return kind;
  }
  return "file";
}

function relatedPathFor(changedFile: string, from: string, to: string): string | undefined {
  const fromPath = pathFromEndpoint(from);
  const toPath = pathFromEndpoint(to);
  if (fromPath === changedFile) {
    return toPath;
  }
  if (toPath === changedFile) {
    return fromPath;
  }
  return fromPath ?? toPath;
}

function pathFromEndpoint(endpoint: string): string | undefined {
  if (endpoint.startsWith("file:")) {
    return endpoint.slice("file:".length);
  }
  if (endpoint.startsWith("symbol:")) {
    return endpoint.slice("symbol:".length).split("#", 1)[0];
  }
  return undefined;
}

function compareResults(left: HybridResultItem, right: HybridResultItem): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return (
    left.path.localeCompare(right.path) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.title.localeCompare(right.title)
  );
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 10;
  }
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function uniqueSources(values: HybridRepoSearchSource[]): HybridRepoSearchSource[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
