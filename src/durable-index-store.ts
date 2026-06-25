import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildRepoIndex,
  isRepoIndexFresh,
  summarizeRepoIndex,
  type RepoIndex,
  type RepoIndexBuildOptions,
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

function repoIndexPath(repoRoot: string): string {
  return path.join(repoRoot, ".wormhole", "indexes", "repo-index.json");
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
