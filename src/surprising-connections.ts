import { analyzeRepoGraph } from "./repo-graph-analysis.js";
import type { GraphCommunityRecord } from "./graph-communities.js";
import type { RepoIndex, RepoIndexEdge } from "./repo-index.js";

export type SurprisingConnection = {
  score: number;
  from: string;
  to: string;
  fromCommunityId: string;
  toCommunityId: string;
  path: string[];
  edgeKinds: string[];
  reason: string;
};

export type SurprisingConnectionsResult = {
  repoRoot: string;
  fingerprint: string;
  generatedAt: string;
  results: SurprisingConnection[];
  warnings: string[];
  refused?: true;
  reason?: string;
  hint?: string;
};

export function getSurprisingConnections(input: {
  repoRoot: string;
  index: RepoIndex;
  communities: GraphCommunityRecord[];
  limit?: number;
}): SurprisingConnectionsResult {
  if (input.communities.length === 0) {
    return {
      repoRoot: input.repoRoot,
      fingerprint: input.index.fingerprint,
      generatedAt: new Date().toISOString(),
      results: [],
      warnings: ["Graph communities are required before surprising connections can be ranked."],
      refused: true,
      reason: "Graph community store is missing or empty.",
      hint: "Run graph_communities_refresh before get_surprising_connections.",
    };
  }

  const limit = clampLimit(input.limit);
  const communityByNode = createCommunityLookup(input.index, input.communities);
  const degreeByNode = createDegreeLookup(input.index.edges);
  const analysis = analyzeRepoGraph({ index: input.index, limit });
  const bridgeLabels = new Set(analysis.bridges.map((bridge) => bridge.id));
  const results = input.index.edges
    .filter((edge) => edge.kind !== "defines")
    .map((edge) => toConnection(edge, communityByNode, degreeByNode, bridgeLabels))
    .filter((connection): connection is SurprisingConnection => Boolean(connection))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.from !== right.from) {
        return left.from.localeCompare(right.from);
      }
      return left.to.localeCompare(right.to);
    })
    .slice(0, limit);

  return {
    repoRoot: input.repoRoot,
    fingerprint: input.index.fingerprint,
    generatedAt: new Date().toISOString(),
    results,
    warnings: analysis.warnings,
  };
}

function toConnection(
  edge: RepoIndexEdge,
  communityByNode: Map<string, string>,
  degreeByNode: Map<string, number>,
  bridgeLabels: Set<string>,
): SurprisingConnection | undefined {
  const fromCommunityId = communityByNode.get(edge.from) ?? communityByNode.get(fileForNode(edge.from) ?? "");
  const toCommunityId = communityByNode.get(edge.to) ?? communityByNode.get(fileForNode(edge.to) ?? "");
  if (!fromCommunityId || !toCommunityId || fromCommunityId === toCommunityId) {
    return undefined;
  }
  const fromDegree = degreeByNode.get(edge.from) ?? degreeByNode.get(fileForNode(edge.from) ?? "") ?? 0;
  const toDegree = degreeByNode.get(edge.to) ?? degreeByNode.get(fileForNode(edge.to) ?? "") ?? 0;
  const provenanceBoost = edge.provenance === "extracted" ? 8 : edge.provenance === "inferred" ? 4 : 1;
  const bridgeBoost = bridgeLabels.has(edge.from) || bridgeLabels.has(edge.to) ? 10 : 0;
  const score = 100 + fromDegree + toDegree + edge.confidence * 10 + provenanceBoost + bridgeBoost;
  return {
    score,
    from: edge.from,
    to: edge.to,
    fromCommunityId,
    toCommunityId,
    path: [edge.from, edge.to],
    edgeKinds: [edge.kind],
    reason: `${edge.kind} edge crosses communities ${fromCommunityId} -> ${toCommunityId}.`,
  };
}

function createCommunityLookup(index: RepoIndex, communities: GraphCommunityRecord[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const community of communities) {
    const memberFiles = new Set<string>();
    for (const member of community.members) {
      lookup.set(member, community.id);
      const file = fileForNode(member);
      if (file) {
        memberFiles.add(file);
        lookup.set(file, community.id);
      }
    }
    for (const symbol of index.symbols) {
      if (memberFiles.has(symbol.path)) {
        lookup.set(symbol.id, community.id);
      }
    }
  }
  return lookup;
}

function createDegreeLookup(edges: RepoIndexEdge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  return degree;
}

function fileForNode(nodeId: string): string | undefined {
  if (nodeId.startsWith("external:")) {
    return undefined;
  }
  return nodeId.split("#", 1)[0] ?? nodeId;
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? 10)) {
    return 10;
  }
  return Math.max(1, Math.min(100, Math.floor(limit ?? 10)));
}
