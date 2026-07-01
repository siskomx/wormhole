import { createIndexHealthSnapshot, type IndexHealthSnapshot } from "./index-health.js";
import {
  buildRepoIndex,
  createRepoIndexHealth,
  isRepoIndexFresh,
  type RepoIndex,
  type RepoIndexSymbol,
} from "./repo-index.js";
import { createRepoFactGraphFromIndex, type RepoFactGraph } from "./repo-facts.js";
import { queryRepoRelations } from "./relation-query.js";

export const CONFIDENCE_RELATION_TEST = 0.95;
export const CONFIDENCE_SYMBOL_REFERENCE_TEST = 0.85;
export const CONFIDENCE_BASENAME_TEST = 0.75;
export const CONFIDENCE_INFERRED_IMPACT = 0.6;

export type DiffHunk = {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
};

export type ChangeImpactResult = {
  repoRoot: string;
  fingerprint?: string;
  changedFiles: string[];
  changedSymbols: RepoIndexSymbol[];
  impactedFiles: Array<{ path: string; confidence: number; relationPath: string[]; reason: string }>;
  impactedTests: Array<{ path: string; confidence: number; relationPath: string[]; reason: string }>;
  riskLevel: "low" | "medium" | "high";
  warnings: string[];
  indexHealth: IndexHealthSnapshot;
};

export function analyzeChangeImpact(input: {
  repoRoot: string;
  changedFiles: string[];
  diffText?: string;
  index?: RepoIndex;
  factGraph?: RepoFactGraph;
  maxDepth?: number;
  maxChangedSymbols?: number;
  requireFresh?: boolean;
}): ChangeImpactResult {
  const changedFiles = uniqueSorted(input.changedFiles.map(toRepoPath));
  const index = input.index ?? buildRepoIndex({ repoRoot: input.repoRoot });
  const indexHealth = createRepoIndexHealth(index);
  const graph = input.factGraph ?? createRepoFactGraphFromIndex({ index });
  const warnings: string[] = [...graph.warnings];

  if (input.requireFresh && !isRepoIndexFresh(index)) {
    return {
      repoRoot: input.repoRoot,
      fingerprint: index.fingerprint,
      changedFiles,
      changedSymbols: [],
      impactedFiles: [],
      impactedTests: [],
      riskLevel: "high",
      warnings: ["Change impact analysis refused stale repo index state."],
      indexHealth,
    };
  }

  const hunks = parseUnifiedDiff(input.diffText ?? "", changedFiles);
  const selectedChangedSymbols = selectChangedSymbols(index, changedFiles, hunks);
  const maxChangedSymbols =
    input.maxChangedSymbols === undefined
      ? selectedChangedSymbols.length
      : Math.max(0, Math.floor(input.maxChangedSymbols));
  const changedSymbols = selectedChangedSymbols.slice(0, maxChangedSymbols);
  if (selectedChangedSymbols.length > changedSymbols.length) {
    warnings.push(
      `Changed symbol expansion capped at ${changedSymbols.length} of ${selectedChangedSymbols.length} symbols.`,
    );
  }
  const impactedFiles = new Map<string, ChangeImpactResult["impactedFiles"][number]>();
  const impactedTests = new Map<string, ChangeImpactResult["impactedTests"][number]>();

  for (const changedFile of changedFiles) {
    addRelationImpacts({
      repoRoot: input.repoRoot,
      graph,
      endpoint: changedFile,
      maxDepth: input.maxDepth,
      requireFresh: input.requireFresh,
      impactedFiles,
      impactedTests,
      warnings,
    });
  }

  for (const symbol of changedSymbols) {
    addRelationImpacts({
      repoRoot: input.repoRoot,
      graph,
      endpoint: symbol.id,
      maxDepth: input.maxDepth,
      requireFresh: input.requireFresh,
      impactedFiles,
      impactedTests,
      warnings,
    });
    addTestsForChangedSymbol({ index, symbol, impactedTests });
  }

  addBasenameTestFallbacks({ index, changedFiles, impactedTests });

  if (impactedTests.size === 0) {
    warnings.push("No likely tests were found for changed files or symbols.");
  }

  return {
    repoRoot: input.repoRoot,
    fingerprint: index.fingerprint,
    changedFiles,
    changedSymbols,
    impactedFiles: [...impactedFiles.values()].sort(compareImpactEntries),
    impactedTests: [...impactedTests.values()].sort(compareImpactEntries),
    riskLevel: riskLevelFor(impactedFiles.size, impactedTests.size),
    warnings: uniqueSorted(warnings),
    indexHealth,
  };
}

export function parseUnifiedDiff(diffText: string, changedFiles: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentFile = changedFiles[0] ?? "";
  for (const line of diffText.split(/\r?\n/)) {
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (fileMatch?.[2]) {
      currentFile = fileMatch[2];
      continue;
    }
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunkMatch) {
      continue;
    }
    hunks.push({
      file: currentFile,
      oldStart: Number(hunkMatch[1]),
      oldLines: Number(hunkMatch[2] ?? 1),
      newStart: Number(hunkMatch[3]),
      newLines: Number(hunkMatch[4] ?? 1),
    });
  }
  return hunks;
}

function addRelationImpacts(input: {
  repoRoot: string;
  graph: RepoFactGraph;
  endpoint: string;
  maxDepth?: number;
  requireFresh?: boolean;
  impactedFiles: Map<string, ChangeImpactResult["impactedFiles"][number]>;
  impactedTests: Map<string, ChangeImpactResult["impactedTests"][number]>;
  warnings: string[];
}): void {
  const relation = queryRepoRelations({
    repoRoot: input.repoRoot,
    graph: input.graph,
    to: input.endpoint,
    direction: "inbound",
    kinds: ["imports", "references", "calls", "tests", "tested_by"],
    maxDepth: input.maxDepth ?? 3,
    limit: 100,
    requireFresh: input.requireFresh,
  });
  input.warnings.push(...relation.warnings);
  if (relation.refused) {
    return;
  }

  for (const edge of relation.edges) {
    const fromPath = pathFromFactEndpoint(edge.from);
    const toPath = pathFromFactEndpoint(edge.to);
    const path = edge.kind === "tested_by" ? toPath : fromPath;
    if (!path) {
      continue;
    }
    if (isTestPath(path)) {
      addOrUpgrade(input.impactedTests, {
        path,
        confidence: CONFIDENCE_RELATION_TEST,
        relationPath: [`${edge.from} -${edge.kind}-> ${edge.to}`],
        reason: `Relation ${edge.kind} connects this test to changed code.`,
      });
    } else {
      addOrUpgrade(input.impactedFiles, {
        path,
        confidence: edge.provenance === "inferred" ? CONFIDENCE_INFERRED_IMPACT : edge.confidence,
        relationPath: [`${edge.from} -${edge.kind}-> ${edge.to}`],
        reason: `Relation ${edge.kind} connects this file to changed code.`,
      });
    }
  }

  for (const relationPath of relation.paths) {
    const relationPathLabels = relationPath.edges.map((edge) => `${edge.from} -${edge.kind}-> ${edge.to}`);
    for (const node of relationPath.nodes) {
      if (!node.path || node.path === input.endpoint || node.kind === "symbol") {
        continue;
      }
      if (isTestPath(node.path)) {
        addOrUpgrade(input.impactedTests, {
          path: node.path,
          confidence: CONFIDENCE_RELATION_TEST,
          relationPath: relationPathLabels,
          reason: relationPath.reason,
        });
      } else {
        addOrUpgrade(input.impactedFiles, {
          path: node.path,
          confidence: Math.max(CONFIDENCE_INFERRED_IMPACT, relationPath.score),
          relationPath: relationPathLabels,
          reason: relationPath.reason,
        });
      }
    }
  }
}

function addTestsForChangedSymbol(input: {
  index: RepoIndex;
  symbol: RepoIndexSymbol;
  impactedTests: Map<string, ChangeImpactResult["impactedTests"][number]>;
}): void {
  for (const file of input.index.files) {
    if (!isTestPath(file.path) || !file.content.includes(input.symbol.name)) {
      continue;
    }
    addOrUpgrade(input.impactedTests, {
      path: file.path,
      confidence: CONFIDENCE_SYMBOL_REFERENCE_TEST,
      relationPath: [`symbol:${input.symbol.id}`],
      reason: `Test references changed symbol ${input.symbol.name}.`,
    });
  }
}

function addBasenameTestFallbacks(input: {
  index: RepoIndex;
  changedFiles: string[];
  impactedTests: Map<string, ChangeImpactResult["impactedTests"][number]>;
}): void {
  for (const file of input.index.files) {
    if (!isTestPath(file.path)) {
      continue;
    }
    for (const changedFile of input.changedFiles) {
      const basename = changedFile.replace(/\.[^.]+$/, "").split("/").pop() ?? changedFile;
      if (!file.content.includes(basename)) {
        continue;
      }
      addOrUpgrade(input.impactedTests, {
        path: file.path,
        confidence: CONFIDENCE_BASENAME_TEST,
        relationPath: [changedFile],
        reason: `Test references changed file ${changedFile}.`,
      });
    }
  }
}

function selectChangedSymbols(index: RepoIndex, changedFiles: string[], hunks: DiffHunk[]): RepoIndexSymbol[] {
  return index.symbols.filter((symbol) => {
    if (!changedFiles.includes(symbol.path)) {
      return false;
    }
    const fileHunks = hunks.filter((hunk) => hunk.file === symbol.path);
    if (fileHunks.length === 0) {
      return true;
    }
    return fileHunks.some(
      (hunk) => symbol.line >= hunk.newStart && symbol.line <= hunk.newStart + Math.max(1, hunk.newLines) - 1,
    );
  });
}

type ImpactEntry = {
  path: string;
  confidence: number;
  relationPath: string[];
  reason: string;
};

function addOrUpgrade<T extends ImpactEntry>(items: Map<string, T>, item: T): void {
  const existing = items.get(item.path);
  if (!existing || item.confidence > existing.confidence) {
    items.set(item.path, item);
    return;
  }
  if (item.reason && !existing.reason.includes(item.reason)) {
    items.set(item.path, {
      ...existing,
      reason: `${existing.reason} ${item.reason}`,
      relationPath: uniqueSorted([...existing.relationPath, ...item.relationPath]),
    });
  }
}

function pathFromFactEndpoint(endpoint: string): string | undefined {
  if (endpoint.startsWith("file:")) {
    return endpoint.slice("file:".length);
  }
  if (endpoint.startsWith("symbol:")) {
    return endpoint.slice("symbol:".length).split("#", 1)[0];
  }
  return undefined;
}

function riskLevelFor(impactedFileCount: number, impactedTestCount: number): "low" | "medium" | "high" {
  if (impactedTestCount === 0 || impactedFileCount > 5) {
    return "high";
  }
  if (impactedFileCount > 0) {
    return "medium";
  }
  return "low";
}

function compareImpactEntries<T extends { path: string; confidence: number }>(left: T, right: T): number {
  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence;
  }
  return left.path.localeCompare(right.path);
}

function isTestPath(filePath: string): boolean {
  return /(^|\/)(tests?|__tests__)\/|[._-](test|spec)\.[A-Za-z0-9]+$/.test(filePath);
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function missingChangeImpactHealth(): IndexHealthSnapshot {
  return createIndexHealthSnapshot({
    source: "repo_index",
    present: false,
    reasons: ["Change impact analysis could not load a repo index."],
  });
}
