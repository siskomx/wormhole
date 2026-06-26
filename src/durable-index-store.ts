import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyProjectLane, PROJECT_LANES, type ProjectLane } from "./project-lanes.js";
import {
  buildRepoIndex,
  isRepoIndexFresh,
  queryRepoIndex,
  summarizeRepoIndex,
  type RepoIndex,
  type RepoIndexBuildOptions,
  type RepoIndexQueryResult,
  type RepoIndexSearchResult,
  type RepoIndexSummary,
} from "./repo-index.js";
import {
  buildSemanticIndex,
  semanticSearch,
  type SemanticIndex,
  type SemanticRecordInput,
  type SemanticSearchResult,
} from "./semantic-search.js";

export type DurableRepoIndexResult = {
  repoRoot: string;
  indexPath: string;
  summary: RepoIndexSummary;
};

export type DurableSemanticIndexResult = {
  repoRoot: string;
  indexPath: string;
  index: SemanticIndex;
};

export type DurableIndexStatus = {
  repoRoot: string;
  repoIndex?: {
    indexPath: string;
    fresh: boolean;
    summary: RepoIndexSummary;
  };
  semanticIndex?: {
    indexPath: string;
    recordCount: number;
    provider: SemanticIndex["provider"];
  };
};

export type DurableIndexManifestEntry = {
  lane: ProjectLane | "full";
  indexId: string;
  indexPath: string;
  fingerprint: string;
  fresh: boolean;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  byteLength: number;
  truncated: boolean;
  skippedFiles: string[];
};

export type DurableIndexLaneEntry = DurableIndexManifestEntry & {
  lane: ProjectLane;
};

export type DurableIndexShardEntry = DurableIndexManifestEntry & {
  lane: ProjectLane;
  shardId: string;
  shardRoot: string;
};

export type DurableIndexManifest = {
  version: 1;
  strategy: "root";
  repoRoot: string;
  manifestPath: string;
  generatedAt: string;
  fullIndex: DurableIndexManifestEntry;
  lanes: DurableIndexLaneEntry[];
  shards: DurableIndexShardEntry[];
  totalFileCount: number;
  totalSymbolCount: number;
  totalEdgeCount: number;
  totalByteLength: number;
};

export type DurableIndexManifestStatus = {
  repoRoot: string;
  manifestPath: string;
  manifest?: DurableIndexManifest & { fresh: boolean };
};

export type DurableShardedRepoIndexQueryResult = RepoIndexQueryResult & {
  repoRoot: string;
  usedManifest: boolean;
  queriedLanes: ProjectLane[];
  indexPaths: string[];
  shardCount: number;
};

export function refreshDurableRepoIndex(input: RepoIndexBuildOptions): DurableRepoIndexResult {
  const repoRoot = path.resolve(input.repoRoot);
  const index = buildRepoIndex({ ...input, repoRoot });
  const indexPath = repoIndexPath(repoRoot);
  writeJson(indexPath, index);
  return {
    repoRoot,
    indexPath,
    summary: summarizeRepoIndex(index),
  };
}

export function refreshDurableIndexManifest(input: RepoIndexBuildOptions): DurableIndexManifest {
  const repoRoot = path.resolve(input.repoRoot);
  const index = buildRepoIndex({ ...input, repoRoot });
  const indexPath = repoIndexPath(repoRoot);
  writeJson(indexPath, index);

  const lanes = PROJECT_LANES
    .map((lane) => {
      const shard = createFilteredShard(
        index,
        index.files.filter((file) => classifyProjectLane(file.path) === lane).map((file) => file.path),
        `lane:${lane}`,
      );
      if (shard.files.length === 0) {
        return undefined;
      }
      const shardPath = laneIndexPath(repoRoot, lane);
      writeJson(shardPath, shard);
      return createManifestEntry(shard, lane, shardPath) as DurableIndexLaneEntry;
    })
    .filter((entry): entry is DurableIndexLaneEntry => Boolean(entry));
  const shards = createRootShards(index, repoRoot);

  const manifest: DurableIndexManifest = {
    version: 1,
    strategy: "root",
    repoRoot,
    manifestPath: indexManifestPath(repoRoot),
    generatedAt: new Date().toISOString(),
    fullIndex: createManifestEntry(index, "full", indexPath),
    lanes,
    shards,
    totalFileCount: index.files.length,
    totalSymbolCount: index.symbols.length,
    totalEdgeCount: index.edges.length,
    totalByteLength: byteLengthForIndex(index),
  };
  writeJson(manifest.manifestPath, manifest);
  return manifest;
}

export function refreshDurableSemanticIndex(input: {
  repoRoot: string;
  records: SemanticRecordInput[];
}): DurableSemanticIndexResult {
  const repoRoot = path.resolve(input.repoRoot);
  const index = buildSemanticIndex({ records: input.records });
  const indexPath = semanticIndexPath(repoRoot);
  writeJson(indexPath, index);
  return { repoRoot, indexPath, index };
}

export function searchDurableSemanticIndex(input: {
  repoRoot: string;
  query: string;
  limit?: number;
}): SemanticSearchResult {
  const index = readJson<SemanticIndex>(semanticIndexPath(path.resolve(input.repoRoot)));
  if (!index) {
    return { query: input.query, provider: "deterministic-token-overlap", results: [] };
  }
  return semanticSearch(index, { query: input.query, limit: input.limit });
}

export function durableIndexStatus(input: { repoRoot: string }): DurableIndexStatus {
  const repoRoot = path.resolve(input.repoRoot);
  const repoIndex = readJson<RepoIndex>(repoIndexPath(repoRoot));
  const semanticIndex = readJson<SemanticIndex>(semanticIndexPath(repoRoot));
  return {
    repoRoot,
    ...(repoIndex
      ? {
          repoIndex: {
            indexPath: repoIndexPath(repoRoot),
            fresh: isRepoIndexFresh(repoIndex),
            summary: summarizeRepoIndex(repoIndex),
          },
        }
      : {}),
    ...(semanticIndex
      ? {
          semanticIndex: {
            indexPath: semanticIndexPath(repoRoot),
            recordCount: semanticIndex.records.length,
            provider: semanticIndex.provider,
          },
        }
      : {}),
  };
}

export function durableIndexManifestStatus(input: { repoRoot: string }): DurableIndexManifestStatus {
  const repoRoot = path.resolve(input.repoRoot);
  const manifestPath = indexManifestPath(repoRoot);
  const manifest = readJson<DurableIndexManifest>(manifestPath);
  if (!manifest) {
    return { repoRoot, manifestPath };
  }
  const fullRepoIndex = readJson<RepoIndex>(manifest.fullIndex.indexPath);
  const fullFresh = Boolean(fullRepoIndex && isRepoIndexFresh(fullRepoIndex));
  const fresh =
    fullFresh &&
    manifest.lanes.every((lane) => lane.fresh && existsSync(lane.indexPath)) &&
    (manifest.shards ?? []).every((shard) => shard.fresh && existsSync(shard.indexPath));
  return {
    repoRoot,
    manifestPath,
    manifest: {
      ...manifest,
      fresh,
      fullIndex: {
        ...manifest.fullIndex,
        fresh: fullFresh,
      },
      lanes: manifest.lanes.map((lane) => ({
        ...lane,
        fresh: fresh && existsSync(lane.indexPath),
      })),
      shards: (manifest.shards ?? []).map((shard) => ({
        ...shard,
        fresh: fresh && existsSync(shard.indexPath),
      })),
    },
  };
}

export function queryDurableShardedRepoIndex(input: {
  repoRoot: string;
  query: string;
  lanes?: ProjectLane[];
  limit?: number;
}): DurableShardedRepoIndexQueryResult {
  const repoRoot = path.resolve(input.repoRoot);
  const limit = input.limit ?? 10;
  const manifest = readJson<DurableIndexManifest>(indexManifestPath(repoRoot));
  if (!manifest) {
    const fullIndex = readJson<RepoIndex>(repoIndexPath(repoRoot));
    const fallback = fullIndex ? queryRepoIndex(fullIndex, { query: input.query, limit }) : { query: input.query, results: [] };
    return {
      ...fallback,
      repoRoot,
      usedManifest: false,
      queriedLanes: [],
      indexPaths: fullIndex ? [repoIndexPath(repoRoot)] : [],
      shardCount: fullIndex ? 1 : 0,
    };
  }

  const requested = new Set(input.lanes ?? PROJECT_LANES);
  const shardResults: RepoIndexSearchResult[] = [];
  const queriedLanes: ProjectLane[] = [];
  const indexPaths: string[] = [];
  const shardEntries =
    manifest.shards && manifest.shards.length > 0
      ? manifest.shards
      : manifest.lanes.map((lane) => ({
          ...lane,
          shardId: `lane:${lane.lane}`,
          shardRoot: lane.lane,
        }));
  for (const shardEntry of shardEntries) {
    if (!requested.has(shardEntry.lane)) {
      continue;
    }
    const shard = readJson<RepoIndex>(shardEntry.indexPath);
    if (!shard) {
      continue;
    }
    indexPaths.push(shardEntry.indexPath);
    if (!queriedLanes.includes(shardEntry.lane)) {
      queriedLanes.push(shardEntry.lane);
    }
    shardResults.push(...queryRepoIndex(shard, { query: input.query, limit }).results);
  }

  return {
    query: input.query,
    results: mergeSearchResults(shardResults, limit),
    repoRoot,
    usedManifest: true,
    queriedLanes,
    indexPaths,
    shardCount: indexPaths.length,
  };
}

function repoIndexPath(repoRoot: string): string {
  return path.join(repoRoot, ".wormhole", "indexes", "repo-index.json");
}

function indexManifestPath(repoRoot: string): string {
  return path.join(repoRoot, ".wormhole", "indexes", "index-manifest.json");
}

function laneIndexPath(repoRoot: string, lane: ProjectLane): string {
  return path.join(repoRoot, ".wormhole", "indexes", "lanes", `${lane}.repo-index.json`);
}

function shardIndexPath(repoRoot: string, shardId: string): string {
  return path.join(repoRoot, ".wormhole", "indexes", "shards", `${safeShardFileName(shardId)}.repo-index.json`);
}

function semanticIndexPath(repoRoot: string): string {
  return path.join(repoRoot, ".wormhole", "indexes", "semantic-index.json");
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

function createRootShards(index: RepoIndex, repoRoot: string): DurableIndexShardEntry[] {
  const filesByRoot = new Map<string, string[]>();
  for (const file of index.files) {
    const shardRoot = shardRootForPath(file.path);
    filesByRoot.set(shardRoot, [...(filesByRoot.get(shardRoot) ?? []), file.path]);
  }

  return [...filesByRoot.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([shardRoot, filePaths]) => {
      const lane = dominantLane(filePaths);
      const shardId = `root:${shardRoot}`;
      const shard = createFilteredShard(index, filePaths, shardId);
      const shardPath = shardIndexPath(repoRoot, shardId);
      writeJson(shardPath, shard);
      return {
        ...(createManifestEntry(shard, lane, shardPath) as DurableIndexManifestEntry),
        lane,
        shardId,
        shardRoot,
      };
    });
}

function createFilteredShard(index: RepoIndex, shardFilePaths: string[], fingerprintSeed: string): RepoIndex {
  const shardFilePathSet = new Set(shardFilePaths);
  const files = index.files.filter((file) => shardFilePathSet.has(file.path));
  const filePaths = new Set(files.map((file) => file.path));
  const symbols = index.symbols.filter((symbol) => filePaths.has(symbol.path));
  const sourceNodeIds = new Set<string>([...filePaths, ...symbols.map((symbol) => symbol.id)]);
  const edges = index.edges.filter((edge) => {
    const fromPath = fileForNode(edge.from);
    return (
      sourceNodeIds.has(edge.from) ||
      (fromPath !== undefined && filePaths.has(fromPath))
    );
  });
  const skippedFiles = index.skippedFiles.filter((file) => filePaths.has(file));
  const fingerprint = createHash("sha256")
    .update([
      index.fingerprint,
      fingerprintSeed,
      ...files.map((file) => `${file.path}:${file.hash}`),
      ...edges.map((edge) => `${edge.from}:${edge.kind}:${edge.to}`),
    ].join("\n"))
    .digest("hex");
  return {
    ...index,
    fingerprint,
    files,
    symbols,
    edges,
    skippedFiles,
    truncated: skippedFiles.length > 0,
  };
}

function shardRootForPath(repoPath: string): string {
  const normalized = repoPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) {
    return ".";
  }
  if (parts[0] === "packages" || parts[0] === "apps") {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  if (parts[0] === "src" && parts.length >= 2) {
    return parts[1]?.includes(".") ? "src" : `${parts[0]}/${parts[1]}`;
  }
  return parts[0] ?? ".";
}

function dominantLane(filePaths: string[]): ProjectLane {
  const counts = new Map<ProjectLane, number>();
  for (const filePath of filePaths) {
    const lane = classifyProjectLane(filePath);
    counts.set(lane, (counts.get(lane) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return PROJECT_LANES.indexOf(left[0]) - PROJECT_LANES.indexOf(right[0]);
  })[0]?.[0] ?? "runtime";
}

function safeShardFileName(shardId: string): string {
  return shardId.replace(/[^A-Za-z0-9._-]+/g, "__");
}

function createManifestEntry(
  index: RepoIndex,
  lane: ProjectLane | "full",
  indexPath: string,
): DurableIndexManifestEntry {
  return {
    lane,
    indexId: `repo-index:${lane}:${index.fingerprint.slice(0, 16)}`,
    indexPath,
    fingerprint: index.fingerprint,
    fresh: true,
    fileCount: index.files.length,
    symbolCount: index.symbols.length,
    edgeCount: index.edges.length,
    byteLength: byteLengthForIndex(index),
    truncated: index.truncated,
    skippedFiles: [...index.skippedFiles],
  };
}

function byteLengthForIndex(index: RepoIndex): number {
  return index.files.reduce((total, file) => total + file.byteLength, 0);
}

function fileForNode(nodeId: string): string | undefined {
  if (nodeId.startsWith("external:")) {
    return undefined;
  }
  return nodeId.split("#", 1)[0] ?? nodeId;
}

function mergeSearchResults(results: RepoIndexSearchResult[], limit: number): RepoIndexSearchResult[] {
  const byKey = new Map<string, RepoIndexSearchResult>();
  for (const result of results) {
    const key = `${result.kind}:${result.path}:${result.line ?? ""}:${result.title}`;
    const existing = byKey.get(key);
    if (!existing || result.score > existing.score) {
      byKey.set(key, result);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.path !== right.path) {
        return left.path.localeCompare(right.path);
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}
