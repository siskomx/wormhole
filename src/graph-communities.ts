import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { IndexHealthSnapshot } from "./index-health.js";
import type { PythonSidecar } from "./python-sidecar.js";
import {
  createRepoIndexHealth,
  type RepoIndex,
  type RepoIndexEdge,
  type RepoIndexFile,
  type RepoIndexSymbol,
} from "./repo-index.js";

export type GraphCommunityRecord = {
  id: string;
  sidecarId: string;
  label: string;
  members: string[];
  fileCount: number;
  symbolCount: number;
  topFiles: string[];
};

export type GraphCommunityStore = {
  version: 1;
  repoRoot: string;
  generatedAt: string;
  fingerprint: string;
  indexHealth: IndexHealthSnapshot;
  communities: GraphCommunityRecord[];
};

export type GraphCommunityListResult = {
  repoRoot: string;
  fingerprint?: string;
  communities: GraphCommunityRecord[];
  refused?: true;
  reason?: string;
  hint?: string;
};

export type GraphCommunitySlice = {
  repoRoot: string;
  fingerprint?: string;
  community?: GraphCommunityRecord;
  files: RepoIndexFile[];
  symbols: RepoIndexSymbol[];
  internalEdges: RepoIndexEdge[];
  incomingEdges: RepoIndexEdge[];
  outgoingEdges: RepoIndexEdge[];
  topConnectedNodes: string[];
  refused?: true;
  reason?: string;
  hint?: string;
};

type SidecarCommunityResult = {
  communityCount: number;
  communities: Array<{ id: string; members: string[] }>;
};

const STORE_RELATIVE_PATH = ".wormhole/graph/communities.json";
const REFRESH_HINT = "Run graph_communities_refresh before querying graph communities.";

export async function refreshGraphCommunities(input: {
  repoRoot: string;
  index: RepoIndex;
  sidecar: PythonSidecar;
}): Promise<GraphCommunityStore> {
  const repoRoot = path.resolve(input.repoRoot);
  const sidecarResult = await input.sidecar.run({
    job: "graph_communities",
    payload: {
      nodes: [
        ...input.index.files.map((file) => ({ id: file.path, kind: "file" })),
        ...input.index.symbols.map((symbol) => ({ id: symbol.id, kind: "symbol" })),
      ],
      edges: input.index.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
      })),
    },
  });
  if (!sidecarResult.ok || !isSidecarCommunityResult(sidecarResult.result)) {
    throw new Error(sidecarResult.error ?? "Python graph community analysis did not return communities");
  }

  const communities = sidecarResult.result.communities
    .map((community) => normalizeCommunity(input.index, community))
    .sort((left, right) => {
      if (right.fileCount !== left.fileCount) {
        return right.fileCount - left.fileCount;
      }
      return left.id.localeCompare(right.id);
    });
  const store: GraphCommunityStore = {
    version: 1,
    repoRoot,
    generatedAt: new Date().toISOString(),
    fingerprint: input.index.fingerprint,
    indexHealth: createRepoIndexHealth(input.index),
    communities,
  };
  writeJson(storePath(repoRoot), store);
  return store;
}

export function readGraphCommunityStore(repoRoot: string): GraphCommunityStore | undefined {
  return readJson<GraphCommunityStore>(storePath(path.resolve(repoRoot)));
}

export function listGraphCommunities(input: {
  repoRoot: string;
  index: RepoIndex;
}): GraphCommunityListResult {
  const store = readGraphCommunityStore(input.repoRoot);
  const repoRoot = path.resolve(input.repoRoot);
  if (!store) {
    return {
      repoRoot,
      communities: [],
      refused: true,
      reason: "Graph community store is missing.",
      hint: REFRESH_HINT,
    };
  }
  if (store.fingerprint !== input.index.fingerprint) {
    return {
      repoRoot,
      fingerprint: store.fingerprint,
      communities: [],
      refused: true,
      reason: "Graph community store is stale for the current repo index.",
      hint: REFRESH_HINT,
    };
  }
  return {
    repoRoot,
    fingerprint: store.fingerprint,
    communities: store.communities,
  };
}

export function getGraphCommunity(input: {
  repoRoot: string;
  index: RepoIndex;
  id: string;
}): GraphCommunitySlice {
  const empty = {
    repoRoot: path.resolve(input.repoRoot),
    files: [],
    symbols: [],
    internalEdges: [],
    incomingEdges: [],
    outgoingEdges: [],
    topConnectedNodes: [],
  };
  const store = readGraphCommunityStore(input.repoRoot);
  if (!store) {
    return {
      ...empty,
      refused: true,
      reason: "Graph community store is missing.",
      hint: REFRESH_HINT,
    };
  }
  if (store.fingerprint !== input.index.fingerprint) {
    return {
      ...empty,
      fingerprint: store.fingerprint,
      refused: true,
      reason: "Graph community store is stale for the current repo index.",
      hint: REFRESH_HINT,
    };
  }
  const community = store.communities.find(
    (candidate) => candidate.id === input.id || candidate.sidecarId === input.id,
  );
  if (!community) {
    return {
      ...empty,
      fingerprint: store.fingerprint,
      refused: true,
      reason: `Graph community not found: ${input.id}`,
      hint: "Use list_communities to inspect available community ids.",
    };
  }

  const memberNodes = new Set(community.members);
  const memberFiles = new Set(community.members.map(fileForNode).filter((value): value is string => Boolean(value)));
  const belongs = (nodeId: string) => memberNodes.has(nodeId) || memberFiles.has(fileForNode(nodeId) ?? "");
  const files = input.index.files.filter((file) => memberFiles.has(file.path));
  const symbols = input.index.symbols.filter(
    (symbol) => memberNodes.has(symbol.id) || memberFiles.has(symbol.path),
  );
  const internalEdges = input.index.edges.filter((edge) => belongs(edge.from) && belongs(edge.to));
  const incomingEdges = input.index.edges.filter((edge) => !belongs(edge.from) && belongs(edge.to));
  const outgoingEdges = input.index.edges.filter((edge) => belongs(edge.from) && !belongs(edge.to));
  const topConnectedNodes = uniqueSorted(
    [...incomingEdges, ...outgoingEdges].flatMap((edge) => [edge.from, edge.to]).filter((node) => !belongs(node)),
  ).slice(0, 20);

  return {
    repoRoot: path.resolve(input.repoRoot),
    fingerprint: store.fingerprint,
    community,
    files,
    symbols,
    internalEdges,
    incomingEdges,
    outgoingEdges,
    topConnectedNodes,
  };
}

export function graphCommunityStorePath(repoRoot: string): string {
  return storePath(path.resolve(repoRoot));
}

function normalizeCommunity(
  index: RepoIndex,
  community: { id: string; members: string[] },
): GraphCommunityRecord {
  const members = uniqueSorted(community.members);
  const memberSet = new Set(members);
  const files = uniqueSorted(
    members
      .map(fileForNode)
      .filter((file): file is string => Boolean(file) && index.files.some((item) => item.path === file)),
  );
  const fileSet = new Set(files);
  const symbols = index.symbols.filter((symbol) => memberSet.has(symbol.id) || fileSet.has(symbol.path));
  const degreeByFile = new Map<string, number>();
  for (const file of files) {
    degreeByFile.set(file, 0);
  }
  for (const edge of index.edges) {
    const fromFile = fileForNode(edge.from);
    const toFile = fileForNode(edge.to);
    if (fromFile && degreeByFile.has(fromFile)) {
      degreeByFile.set(fromFile, (degreeByFile.get(fromFile) ?? 0) + 1);
    }
    if (toFile && degreeByFile.has(toFile)) {
      degreeByFile.set(toFile, (degreeByFile.get(toFile) ?? 0) + 1);
    }
  }
  return {
    id: stableCommunityId(members),
    sidecarId: community.id,
    label: dominantLabel(files),
    members,
    fileCount: files.length,
    symbolCount: symbols.length,
    topFiles: [...degreeByFile.entries()]
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return left[0].localeCompare(right[0]);
      })
      .map(([file]) => file)
      .slice(0, 12),
  };
}

function isSidecarCommunityResult(value: unknown): value is SidecarCommunityResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SidecarCommunityResult>;
  return Array.isArray(candidate.communities);
}

function stableCommunityId(members: string[]): string {
  return `community:${createHash("sha256").update(members.join("\n")).digest("hex").slice(0, 12)}`;
}

function dominantLabel(files: string[]): string {
  if (files.length === 0) {
    return "external";
  }
  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = file.split("/");
    const label = parts[0] === "src" ? "src" : parts[0] ?? ".";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  })[0]?.[0] ?? ".";
}

function fileForNode(nodeId: string): string | undefined {
  if (nodeId.startsWith("external:")) {
    return undefined;
  }
  return nodeId.split("#", 1)[0] ?? nodeId;
}

function storePath(repoRoot: string): string {
  return path.join(repoRoot, STORE_RELATIVE_PATH);
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
