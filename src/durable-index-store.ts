import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createIndexHealthSnapshot,
  type IndexHealthSnapshot,
} from "./index-health.js";
import { classifyProjectLane, PROJECT_LANES, type ProjectLane } from "./project-lanes.js";
import {
  buildRepoIndex,
  isRepoIndexFresh,
  normalizeRepoIndexBuildOptions,
  queryRepoIndex,
  summarizeRepoIndex,
  type NormalizedRepoIndexBuildOptions,
  type RepoIndex,
  type RepoIndexBuildOptions,
  type RepoIndexEdge,
  type RepoIndexQueryResult,
  type RepoIndexSearchResult,
  type RepoIndexSummary,
} from "./repo-index.js";
import { createRepoFactGraphFromIndex } from "./repo-facts.js";
import {
  repoFactStoreStatus,
  writeRepoFactGraph,
  type RepoFactStoreStatus,
} from "./repo-fact-store.js";
import {
  buildSemanticIndex,
  semanticSearch,
  type SemanticIndex,
  type SemanticRecordInput,
  type SemanticSearchResult,
} from "./semantic-search.js";
import {
  querySqliteRepoIndex,
  readSqliteRepoIndexStatus,
  writeSqliteRepoIndex,
  type SqliteRepoIndexRetrievalMode,
  type SqliteRepoIndexStatus,
} from "./sqlite-repo-index.js";

export type DurableRepoIndexResult = {
  repoRoot: string;
  indexPath: string;
  sqliteIndexPath: string;
  factGraph?: RepoFactStoreStatus;
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
    indexHealth: IndexHealthSnapshot;
  };
  sqliteIndex?: SqliteRepoIndexStatus;
  factGraph?: RepoFactStoreStatus;
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
  usedSqlite: boolean;
  retrievalMode?: SqliteRepoIndexRetrievalMode | "json" | "manifest_json" | "refused";
  indexHealth: IndexHealthSnapshot;
  warnings: string[];
  refused?: boolean;
};

export function refreshDurableRepoIndex(input: RepoIndexBuildOptions): DurableRepoIndexResult {
  const repoRoot = path.resolve(input.repoRoot);
  const index = buildRepoIndex({ ...input, repoRoot });
  return writeDurableRepoIndexArtifacts(index);
}

export function writeDurableRepoIndexArtifacts(index: RepoIndex): DurableRepoIndexResult {
  const repoRoot = path.resolve(index.repoRoot);
  const indexPath = repoIndexPath(repoRoot);
  writeJson(indexPath, index);
  const sqliteIndexPath = writeSqliteRepoIndex(index);
  writeRepoFactGraph(createRepoFactGraphFromIndex({ index }));
  const factGraph = repoFactStoreStatus({ repoRoot, currentIndex: index });
  return {
    repoRoot,
    indexPath,
    sqliteIndexPath,
    factGraph,
    summary: summarizeRepoIndex(index),
  };
}

export function durableRepoIndexBuildOptions(
  input: { repoRoot: string },
): Omit<RepoIndexBuildOptions, "repoRoot"> | undefined {
  const repoRoot = path.resolve(input.repoRoot);
  const index = readJson<RepoIndex>(repoIndexPath(repoRoot));
  if (!index?.buildOptions) {
    return undefined;
  }
  return {
    preset: index.buildOptions.preset,
    ...(index.buildOptions.include ? { include: [...index.buildOptions.include] } : {}),
    ...(index.buildOptions.exclude ? { exclude: [...index.buildOptions.exclude] } : {}),
    maxFiles: index.buildOptions.maxFiles,
    maxFileBytes: index.buildOptions.maxFileBytes,
    maxTotalBytes: index.buildOptions.maxTotalBytes,
    ...(index.buildOptions.maxDepth === undefined ? {} : { maxDepth: index.buildOptions.maxDepth }),
    ...(index.buildOptions.maxDirs === undefined ? {} : { maxDirs: index.buildOptions.maxDirs }),
    ...(index.buildOptions.maxElapsedMs === undefined
      ? {}
      : { maxElapsedMs: index.buildOptions.maxElapsedMs }),
  };
}

export function refreshDurableIndexManifest(input: RepoIndexBuildOptions): DurableIndexManifest {
  const repoRoot = path.resolve(input.repoRoot);
  const requestedBuildOptions = normalizeRepoIndexBuildOptions({ ...input, repoRoot });
  const reusableIndex = readReusableDurableRepoIndex({ repoRoot, requestedBuildOptions });
  const reusableManifest = reusableIndex ? readReusableIndexManifest({ repoRoot, index: reusableIndex }) : undefined;
  if (reusableManifest) {
    return reusableManifest;
  }
  const index = reusableIndex ?? buildRepoIndex({ ...input, repoRoot });
  const indexPath = repoIndexPath(repoRoot);
  if (!reusableIndex) {
    writeJson(indexPath, index);
    writeSqliteRepoIndex(index);
    writeRepoFactGraph(createRepoFactGraphFromIndex({ index }));
  }
  const edgeLookup = createEdgeLookup(index);

  const lanes = PROJECT_LANES
    .map((lane) => {
      const shard = createFilteredShard(
        index,
        index.files.filter((file) => classifyProjectLane(file.path) === lane).map((file) => file.path),
        `lane:${lane}`,
        edgeLookup,
      );
      if (shard.files.length === 0) {
        return undefined;
      }
      const shardPath = laneIndexPath(repoRoot, lane);
      writeJson(shardPath, shard);
      return createManifestEntry(shard, lane, shardPath) as DurableIndexLaneEntry;
    })
    .filter((entry): entry is DurableIndexLaneEntry => Boolean(entry));
  const shards = createRootShards(index, repoRoot, edgeLookup);

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

function readReusableDurableRepoIndex(input: {
  repoRoot: string;
  requestedBuildOptions: NormalizedRepoIndexBuildOptions;
}): RepoIndex | undefined {
  const index = readJson<RepoIndex>(repoIndexPath(input.repoRoot));
  if (!index) {
    return undefined;
  }
  if (!sameBuildOptions(index.buildOptions, input.requestedBuildOptions)) {
    return undefined;
  }
  return isRepoIndexFresh(index) ? index : undefined;
}

function sameBuildOptions(left: NormalizedRepoIndexBuildOptions, right: NormalizedRepoIndexBuildOptions): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readReusableIndexManifest(input: { repoRoot: string; index: RepoIndex }): DurableIndexManifest | undefined {
  const manifest = readJson<DurableIndexManifest>(indexManifestPath(input.repoRoot));
  if (!manifest || manifest.fullIndex.fingerprint !== input.index.fingerprint) {
    return undefined;
  }
  const referencedPaths = [
    manifest.fullIndex.indexPath,
    ...manifest.lanes.map((lane) => lane.indexPath),
    ...(manifest.shards ?? []).map((shard) => shard.indexPath),
  ];
  return referencedPaths.every((manifestPath) => existsSync(manifestPath)) ? manifest : undefined;
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
  const sqliteIndex = readSqliteRepoIndexStatus(repoRoot);
  const factGraph = repoFactStoreStatus({ repoRoot, currentIndex: repoIndex });
  const semanticIndex = readJson<SemanticIndex>(semanticIndexPath(repoRoot));
  const repoIndexFresh = repoIndex ? isRepoIndexFresh(repoIndex) : undefined;
  const repoIndexSummary = repoIndex ? summarizeRepoIndex(repoIndex) : undefined;
  return {
    repoRoot,
    ...(repoIndex && repoIndexSummary && repoIndexFresh !== undefined
      ? {
          repoIndex: {
            indexPath: repoIndexPath(repoRoot),
            fresh: repoIndexFresh,
            summary: repoIndexSummary,
            indexHealth: createDurableRepoIndexHealth({
              indexPath: repoIndexPath(repoRoot),
              fresh: repoIndexFresh,
              summary: repoIndexSummary,
            }),
          },
        }
      : {}),
    ...(sqliteIndex ? { sqliteIndex } : {}),
    ...(factGraph.present ? { factGraph } : {}),
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
  requireFresh?: boolean;
}): DurableShardedRepoIndexQueryResult {
  const repoRoot = path.resolve(input.repoRoot);
  const limit = input.limit ?? 10;
  const status = durableIndexStatus({ repoRoot });
  const statusHealth = status.sqliteIndex?.indexHealth ?? status.repoIndex?.indexHealth;
  const indexHealth =
    statusHealth ??
    createIndexHealthSnapshot({
      source: "durable_repo_index",
      present: false,
    });
  const warnings = durableIndexWarnings(indexHealth);
  const knownIndexPaths = [
    ...(status.sqliteIndex ? [status.sqliteIndex.indexPath] : []),
    ...(status.repoIndex ? [status.repoIndex.indexPath] : []),
  ];
  if (input.requireFresh && (indexHealth.status === "stale" || indexHealth.status === "missing")) {
    return {
      query: input.query,
      results: [],
      repoRoot,
      usedManifest: false,
      usedSqlite: false,
      queriedLanes: input.lanes ?? [],
      indexPaths: knownIndexPaths,
      shardCount: knownIndexPaths.length,
      indexHealth,
      warnings,
      retrievalMode: "refused",
      refused: true,
    };
  }
  const sqlite = querySqliteRepoIndex({
    repoRoot,
    query: input.query,
    lanes: input.lanes,
    limit,
  });
  if (sqlite) {
    return {
      query: sqlite.query,
      results: sqlite.results,
      repoRoot,
      usedManifest: false,
      usedSqlite: true,
      queriedLanes: sqlite.queriedLanes,
      indexPaths: [sqlite.indexPath],
      shardCount: 1,
      retrievalMode: sqlite.retrievalMode,
      indexHealth: status.sqliteIndex?.indexHealth ?? indexHealth,
      warnings,
    };
  }

  const manifest = readJson<DurableIndexManifest>(indexManifestPath(repoRoot));
  if (!manifest) {
    const fullIndex = readJson<RepoIndex>(repoIndexPath(repoRoot));
    const fallback = fullIndex
      ? queryRepoIndex(fullIndex, { query: input.query, limit })
      : {
          query: input.query,
          results: [],
          indexHealth,
        };
    const fallbackHealth = status.repoIndex?.indexHealth ?? fallback.indexHealth ?? indexHealth;
    return {
      ...fallback,
      repoRoot,
      usedManifest: false,
      usedSqlite: false,
      queriedLanes: [],
      indexPaths: fullIndex ? [repoIndexPath(repoRoot)] : [],
      shardCount: fullIndex ? 1 : 0,
      retrievalMode: "json",
      indexHealth: fallbackHealth,
      warnings: durableIndexWarnings(fallbackHealth),
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
    usedSqlite: false,
    queriedLanes,
    indexPaths,
    shardCount: indexPaths.length,
    retrievalMode: "manifest_json",
    indexHealth,
    warnings,
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

type EdgeLookup = Map<string, RepoIndexEdge[]>;

function createEdgeLookup(index: RepoIndex): EdgeLookup {
  const edgesBySourcePath: EdgeLookup = new Map();
  for (const edge of index.edges) {
    const sourcePath = fileForNode(edge.from);
    if (!sourcePath) {
      continue;
    }
    edgesBySourcePath.set(sourcePath, [...(edgesBySourcePath.get(sourcePath) ?? []), edge]);
  }
  return edgesBySourcePath;
}

function createRootShards(index: RepoIndex, repoRoot: string, edgeLookup: EdgeLookup): DurableIndexShardEntry[] {
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
      const shard = createFilteredShard(index, filePaths, shardId, edgeLookup);
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

function createFilteredShard(
  index: RepoIndex,
  shardFilePaths: string[],
  fingerprintSeed: string,
  edgeLookup: EdgeLookup,
): RepoIndex {
  const shardFilePathSet = new Set(shardFilePaths);
  const files = index.files.filter((file) => shardFilePathSet.has(file.path));
  const filePaths = new Set(files.map((file) => file.path));
  const symbols = index.symbols.filter((symbol) => filePaths.has(symbol.path));
  const edges = uniqueEdges(files.flatMap((file) => edgeLookup.get(file.path) ?? []));
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
    fingerprintEntries: [
      `extractor:${index.extractorVersion ?? "unknown"}`,
      ...files.map((file) => `indexed:${file.path}:${file.byteLength}:${file.hash}`),
    ],
    files,
    symbols,
    edges,
    skippedFiles,
    truncated: skippedFiles.length > 0,
  };
}

function uniqueEdges(edges: RepoIndexEdge[]): RepoIndexEdge[] {
  const seen = new Set<string>();
  const output: RepoIndexEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.kind}\0${edge.line ?? ""}\0${edge.label ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(edge);
  }
  return output;
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

function createDurableRepoIndexHealth(input: {
  indexPath: string;
  fresh: boolean;
  summary: RepoIndexSummary;
}): IndexHealthSnapshot {
  return createIndexHealthSnapshot({
    source: "durable_repo_index",
    present: true,
    fresh: input.fresh,
    truncated: input.summary.truncated,
    builtAt: input.summary.builtAt,
    indexPath: input.indexPath,
    fileCount: input.summary.fileCount,
    skippedFiles: input.summary.skippedFiles,
    languageCoverage: input.summary.indexHealth.languageCoverage,
    reasons: input.summary.indexHealth.languageCoverage.flatMap((coverage) => coverage.reasons),
  });
}

function durableIndexWarnings(health: IndexHealthSnapshot): string[] {
  if (health.status === "stale") {
    return ["Durable repo index is stale; refresh before relying on generated repo guidance."];
  }
  if (health.status === "missing") {
    return ["Durable repo index is missing; build it before relying on generated repo guidance."];
  }
  if (health.status === "degraded") {
    return ["Durable repo index is degraded; inspect index limits before treating coverage as complete."];
  }
  if (health.status === "unknown") {
    return ["Durable repo index freshness is unknown."];
  }
  return [];
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
