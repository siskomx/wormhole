import path from "node:path";
import {
  readRepoFactGraph,
  repoFactStoreStatus,
} from "./repo-fact-store.js";
import {
  type RepoFactEdge,
  type RepoFactEdgeKind,
  type RepoFactGraph,
  type RepoFactNode,
} from "./repo-facts.js";

export type RelationQueryInput = {
  repoRoot: string;
  from?: string;
  to?: string;
  kinds?: RepoFactEdgeKind[];
  direction?: "outbound" | "inbound" | "both";
  maxDepth?: number;
  limit?: number;
  cursor?: string;
  requireFresh?: boolean;
};

export type RelationQueryResult = {
  repoRoot: string;
  fingerprint?: string;
  fresh: boolean;
  refused?: true;
  warnings: string[];
  nextCursor?: string;
  truncated: boolean;
  nodes: RepoFactNode[];
  edges: RepoFactEdge[];
  paths: Array<{
    score: number;
    nodes: RepoFactNode[];
    edges: RepoFactEdge[];
    reason: string;
  }>;
};

type LoadedFacts = {
  graph?: RepoFactGraph;
  fresh: boolean;
  warnings: string[];
};

export function queryRepoRelations(input: RelationQueryInput & { graph?: RepoFactGraph }): RelationQueryResult {
  const repoRoot = path.resolve(input.repoRoot);
  const limit = normalizeLimit(input.limit);
  const cursor = parseCursor(input.cursor);
  const loaded = loadFacts({ ...input, repoRoot });
  if (!loaded.graph) {
    return {
      repoRoot,
      fresh: false,
      refused: input.requireFresh ? true : undefined,
      warnings: loaded.warnings,
      truncated: false,
      nodes: [],
      edges: [],
      paths: [],
    };
  }
  if (input.requireFresh && !loaded.fresh) {
    return {
      repoRoot,
      fingerprint: loaded.graph.fingerprint,
      fresh: false,
      refused: true,
      warnings: loaded.warnings,
      truncated: false,
      nodes: [],
      edges: [],
      paths: [],
    };
  }

  const graph = loaded.graph;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const fromIds = resolveEndpointIds(graph.nodes, input.from);
  const toIds = resolveEndpointIds(graph.nodes, input.to);
  const kinds = new Set(input.kinds ?? []);
  const direction = input.direction ?? "both";
  const directEdges = graph.edges
    .filter((edge) => kinds.size === 0 || kinds.has(edge.kind))
    .filter((edge) => endpointMatches(edge, fromIds, toIds, direction))
    .sort(compareEdges);
  const pagedEdges = directEdges.slice(cursor, cursor + limit);
  const nextCursor = cursor + pagedEdges.length < directEdges.length ? String(cursor + pagedEdges.length) : undefined;
  const paths = findRelationPaths({
    graph,
    nodeById,
    fromIds,
    toIds,
    kinds,
    direction,
    maxDepth: normalizeMaxDepth(input.maxDepth),
    limit,
  });
  const outputNodes = collectNodes(nodeById, pagedEdges, paths);

  return {
    repoRoot,
    fingerprint: graph.fingerprint,
    fresh: loaded.fresh,
    warnings: loaded.warnings,
    ...(nextCursor ? { nextCursor } : {}),
    truncated: Boolean(nextCursor),
    nodes: outputNodes,
    edges: pagedEdges,
    paths,
  };
}

function loadFacts(input: RelationQueryInput & { repoRoot: string; graph?: RepoFactGraph }): LoadedFacts {
  if (input.graph) {
    const fresh = input.graph.nodes.every((node) => node.metadata.freshness === "fresh") &&
      input.graph.edges.every((edge) => edge.metadata.freshness === "fresh");
    return {
      graph: input.graph,
      fresh,
      warnings: fresh ? [] : ["Repo fact graph freshness is unknown or stale."],
    };
  }
  const status = repoFactStoreStatus({ repoRoot: input.repoRoot, requireFresh: input.requireFresh });
  const read = readRepoFactGraph({ repoRoot: input.repoRoot });
  return {
    graph: read?.graph,
    fresh: status.fresh,
    warnings: status.fresh
      ? []
      : [
          "Repo fact store is stale or incomplete.",
          ...status.staleReasons.map((reason) => `STALE: ${reason}`),
        ],
  };
}

function resolveEndpointIds(nodes: RepoFactNode[], query: string | undefined): Set<string> | undefined {
  if (!query) {
    return undefined;
  }
  const normalized = query.replace(/\\/g, "/").replace(/^\.\//, "");
  const lower = normalized.toLowerCase();
  const matches = nodes
    .filter((node) =>
      node.id === normalized ||
      node.path === normalized ||
      node.label.toLowerCase() === lower ||
      node.path?.toLowerCase() === lower ||
      (node.kind === "file" || node.kind === "test" ? node.id === `file:${normalized}` : false) ||
      (node.kind === "symbol" ? node.id === `symbol:${normalized}` : false),
    )
    .map((node) => node.id);
  return new Set(matches.length > 0 ? matches : [normalized]);
}

function endpointMatches(
  edge: RepoFactEdge,
  fromIds: Set<string> | undefined,
  toIds: Set<string> | undefined,
  direction: "outbound" | "inbound" | "both",
): boolean {
  const fromMatch = !fromIds || fromIds.has(edge.from);
  const toMatch = !toIds || toIds.has(edge.to);
  if (direction === "outbound") {
    return fromMatch && toMatch;
  }
  if (direction === "inbound") {
    if (fromIds && toIds) {
      return fromIds.has(edge.to) && toIds.has(edge.from);
    }
    if (fromIds) {
      return fromIds.has(edge.to);
    }
    if (toIds) {
      return toIds.has(edge.to);
    }
    return true;
  }
  const direct = fromMatch && toMatch;
  const reverse = (!fromIds || fromIds.has(edge.to)) && (!toIds || toIds.has(edge.from));
  return direct || reverse;
}

function findRelationPaths(input: {
  graph: RepoFactGraph;
  nodeById: Map<string, RepoFactNode>;
  fromIds?: Set<string>;
  toIds?: Set<string>;
  kinds: Set<RepoFactEdgeKind>;
  direction: "outbound" | "inbound" | "both";
  maxDepth: number;
  limit: number;
}): RelationQueryResult["paths"] {
  if (!input.fromIds || !input.toIds) {
    return [];
  }
  const adjacency = buildAdjacency(input.graph.edges, input.kinds, input.direction);
  const results: RelationQueryResult["paths"] = [];
  const visitedLimit = Math.max(500, input.limit * 100);
  let visitedCount = 0;

  for (const start of input.fromIds) {
    const queue: Array<{ node: string; edges: RepoFactEdge[] }> = [{ node: start, edges: [] }];
    const seen = new Set<string>([start]);
    while (queue.length > 0 && results.length < input.limit && visitedCount < visitedLimit) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      visitedCount += 1;
      if (current.edges.length >= input.maxDepth) {
        continue;
      }
      for (const edge of adjacency.get(current.node) ?? []) {
        const next = edge.from === current.node ? edge.to : edge.from;
        if (seen.has(next)) {
          continue;
        }
        const nextEdges = [...current.edges, edge];
        if (input.toIds.has(next)) {
          const nodes = collectPathNodes(input.nodeById, start, nextEdges);
          results.push({
            score: scorePath(nextEdges),
            nodes,
            edges: nextEdges,
            reason: `Found ${nextEdges.length}-edge relation path.`,
          });
          if (results.length >= input.limit) {
            break;
          }
        }
        seen.add(next);
        queue.push({ node: next, edges: nextEdges });
      }
    }
  }

  return results.sort((left, right) => right.score - left.score || left.reason.localeCompare(right.reason));
}

function buildAdjacency(
  edges: RepoFactEdge[],
  kinds: Set<RepoFactEdgeKind>,
  direction: "outbound" | "inbound" | "both",
): Map<string, RepoFactEdge[]> {
  const adjacency = new Map<string, RepoFactEdge[]>();
  for (const edge of edges) {
    if (kinds.size > 0 && !kinds.has(edge.kind)) {
      continue;
    }
    if (direction === "outbound" || direction === "both") {
      adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge]);
    }
    if (direction === "inbound" || direction === "both") {
      adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge]);
    }
  }
  for (const [node, nodeEdges] of adjacency.entries()) {
    adjacency.set(node, nodeEdges.sort(compareEdges));
  }
  return adjacency;
}

function collectPathNodes(
  nodeById: Map<string, RepoFactNode>,
  start: string,
  edges: RepoFactEdge[],
): RepoFactNode[] {
  const ids = new Set<string>([start]);
  for (const edge of edges) {
    ids.add(edge.from);
    ids.add(edge.to);
  }
  return [...ids].flatMap((id) => {
    const node = nodeById.get(id);
    return node ? [node] : [];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function collectNodes(
  nodeById: Map<string, RepoFactNode>,
  edges: RepoFactEdge[],
  paths: RelationQueryResult["paths"],
): RepoFactNode[] {
  const ids = new Set<string>();
  for (const edge of edges) {
    ids.add(edge.from);
    ids.add(edge.to);
  }
  for (const relationPath of paths) {
    for (const node of relationPath.nodes) {
      ids.add(node.id);
    }
  }
  return [...ids].flatMap((id) => {
    const node = nodeById.get(id);
    return node ? [node] : [];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function scorePath(edges: RepoFactEdge[]): number {
  if (edges.length === 0) {
    return 0;
  }
  const provenanceScore = edges.reduce((total, edge) => {
    if (edge.provenance === "extracted") {
      return total + 1;
    }
    if (edge.provenance === "derived") {
      return total + 0.8;
    }
    if (edge.provenance === "inferred") {
      return total + 0.6;
    }
    return total + 0.4;
  }, 0);
  return Number((provenanceScore / edges.length / edges.length).toFixed(4));
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 50;
  }
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function normalizeMaxDepth(maxDepth: number | undefined): number {
  if (maxDepth === undefined || !Number.isFinite(maxDepth)) {
    return 2;
  }
  return Math.max(1, Math.min(8, Math.floor(maxDepth)));
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const value = Number.parseInt(cursor, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function compareEdges(left: RepoFactEdge, right: RepoFactEdge): number {
  return (
    left.from.localeCompare(right.from) ||
    left.kind.localeCompare(right.kind) ||
    left.to.localeCompare(right.to) ||
    left.id.localeCompare(right.id)
  );
}
