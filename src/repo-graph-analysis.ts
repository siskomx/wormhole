import {
  createRepoIndexHealth,
  summarizeRepoIndex,
  type RepoIndex,
  type RepoIndexEdge,
  type RepoIndexSymbol,
} from "./repo-index.js";
import { supportedTreeSitterLanguages } from "./tree-sitter-loader.js";

export type RepoGraphAnalyzeInput = {
  index: RepoIndex;
  changedFiles?: string[];
  limit?: number;
};

export type RepoGraphNodeMetric = {
  id: string;
  label: string;
  kind: "file" | "symbol" | "external";
  path?: string;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
};

export type RepoGraphCycle = {
  size: number;
  nodes: string[];
};

export type RepoGraphAffectedFlow = {
  source: string;
  reachableCount: number;
  nodes: string[];
  truncated: boolean;
};

export type RepoGraphParserCoverage = {
  totalFiles: number;
  treeSitterFiles: number;
  fallbackFiles: number;
  supportedLanguages: string[];
  byLanguage: Record<
    string,
    {
      totalFiles: number;
      treeSitterFiles: number;
      fallbackFiles: number;
      fallbackReasons: string[];
    }
  >;
};

export type RepoGraphAnalysis = {
  repoRoot: string;
  indexHealth: ReturnType<typeof createRepoIndexHealth>;
  summary: ReturnType<typeof summarizeRepoIndex>;
  hubs: RepoGraphNodeMetric[];
  bridges: RepoGraphNodeMetric[];
  cycles: RepoGraphCycle[];
  disconnectedFiles: string[];
  orphanSymbols: Array<{ id: string; name: string; kind: string; path: string; line: number }>;
  affectedFlows: RepoGraphAffectedFlow[];
  parserCoverage: RepoGraphParserCoverage;
  truncated: boolean;
  warnings: string[];
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_CHANGED_FILES = 50;
const MAX_TRAVERSAL_NODES = 5_000;

export function analyzeRepoGraph(input: RepoGraphAnalyzeInput): RepoGraphAnalysis {
  const limit = clampLimit(input.limit);
  const warnings: string[] = [];
  const changedFiles = uniqueSorted(input.changedFiles ?? []).slice(0, MAX_CHANGED_FILES);
  if ((input.changedFiles?.length ?? 0) > MAX_CHANGED_FILES) {
    warnings.push(
      `GRAPH_ANALYZE_TRUNCATED: analyzed ${MAX_CHANGED_FILES}/${input.changedFiles?.length ?? 0} changed files.`,
    );
  }

  const nodeIds = collectNodeIds(input.index);
  const degrees = calculateDegrees(input.index.edges, nodeIds);
  const metrics = [...nodeIds]
    .map((id) => metricForNode(input.index, id, degrees))
    .sort((left, right) => {
      if (right.totalDegree !== left.totalDegree) {
        return right.totalDegree - left.totalDegree;
      }
      return left.label.localeCompare(right.label);
    });
  const bridges = metrics
    .filter((metric) => metric.inDegree > 0 && metric.outDegree > 0)
    .sort((left, right) => {
      const rightScore = right.inDegree * right.outDegree;
      const leftScore = left.inDegree * left.outDegree;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left.label.localeCompare(right.label);
    })
    .slice(0, limit);

  const cycles = findCycles(input.index, limit);
  const nonDefineEdges = input.index.edges.filter((edge) => edge.kind !== "defines");
  const connectedFiles = new Set<string>();
  for (const edge of nonDefineEdges) {
    if (isFileNode(input.index, edge.from)) connectedFiles.add(edge.from);
    if (isFileNode(input.index, edge.to)) connectedFiles.add(edge.to);
    const fromSymbol = symbolForId(input.index, edge.from);
    const toSymbol = symbolForId(input.index, edge.to);
    if (fromSymbol) connectedFiles.add(fromSymbol.path);
    if (toSymbol) connectedFiles.add(toSymbol.path);
  }

  const orphanSymbols = findOrphanSymbols(input.index, limit);
  const affectedFlows = changedFiles.map((changedFile) =>
    analyzeAffectedFlow(input.index, changedFile, limit, warnings),
  );

  return {
    repoRoot: input.index.repoRoot,
    indexHealth: createRepoIndexHealth(input.index),
    summary: summarizeRepoIndex(input.index),
    hubs: metrics.slice(0, limit),
    bridges,
    cycles,
    disconnectedFiles: input.index.files
      .map((file) => file.path)
      .filter((repoPath) => !connectedFiles.has(repoPath))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, limit),
    orphanSymbols,
    affectedFlows,
    parserCoverage: createParserCoverage(input.index),
    truncated:
      metrics.length > limit ||
      cycles.length >= limit ||
      orphanSymbols.length >= limit ||
      input.index.truncated ||
      warnings.length > 0,
    warnings,
  };
}

function calculateDegrees(
  edges: RepoIndexEdge[],
  nodeIds: Set<string>,
): Map<string, { inDegree: number; outDegree: number }> {
  const degrees = new Map<string, { inDegree: number; outDegree: number }>();
  for (const node of nodeIds) {
    degrees.set(node, { inDegree: 0, outDegree: 0 });
  }
  for (const edge of edges) {
    const from = degrees.get(edge.from) ?? { inDegree: 0, outDegree: 0 };
    from.outDegree += 1;
    degrees.set(edge.from, from);
    const to = degrees.get(edge.to) ?? { inDegree: 0, outDegree: 0 };
    to.inDegree += 1;
    degrees.set(edge.to, to);
  }
  return degrees;
}

function metricForNode(
  index: RepoIndex,
  id: string,
  degrees: Map<string, { inDegree: number; outDegree: number }>,
): RepoGraphNodeMetric {
  const degree = degrees.get(id) ?? { inDegree: 0, outDegree: 0 };
  const symbol = symbolForId(index, id);
  const kind = isFileNode(index, id) ? "file" : id.startsWith("external:") ? "external" : "symbol";
  return {
    id,
    label: labelNode(index, id),
    kind,
    ...(symbol ? { path: symbol.path } : isFileNode(index, id) ? { path: id } : {}),
    inDegree: degree.inDegree,
    outDegree: degree.outDegree,
    totalDegree: degree.inDegree + degree.outDegree,
  };
}

function findCycles(index: RepoIndex, limit: number): RepoGraphCycle[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of index.edges.filter((item) => item.kind !== "defines")) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }

  const cycles: RepoGraphCycle[] = [];
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  let nextIndex = 0;

  function visit(node: string): void {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) ?? []) {
      if (!indexes.has(next)) {
        visit(next);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indexes.get(next) ?? 0));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) {
      return;
    }

    const component: string[] = [];
    while (stack.length > 0) {
      const item = stack.pop();
      if (!item) {
        break;
      }
      onStack.delete(item);
      component.push(item);
      if (item === node) {
        break;
      }
    }
    if (component.length > 1) {
      cycles.push({
        size: component.length,
        nodes: component.map((item) => labelNode(index, item)).sort((left, right) => left.localeCompare(right)),
      });
    }
  }

  for (const node of adjacency.keys()) {
    if (!indexes.has(node)) {
      visit(node);
    }
    if (cycles.length >= limit) {
      break;
    }
  }

  return cycles
    .sort((left, right) => right.size - left.size || left.nodes.join("|").localeCompare(right.nodes.join("|")))
    .slice(0, limit);
}

function findOrphanSymbols(
  index: RepoIndex,
  limit: number,
): Array<{ id: string; name: string; kind: string; path: string; line: number }> {
  const inboundNonDefine = new Set(
    index.edges.filter((edge) => edge.kind !== "defines").map((edge) => edge.to),
  );
  return index.symbols
    .filter((symbol) => !inboundNonDefine.has(symbol.id))
    .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line)
    .slice(0, limit)
    .map((symbol) => ({
      id: symbol.id,
      name: symbol.name,
      kind: symbol.kind,
      path: symbol.path,
      line: symbol.line,
    }));
}

function analyzeAffectedFlow(
  index: RepoIndex,
  changedFile: string,
  limit: number,
  warnings: string[],
): RepoGraphAffectedFlow {
  const normalized = changedFile.replace(/\\/g, "/").replace(/^\.\//, "");
  const adjacency = createImpactAdjacency(index);
  const queue = [normalized];
  const seen = new Set<string>(queue);
  let truncated = false;

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      break;
    }
    for (const next of adjacency.get(node) ?? []) {
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      if (seen.size >= MAX_TRAVERSAL_NODES) {
        truncated = true;
        warnings.push(
          `GRAPH_ANALYZE_TRUNCATED: traversal for ${normalized} reached ${MAX_TRAVERSAL_NODES} nodes.`,
        );
        queue.length = 0;
        break;
      }
      queue.push(next);
    }
  }

  return {
    source: normalized,
    reachableCount: Math.max(0, seen.size - 1),
    nodes: [...seen]
      .filter((node) => node !== normalized)
      .map((node) => labelNode(index, node))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, limit),
    truncated,
  };
}

function createImpactAdjacency(index: RepoIndex): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  function add(from: string, to: string): void {
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  }
  for (const edge of index.edges) {
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }
  return adjacency;
}

function createParserCoverage(index: RepoIndex): RepoGraphParserCoverage {
  const byLanguage: RepoGraphParserCoverage["byLanguage"] = {};
  let treeSitterFiles = 0;
  let fallbackFiles = 0;
  for (const file of index.files) {
    const bucket = byLanguage[file.language] ?? {
      totalFiles: 0,
      treeSitterFiles: 0,
      fallbackFiles: 0,
      fallbackReasons: [],
    };
    bucket.totalFiles += 1;
    if (file.parser?.engine === "tree-sitter") {
      bucket.treeSitterFiles += 1;
      treeSitterFiles += 1;
    } else {
      bucket.fallbackFiles += 1;
      fallbackFiles += 1;
      if (file.parser?.reason) {
        bucket.fallbackReasons.push(file.parser.reason);
      }
    }
    byLanguage[file.language] = bucket;
  }
  for (const bucket of Object.values(byLanguage)) {
    bucket.fallbackReasons = uniqueSorted(bucket.fallbackReasons).slice(0, 8);
  }
  return {
    totalFiles: index.files.length,
    treeSitterFiles,
    fallbackFiles,
    supportedLanguages: supportedTreeSitterLanguages(),
    byLanguage,
  };
}

function collectNodeIds(index: RepoIndex): Set<string> {
  return new Set([
    ...index.files.map((file) => file.path),
    ...index.symbols.map((symbol) => symbol.id),
    ...index.edges.flatMap((edge) => [edge.from, edge.to]),
  ]);
}

function isFileNode(index: RepoIndex, id: string): boolean {
  return index.files.some((file) => file.path === id);
}

function symbolForId(index: RepoIndex, id: string): RepoIndexSymbol | undefined {
  return index.symbols.find((symbol) => symbol.id === id);
}

function labelNode(index: RepoIndex, nodeId: string): string {
  if (isFileNode(index, nodeId)) {
    return nodeId;
  }
  const symbol = symbolForId(index, nodeId);
  return symbol ? `${symbol.path}#${symbol.name}` : nodeId;
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? DEFAULT_LIMIT)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit ?? DEFAULT_LIMIT)));
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
