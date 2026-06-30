import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExecutionFlowRecord } from "./execution-flow-store.js";
import type { GraphCommunityRecord } from "./graph-communities.js";
import type { RepoIndex } from "./repo-index.js";
import {
  buildSemanticIndex,
  semanticSearch,
  type SemanticIndex,
  type SemanticIndexRecord,
  type SemanticRecordInput,
} from "./semantic-search.js";

export type GraphNodeKind = "file" | "symbol" | "community" | "flow";

export type GraphNodeSemanticRecord = SemanticRecordInput & {
  kind: GraphNodeKind;
};

export type GraphNodeSemanticIndex = Omit<SemanticIndex, "records"> & {
  repoRoot: string;
  fingerprint: string;
  records: Array<SemanticIndexRecord & { kind: GraphNodeKind }>;
};

export type GraphNodeSemanticSearchResult = {
  query: string;
  provider: SemanticIndex["provider"];
  fingerprint?: string;
  results: Array<{
    id: string;
    path?: string;
    kind: GraphNodeKind;
    score: number;
    excerpt: string;
  }>;
  refused?: true;
  reason?: string;
  hint?: string;
};

const STORE_RELATIVE_PATH = ".wormhole/indexes/graph-node-semantic-index.json";
const REFRESH_HINT = "Run graph_node_semantic_index_refresh before graph_node_semantic_search.";

export function createGraphNodeSemanticRecords(input: {
  index: RepoIndex;
  communities?: GraphCommunityRecord[];
  flows?: ExecutionFlowRecord[];
}): GraphNodeSemanticRecord[] {
  const communityByFile = createCommunityByFile(input.communities ?? []);
  const records: GraphNodeSemanticRecord[] = [];
  for (const file of input.index.files) {
    records.push({
      id: `graph:file:${file.path}`,
      kind: "file",
      path: file.path,
      text: [
        `file ${file.path}`,
        `language ${file.language}`,
        `communities ${(communityByFile.get(file.path) ?? []).join(" ")}`,
        `symbols ${file.symbols.map((symbol) => symbol.name).join(" ")}`,
        file.content.slice(0, 2_000),
      ].join("\n"),
    });
  }
  for (const symbol of input.index.symbols) {
    records.push({
      id: `graph:symbol:${symbol.id}`,
      kind: "symbol",
      path: symbol.path,
      text: [
        `symbol ${symbol.name}`,
        `kind ${symbol.kind}`,
        `file ${symbol.path}`,
        `line ${symbol.line}`,
        `communities ${(communityByFile.get(symbol.path) ?? []).join(" ")}`,
      ].join("\n"),
    });
  }
  for (const community of input.communities ?? []) {
    records.push({
      id: `graph:community:${community.id}`,
      kind: "community",
      text: [
        `community ${community.id}`,
        `label ${community.label}`,
        `files ${community.topFiles.join(" ")}`,
        `members ${community.members.join(" ")}`,
      ].join("\n"),
    });
  }
  for (const flow of input.flows ?? []) {
    records.push({
      id: `graph:flow:${flow.id}`,
      kind: "flow",
      path: flow.path,
      text: [
        `flow ${flow.name}`,
        `kind ${flow.kind}`,
        `entrypoint ${flow.path}`,
        `symbol ${flow.symbol ?? ""}`,
        `command ${flow.command ?? ""}`,
        `downstream ${flow.downstreamFiles.join(" ")}`,
        `communities ${flow.communityIds.join(" ")}`,
      ].join("\n"),
    });
  }
  return records;
}

export function refreshGraphNodeSemanticIndex(input: {
  repoRoot: string;
  index: RepoIndex;
  communities?: GraphCommunityRecord[];
  flows?: ExecutionFlowRecord[];
}): GraphNodeSemanticIndex {
  const repoRoot = path.resolve(input.repoRoot);
  const records = createGraphNodeSemanticRecords(input);
  const semanticIndex = buildSemanticIndex({ records });
  const index: GraphNodeSemanticIndex = {
    ...semanticIndex,
    repoRoot,
    fingerprint: input.index.fingerprint,
    records: semanticIndex.records.map((record) => ({
      ...record,
      kind: records.find((candidate) => candidate.id === record.id)?.kind ?? "file",
    })),
  };
  writeJson(storePath(repoRoot), index);
  return index;
}

export function searchGraphNodeSemanticIndex(input: {
  repoRoot: string;
  query: string;
  limit?: number;
  kinds?: GraphNodeKind[];
  currentFingerprint?: string;
}): GraphNodeSemanticSearchResult {
  const index = readGraphNodeSemanticIndex(input.repoRoot);
  if (!index) {
    return {
      query: input.query,
      provider: "deterministic-token-overlap",
      results: [],
      refused: true,
      reason: "Graph-node semantic index is missing.",
      hint: REFRESH_HINT,
    };
  }
  if (input.currentFingerprint && index.fingerprint !== input.currentFingerprint) {
    return {
      query: input.query,
      provider: index.provider,
      fingerprint: index.fingerprint,
      results: [],
      refused: true,
      reason: "Graph-node semantic index is stale for the current repo index.",
      hint: REFRESH_HINT,
    };
  }
  const requestedKinds = new Set(input.kinds ?? ["file", "symbol", "community", "flow"]);
  const filteredIndex: SemanticIndex = {
    indexId: index.indexId,
    provider: index.provider,
    records: index.records.filter((record) => requestedKinds.has(record.kind)),
  };
  const search = semanticSearch(filteredIndex, { query: input.query, limit: input.limit });
  const recordById = new Map(index.records.map((record) => [record.id, record]));
  return {
    query: search.query,
    provider: search.provider,
    fingerprint: index.fingerprint,
    results: search.results.map((result) => ({
      ...result,
      kind: recordById.get(result.id)?.kind ?? "file",
    })),
  };
}

export function readGraphNodeSemanticIndex(repoRoot: string): GraphNodeSemanticIndex | undefined {
  return readJson<GraphNodeSemanticIndex>(storePath(path.resolve(repoRoot)));
}

export function graphNodeSemanticIndexPath(repoRoot: string): string {
  return storePath(path.resolve(repoRoot));
}

function createCommunityByFile(communities: GraphCommunityRecord[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const community of communities) {
    for (const member of community.members) {
      const file = fileForNode(member);
      if (!file) {
        continue;
      }
      result.set(file, [...(result.get(file) ?? []), community.id].sort((left, right) => left.localeCompare(right)));
    }
  }
  return result;
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
