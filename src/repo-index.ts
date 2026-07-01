import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  createIndexHealthSnapshot,
  type IndexHealthSnapshot,
} from "./index-health.js";
import {
  detectLanguageProfile,
  INDEXABLE_TEXT_EXTENSIONS,
  isSupportedTextPath,
  languageForPath,
} from "./language-profile.js";
import {
  extractRepoFileFacts,
  type RepoIndexCallDraft,
  type RepoIndexEdgeDraft,
  type RepoIndexParserInfo,
} from "./repo-index-extraction.js";
import {
  walkRepoFiles,
  type RepoWalkSkipReason,
  type RepoWalkSkipped,
} from "./repo-walker.js";

export type RepoIndexSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "constant"
  | "section";

export type RepoIndexEdgeKind = "defines" | "imports" | "links" | "references" | "calls";
export type RepoIndexEdgeProvenance = "extracted" | "inferred" | "ambiguous";

export type RepoIndexSymbol = {
  id: string;
  name: string;
  kind: RepoIndexSymbolKind;
  path: string;
  line: number;
};

export type RepoIndexEdge = {
  from: string;
  to: string;
  kind: RepoIndexEdgeKind;
  provenance: RepoIndexEdgeProvenance;
  confidence: number;
  line?: number;
  label?: string;
};

export type RepoIndexFile = {
  path: string;
  language: string;
  parser?: RepoIndexParserInfo;
  lineCount: number;
  byteLength: number;
  mtimeMs: number;
  hash: string;
  symbols: RepoIndexSymbol[];
  content: string;
};

export type RepoIndexSizePreset = "default" | "large_repo";

export type NormalizedRepoIndexBuildOptions = {
  preset: RepoIndexSizePreset;
  include?: string[];
  exclude?: string[];
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth?: number;
  maxDirs?: number;
  maxElapsedMs?: number;
};

export type RepoIndex = {
  repoRoot: string;
  builtAt: string;
  buildOptions: NormalizedRepoIndexBuildOptions;
  extractorVersion?: string;
  fingerprint: string;
  fingerprintEntries?: string[];
  files: RepoIndexFile[];
  symbols: RepoIndexSymbol[];
  edges: RepoIndexEdge[];
  truncated: boolean;
  skippedFiles: string[];
  skipReasons?: RepoWalkSkipReason[];
};

export type RepoIndexAssemblyInput = {
  repoRoot: string;
  buildOptions: NormalizedRepoIndexBuildOptions;
  files: RepoIndexFile[];
  skippedFiles?: string[];
  skipReasons?: RepoWalkSkipReason[];
  fingerprintEntries?: string[];
  builtAt?: string;
};

export type RepoIndexBuildOptions = {
  repoRoot: string;
  preset?: RepoIndexSizePreset;
  include?: string[];
  exclude?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxDepth?: number;
  maxDirs?: number;
  maxElapsedMs?: number;
};

export type RepoIndexSummary = {
  repoRoot: string;
  builtAt: string;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  languages: Record<string, number>;
  truncated: boolean;
  skippedFiles: string[];
  indexHealth: IndexHealthSnapshot;
};

export type RepoGraphReport = {
  summary: string;
  edgeCountsByProvenance: Record<RepoIndexEdgeProvenance, number>;
  topFiles: Array<{ path: string; edgeCount: number }>;
  markdown: string;
  indexHealth: IndexHealthSnapshot;
};

export type RepoIndexQueryInput = {
  query: string;
  limit?: number;
};

export type RepoIndexSearchResult = {
  kind: "file" | "symbol";
  path: string;
  line?: number;
  score: number;
  title: string;
  excerpt: string;
};

export type RepoIndexQueryResult = {
  query: string;
  results: RepoIndexSearchResult[];
  indexHealth: IndexHealthSnapshot;
};

export type RepoIndexExplainInput = {
  target: string;
  limit?: number;
};

export type RepoIndexResolvedNode = {
  id: string;
  kind: "file" | "symbol";
  path: string;
  name?: string;
  line?: number;
};

export type RepoIndexExplanation = {
  target: string;
  resolved?: RepoIndexResolvedNode;
  symbols: RepoIndexSymbol[];
  inboundEdges: RepoIndexEdge[];
  outboundEdges: RepoIndexEdge[];
  indexHealth: IndexHealthSnapshot;
};

export type RepoIndexPathInput = {
  from: string;
  to: string;
  maxDepth?: number;
};

export type RepoIndexPathResult = {
  from: string;
  to: string;
  found: boolean;
  path: string[];
  indexHealth: IndexHealthSnapshot;
};

type EdgeDraft = RepoIndexEdgeDraft;

export const REPO_INDEX_EXTRACTOR_VERSION = "ast-v1";
const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const LARGE_REPO_MAX_FILES = 50_000;
const LARGE_REPO_MAX_FILE_BYTES = 1024 * 1024;
const LARGE_REPO_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_INFERRED_REFERENCES_PER_FILE = 200;
const MAX_SYMBOLS_PER_REFERENCE_NAME = 25;
const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".wormhole",
  "bin",
  "build",
  "coverage",
  "dist",
  "graphify-out",
  "node_modules",
  "obj",
  "out",
  "target",
]);

const LOCAL_RESOLUTION_EXTENSIONS = INDEXABLE_TEXT_EXTENSIONS;

export function buildRepoIndex(options: RepoIndexBuildOptions): RepoIndex {
  const repoRoot = path.resolve(options.repoRoot);
  assertRepoRoot(repoRoot);
  const buildOptions = normalizeRepoIndexBuildOptions(options);
  const startedAt = Date.now();
  const candidateResult = listCandidateFiles(repoRoot, buildOptions);
  const candidateFiles = candidateResult.files;
  const selectedFiles = candidateFiles.slice(0, buildOptions.maxFiles);
  const skippedFiles = [
    ...candidateFiles.slice(buildOptions.maxFiles),
    ...candidateResult.skipped.map((skipped) => skipped.path),
  ];
  const skipReasons = new Set<RepoWalkSkipReason>(candidateResult.reasons);
  const fingerprintEntries = createRepoIndexFingerprintBaseEntries({
    repoRoot,
    buildOptions,
    candidateFiles,
    skippedByWalk: candidateResult.skipped,
  });
  const files: RepoIndexFile[] = [];
  const symbols: RepoIndexSymbol[] = [];
  const edges: RepoIndexEdge[] = [];
  const edgeDrafts: EdgeDraft[] = [];
  const callDrafts: RepoIndexCallDraft[] = [];
  let totalBytes = 0;

  function elapsedLimitHit(): boolean {
    return buildOptions.maxElapsedMs !== undefined && Date.now() - startedAt >= buildOptions.maxElapsedMs;
  }

  for (const relativePath of selectedFiles) {
    if (elapsedLimitHit()) {
      skippedFiles.push(relativePath);
      skipReasons.add("time_limit");
      fingerprintEntries.push(`skipped-by-time:${relativePath}`);
      break;
    }
    const absolutePath = path.join(repoRoot, relativePath);
    const stat = statSync(absolutePath);
    if (
      stat.size > buildOptions.maxFileBytes ||
      totalBytes + stat.size > buildOptions.maxTotalBytes
    ) {
      skippedFiles.push(relativePath);
      fingerprintEntries.push(`skipped-by-size:${relativePath}:${stat.size}:${stat.mtimeMs}`);
      continue;
    }
    totalBytes += stat.size;

    const content = normalizeLineEndings(readFileSync(absolutePath, "utf8"));
    const language = languageForPath(relativePath);
    const extracted = extractRepoFileFacts({ path: relativePath, language, content });
    const fileSymbols = extracted.symbols;
    const file: RepoIndexFile = {
      path: relativePath,
      language,
      parser: extracted.parser,
      lineCount: countLines(content),
      byteLength: Buffer.byteLength(content, "utf8"),
      mtimeMs: stat.mtimeMs,
      hash: createHash("sha256").update(content).digest("hex"),
      symbols: fileSymbols,
      content,
    };
    fingerprintEntries.push(`indexed:${relativePath}:${stat.size}:${file.hash}`);
    files.push(file);
    pushAll(symbols, fileSymbols);
    pushAll(
      edges,
      fileSymbols.map((symbol) => ({
        from: relativePath,
        to: symbol.id,
        kind: "defines" as const,
        provenance: "extracted" as const,
        confidence: 1,
        line: symbol.line,
        label: symbol.name,
      })),
    );
    pushAll(edgeDrafts, extracted.edgeDrafts);
    pushAll(callDrafts, extracted.callDrafts);
  }

  if (!elapsedLimitHit()) {
    const knownFiles = new Set(files.map((file) => file.path));
    for (const draft of edgeDrafts) {
      if (elapsedLimitHit()) {
        break;
      }
      const target = resolveEdgeTarget(draft, knownFiles);
      if (!target) {
        continue;
      }
      edges.push({
        from: draft.from,
        to: target,
        kind: draft.kind,
        provenance: "extracted",
        confidence: 1,
        line: draft.line,
        label: draft.specifier,
      });
    }
    const skipGlobalInference = shouldSkipGlobalInference(buildOptions, files.length);
    if (skipGlobalInference) {
      skipReasons.add("time_limit");
    }
    if (!skipGlobalInference && !elapsedLimitHit()) {
      pushAll(edges, extractReferenceEdges(files, symbols, edges, elapsedLimitHit));
    }
    if (!skipGlobalInference && !elapsedLimitHit()) {
      pushAll(edges, extractCallEdges(files, symbols, edges, callDrafts, elapsedLimitHit));
    }
    if (elapsedLimitHit()) {
      skipReasons.add("time_limit");
    }
  } else {
    skipReasons.add("time_limit");
  }

  return {
    repoRoot,
    builtAt: new Date().toISOString(),
    buildOptions,
    extractorVersion: REPO_INDEX_EXTRACTOR_VERSION,
    fingerprint: createRepoIndexFingerprintFromEntries(fingerprintEntries),
    fingerprintEntries,
    files,
    symbols,
    edges,
    truncated: candidateFiles.length > selectedFiles.length || skippedFiles.length > 0 || skipReasons.size > 0,
    skippedFiles: uniqueSorted(skippedFiles),
    skipReasons: [...skipReasons].sort((left, right) => left.localeCompare(right)),
  };
}

export function extractRepoIndexFile(input: {
  repoRoot: string;
  relativePath: string;
}): RepoIndexFile | undefined {
  const repoRoot = path.resolve(input.repoRoot);
  assertRepoRoot(repoRoot);
  const relativePath = normalizeRepoRelativePath(input.relativePath);
  if (!isSupportedTextPath(relativePath)) {
    return undefined;
  }
  const absolutePath = path.join(repoRoot, relativePath);
  const stat = statSync(absolutePath);
  if (!stat.isFile()) {
    return undefined;
  }
  const content = normalizeLineEndings(readFileSync(absolutePath, "utf8"));
  return createRepoIndexFileFromContent({
    relativePath,
    content,
    mtimeMs: stat.mtimeMs,
  });
}

export function assembleRepoIndex(input: RepoIndexAssemblyInput): RepoIndex {
  const repoRoot = path.resolve(input.repoRoot);
  assertRepoRoot(repoRoot);
  const files = [...input.files].sort((left, right) => left.path.localeCompare(right.path));
  const symbols = files.flatMap((file) => file.symbols);
  const edges: RepoIndexEdge[] = [];
  const edgeDrafts: EdgeDraft[] = [];
  const callDrafts: RepoIndexCallDraft[] = [];

  for (const file of files) {
    edges.push(
      ...file.symbols.map((symbol) => ({
        from: file.path,
        to: symbol.id,
        kind: "defines" as const,
        provenance: "extracted" as const,
        confidence: 1,
        line: symbol.line,
        label: symbol.name,
      })),
    );
    const extracted = extractRepoFileFacts({
      path: file.path,
      language: file.language,
      content: file.content,
    });
    edgeDrafts.push(...extracted.edgeDrafts);
    callDrafts.push(...extracted.callDrafts);
  }

  const knownFiles = new Set(files.map((file) => file.path));
  for (const draft of edgeDrafts) {
    const target = resolveEdgeTarget(draft, knownFiles);
    if (!target) {
      continue;
    }
    edges.push({
      from: draft.from,
      to: target,
      kind: draft.kind,
      provenance: "extracted",
      confidence: 1,
      line: draft.line,
      label: draft.specifier,
    });
  }
  pushAll(edges, extractReferenceEdges(files, symbols, edges));
  pushAll(edges, extractCallEdges(files, symbols, edges, callDrafts));

  const fingerprintEntries =
    input.fingerprintEntries ??
    createRepoIndexFingerprintEntriesFromFiles({
      files,
      skippedFiles: input.skippedFiles ?? [],
    });

  return {
    repoRoot,
    builtAt: input.builtAt ?? new Date().toISOString(),
    buildOptions: input.buildOptions,
    extractorVersion: REPO_INDEX_EXTRACTOR_VERSION,
    fingerprint: createRepoIndexFingerprintFromEntries(fingerprintEntries),
    fingerprintEntries,
    files,
    symbols,
    edges,
    truncated: (input.skippedFiles?.length ?? 0) > 0 || (input.skipReasons?.length ?? 0) > 0,
    skippedFiles: uniqueSorted(input.skippedFiles ?? []),
    skipReasons: uniqueSorted(input.skipReasons ?? []) as RepoWalkSkipReason[],
  };
}

function assertRepoRoot(repoRoot: string): void {
  try {
    if (!statSync(repoRoot).isDirectory()) {
      throw new Error(`Repo root is not a directory: ${repoRoot}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Repo root is not a directory:")) {
      throw error;
    }
    throw new Error(`Repo root does not exist or cannot be read: ${repoRoot}`);
  }
}

export function normalizeRepoIndexBuildOptions(
  options: RepoIndexBuildOptions | NormalizedRepoIndexBuildOptions,
): NormalizedRepoIndexBuildOptions {
  const preset = options.preset ?? "default";
  const presetLimits =
    preset === "large_repo"
      ? {
          maxFiles: LARGE_REPO_MAX_FILES,
          maxFileBytes: LARGE_REPO_MAX_FILE_BYTES,
          maxTotalBytes: LARGE_REPO_MAX_TOTAL_BYTES,
        }
      : {
          maxFiles: DEFAULT_MAX_FILES,
          maxFileBytes: DEFAULT_MAX_FILE_BYTES,
          maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
        };
  return {
    preset,
    include: normalizePatternList(options.include),
    exclude: normalizePatternList(options.exclude),
    maxFiles: options.maxFiles ?? presetLimits.maxFiles,
    maxFileBytes: options.maxFileBytes ?? presetLimits.maxFileBytes,
    maxTotalBytes: options.maxTotalBytes ?? presetLimits.maxTotalBytes,
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.maxDirs === undefined ? {} : { maxDirs: options.maxDirs }),
    ...(options.maxElapsedMs === undefined ? {} : { maxElapsedMs: options.maxElapsedMs }),
  };
}

export function createRepoIndexCacheKey(options: RepoIndexBuildOptions): string {
  return JSON.stringify({
    repoRoot: path.resolve(options.repoRoot),
    ...normalizeRepoIndexBuildOptions(options),
  });
}

export function isRepoIndexFresh(index: RepoIndex): boolean {
  if (index.extractorVersion !== REPO_INDEX_EXTRACTOR_VERSION) {
    return false;
  }
  if (isTimeLimitedIndex(index)) {
    return storedFingerprintEntriesStillMatch(index);
  }
  try {
    return index.fingerprint === createRepoIndexFingerprint(index.repoRoot, index.buildOptions);
  } catch {
    return false;
  }
}

function shouldSkipGlobalInference(buildOptions: NormalizedRepoIndexBuildOptions, fileCount: number): boolean {
  return buildOptions.maxElapsedMs !== undefined && fileCount > DEFAULT_MAX_FILES;
}

function isTimeLimitedIndex(index: RepoIndex): boolean {
  return Boolean(
    index.skipReasons?.includes("time_limit") ||
      index.fingerprintEntries?.some((entry) => entry.startsWith("skipped-by-time:")),
  );
}

function storedFingerprintEntriesStillMatch(index: RepoIndex): boolean {
  const entries = index.fingerprintEntries;
  if (!entries || createRepoIndexFingerprintFromEntries(entries) !== index.fingerprint) {
    return false;
  }
  try {
    for (const entry of entries) {
      if (entry === `extractor:${REPO_INDEX_EXTRACTOR_VERSION}`) {
        continue;
      }
      const indexed = parseIndexedFingerprintEntry(entry);
      if (indexed) {
        const absolutePath = path.join(index.repoRoot, indexed.path);
        const stat = statSync(absolutePath);
        if (!stat.isFile() || stat.size !== indexed.size) {
          return false;
        }
        const contentHash = createHash("sha256")
          .update(normalizeLineEndings(readFileSync(absolutePath, "utf8")))
          .digest("hex");
        if (contentHash !== indexed.hash) {
          return false;
        }
        continue;
      }
      const skipped = parseSkippedFingerprintEntry(entry);
      if (skipped) {
        const absolutePath = path.join(index.repoRoot, skipped.path);
        const stat = statSync(absolutePath);
        if (!stat.isFile() || stat.size !== skipped.size) {
          return false;
        }
        continue;
      }
      const skippedByTime = parseSkippedByTimeEntry(entry);
      if (skippedByTime && !statSync(path.join(index.repoRoot, skippedByTime.path)).isFile()) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function parseIndexedFingerprintEntry(entry: string): { path: string; size: number; hash: string } | undefined {
  const match = /^indexed:(.*):(\d+):([a-f0-9]{64})$/i.exec(entry);
  if (!match) {
    return undefined;
  }
  return { path: match[1] ?? "", size: Number(match[2] ?? 0), hash: match[3] ?? "" };
}

function parseSkippedFingerprintEntry(entry: string): { path: string; size: number } | undefined {
  const match = /^skipped-by-(?:size|count):(.*):(\d+):/.exec(entry);
  if (!match) {
    return undefined;
  }
  return { path: match[1] ?? "", size: Number(match[2] ?? 0) };
}

function parseSkippedByTimeEntry(entry: string): { path: string } | undefined {
  const match = /^skipped-by-time:(.*)$/.exec(entry);
  return match ? { path: match[1] ?? "" } : undefined;
}

export function summarizeRepoIndex(index: RepoIndex): RepoIndexSummary {
  const languages: Record<string, number> = {};
  for (const file of index.files) {
    languages[file.language] = (languages[file.language] ?? 0) + 1;
  }

  return {
    repoRoot: index.repoRoot,
    builtAt: index.builtAt,
    fileCount: index.files.length,
    symbolCount: index.symbols.length,
    edgeCount: index.edges.length,
    languages,
    truncated: index.truncated,
    skippedFiles: [...index.skippedFiles],
    indexHealth: createRepoIndexHealth(index),
  };
}

export function createRepoIndexHealth(index: RepoIndex): IndexHealthSnapshot {
  const languageProfile = detectLanguageProfile({
    repoRoot: index.repoRoot,
    indexedFiles: index.files.map((file) => file.path),
    maxDepth: index.buildOptions.maxDepth,
    maxDirs: index.buildOptions.maxDirs,
    maxElapsedMs: index.buildOptions.maxElapsedMs,
  });
  const parserFallbackCount = index.files.filter((file) =>
    file.parser?.reason?.startsWith("PARSER_FALLBACK:"),
  ).length;
  const parserReasons =
    parserFallbackCount > 0
      ? [`PARSER_FALLBACK: ${parserFallbackCount} parser-capable files used fallback extraction.`]
      : [];
  const traversalReasons = (index.skipReasons ?? []).map((reason) => `repo_index_${reason}`);
  return createIndexHealthSnapshot({
    source: "repo_index",
    present: true,
    truncated: index.truncated,
    builtAt: index.builtAt,
    fingerprint: index.fingerprint,
    fileCount: index.files.length,
    skippedFiles: index.skippedFiles,
    languageCoverage: languageProfile.languages,
    reasons: [...languageProfile.health.reasons, ...parserReasons, ...traversalReasons],
  });
}

export function getRepoGraphReport(index: RepoIndex): RepoGraphReport {
  const indexHealth = createRepoIndexHealth(index);
  const edgeCountsByProvenance: Record<RepoIndexEdgeProvenance, number> = {
    extracted: 0,
    inferred: 0,
    ambiguous: 0,
  };
  const edgeCountsByFile = new Map<string, number>();
  for (const edge of index.edges) {
    edgeCountsByProvenance[edge.provenance] += 1;
    edgeCountsByFile.set(edge.from, (edgeCountsByFile.get(edge.from) ?? 0) + 1);
  }
  const topFiles = [...edgeCountsByFile.entries()]
    .map(([path, edgeCount]) => ({ path, edgeCount }))
    .sort((left, right) => {
      if (right.edgeCount !== left.edgeCount) {
        return right.edgeCount - left.edgeCount;
      }
      return left.path.localeCompare(right.path);
    })
    .slice(0, 10);
  const summary = `${index.files.length} files, ${index.symbols.length} symbols, ${index.edges.length} edges`;
  const markdown = [
    "## Native Repo Graph Report",
    "",
    summary,
    "",
    "### Edge Provenance",
    "",
    `- extracted: ${edgeCountsByProvenance.extracted}`,
    `- inferred: ${edgeCountsByProvenance.inferred}`,
    `- ambiguous: ${edgeCountsByProvenance.ambiguous}`,
    "",
    "### Top Files",
    "",
    ...topFiles.map((file) => `- ${file.path}: ${file.edgeCount} edges`),
    "",
    "### Index Health",
    "",
    `- status: ${indexHealth.status}`,
    `- recommended action: ${indexHealth.recommendedAction}`,
    `- truncated: ${indexHealth.truncated}`,
    `- skipped files: ${indexHealth.skippedFileCount}`,
    ...indexHealth.reasons.slice(0, 8).map((reason) => `- reason: ${reason}`),
  ].join("\n");
  return {
    summary,
    edgeCountsByProvenance,
    topFiles,
    markdown,
    indexHealth,
  };
}

export function queryRepoIndex(
  index: RepoIndex,
  input: RepoIndexQueryInput,
): RepoIndexQueryResult {
  const limit = input.limit ?? 10;
  const tokens = tokenize(input.query);
  if (tokens.length === 0 || limit <= 0) {
    return { query: input.query, results: [], indexHealth: createRepoIndexHealth(index) };
  }

  const queryLower = input.query.toLowerCase();
  const results: RepoIndexSearchResult[] = [];

  for (const symbol of index.symbols) {
    const haystack = `${symbol.name} ${symbol.kind} ${symbol.path}`;
    const score = scoreText(haystack, tokens, queryLower) + scoreText(symbol.name, tokens) * 3;
    if (score > 0) {
      results.push({
        kind: "symbol",
        path: symbol.path,
        line: symbol.line,
        score: score + 5,
        title: `${symbol.kind} ${symbol.name}`,
        excerpt: `${symbol.kind} ${symbol.name} in ${symbol.path}:${symbol.line}`,
      });
    }
  }

  for (const file of index.files) {
    const pathScore = scoreText(`${file.path} ${file.language}`, tokens, queryLower) * 2;
    const symbolScore = scoreText(
      `${file.symbols.map((symbol) => symbol.name).join(" ")} ${graphTextForFile(
        index,
        file.path,
      )}`,
      tokens,
      queryLower,
    );
    if (pathScore + symbolScore > 0) {
      results.push({
        kind: "file",
        path: file.path,
        line: 1,
        score: pathScore + symbolScore,
        title: file.path,
        excerpt: file.path,
      });
    }

    const lines = file.content.split("\n");
    for (let indexInFile = 0; indexInFile < lines.length; indexInFile += 1) {
      const line = lines[indexInFile] ?? "";
      const lineScore = scoreText(line, tokens, queryLower);
      if (lineScore === 0) {
        continue;
      }
      results.push({
        kind: "file",
        path: file.path,
        line: indexInFile + 1,
        score: lineScore + pathScore + symbolScore,
        title: `${file.path}:${indexInFile + 1}`,
        excerpt: compactLine(line),
      });
    }
  }

  return {
    query: input.query,
    results: results
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.path !== right.path) {
          return left.path.localeCompare(right.path);
        }
        return (left.line ?? 0) - (right.line ?? 0);
      })
      .slice(0, limit),
    indexHealth: createRepoIndexHealth(index),
  };
}

export function explainRepoIndex(
  index: RepoIndex,
  input: RepoIndexExplainInput,
): RepoIndexExplanation {
  const limit = input.limit ?? 10;
  const resolved = resolveBestNode(index, input.target);
  if (!resolved) {
    return {
      target: input.target,
      symbols: [],
      inboundEdges: [],
      outboundEdges: [],
      indexHealth: createRepoIndexHealth(index),
    };
  }

  const relatedNodeIds = new Set([resolved.id, resolved.path]);
  const symbols = index.symbols
    .filter((symbol) => symbol.path === resolved.path)
    .slice(0, limit);

  return {
    target: input.target,
    resolved,
    symbols,
    inboundEdges: index.edges
      .filter((edge) => relatedNodeIds.has(edge.to))
      .slice(0, limit),
    outboundEdges: index.edges
      .filter((edge) => relatedNodeIds.has(edge.from))
      .slice(0, limit),
    indexHealth: createRepoIndexHealth(index),
  };
}

export function findRepoIndexPath(
  index: RepoIndex,
  input: RepoIndexPathInput,
): RepoIndexPathResult {
  const maxDepth = input.maxDepth ?? 6;
  const starts = resolveCandidateNodeIds(index, input.from);
  const goals = new Set(resolveCandidateNodeIds(index, input.to));

  if (starts.length === 0 || goals.size === 0) {
    return {
      from: input.from,
      to: input.to,
      found: false,
      path: [],
      indexHealth: createRepoIndexHealth(index),
    };
  }

  const adjacency = createAdjacency(index);
  const queue: Array<{ node: string; path: string[] }> = starts.map((node) => ({
    node,
    path: [node],
  }));
  const seen = new Set(starts);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (goals.has(current.node)) {
      return {
        from: input.from,
        to: input.to,
        found: true,
        path: current.path.map((node) => labelNode(index, node)),
        indexHealth: createRepoIndexHealth(index),
      };
    }
    if (current.path.length > maxDepth) {
      continue;
    }

    for (const next of adjacency.get(current.node) ?? []) {
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      queue.push({ node: next, path: [...current.path, next] });
    }
  }

  return {
    from: input.from,
    to: input.to,
    found: false,
    path: [],
    indexHealth: createRepoIndexHealth(index),
  };
}

function listCandidateFiles(
  repoRoot: string,
  options: Pick<
    NormalizedRepoIndexBuildOptions,
    "include" | "exclude" | "maxDepth" | "maxDirs" | "maxElapsedMs"
  >,
): { files: string[]; skipped: RepoWalkSkipped[]; reasons: RepoWalkSkipReason[] } {
  const result = walkRepoFiles(repoRoot, {
    excludedDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
    maxDepth: options.maxDepth,
    maxDirs: options.maxDirs,
    maxElapsedMs: options.maxElapsedMs,
    shouldSkipDirectory: (relativePath) => matchesAny(relativePath, options.exclude),
    shouldIncludeFile: (relativePath) =>
      isSupportedTextPath(relativePath) &&
      matchesInclude(relativePath, options.include) &&
      !matchesAny(relativePath, options.exclude),
  });
  return {
    files: result.files.map((file) => file.relativePath),
    skipped: result.skipped,
    reasons: result.reasons,
  };
}

function extractReferenceEdges(
  files: RepoIndexFile[],
  symbols: RepoIndexSymbol[],
  existingEdges: RepoIndexEdge[],
  shouldStop: () => boolean = () => false,
): RepoIndexEdge[] {
  const existingKeys = new Set(
    existingEdges.map((edge) => `${edge.from}\0${edge.to}\0${edge.kind}`),
  );
  const symbolsByName = new Map<string, RepoIndexSymbol[]>();
  for (const symbol of symbols) {
    if (symbol.name.length < 3) {
      continue;
    }
    symbolsByName.set(symbol.name, [...(symbolsByName.get(symbol.name) ?? []), symbol]);
  }
  const edges: RepoIndexEdge[] = [];

  for (const file of files) {
    if (shouldStop()) {
      break;
    }
    let referenceCount = 0;
    for (const token of identifierTokens(file.content)) {
      if (shouldStop()) {
        break;
      }
      const matchingSymbols = symbolsByName.get(token);
      if (!matchingSymbols) {
        continue;
      }
      if (matchingSymbols.length > MAX_SYMBOLS_PER_REFERENCE_NAME) {
        continue;
      }
      for (const symbol of matchingSymbols) {
        if (referenceCount >= MAX_INFERRED_REFERENCES_PER_FILE) {
          break;
        }
        if (symbol.path === file.path) {
          continue;
        }
        const key = `${file.path}\0${symbol.id}\0references`;
        if (existingKeys.has(key)) {
          continue;
        }
        existingKeys.add(key);
        edges.push({
          from: file.path,
          to: symbol.id,
          kind: "references",
          provenance: "inferred",
          confidence: 0.7,
          label: symbol.name,
        });
        referenceCount += 1;
      }
      if (referenceCount >= MAX_INFERRED_REFERENCES_PER_FILE) {
        break;
      }
    }
  }

  return edges;
}

function extractCallEdges(
  files: RepoIndexFile[],
  symbols: RepoIndexSymbol[],
  existingEdges: RepoIndexEdge[],
  callDrafts: RepoIndexCallDraft[],
  shouldStop: () => boolean = () => false,
): RepoIndexEdge[] {
  const existingKeys = new Set(
    existingEdges.map((edge) => `${edge.from}\0${edge.to}\0${edge.kind}`),
  );
  const symbolsByPath = new Map<string, RepoIndexSymbol[]>();
  const functionSymbolsByName = new Map<string, RepoIndexSymbol[]>();
  for (const symbol of symbols) {
    symbolsByPath.set(symbol.path, [...(symbolsByPath.get(symbol.path) ?? []), symbol]);
    if (symbol.kind === "function") {
      functionSymbolsByName.set(symbol.name, [
        ...(functionSymbolsByName.get(symbol.name) ?? []),
        symbol,
      ]);
    }
  }

  const edges: RepoIndexEdge[] = [];

  function addCallEdge(
    caller: RepoIndexSymbol,
    callee: RepoIndexSymbol,
    confidence: number,
    line?: number,
  ): void {
    if (callee.id === caller.id || callee.kind !== "function") {
      return;
    }
    const key = `${caller.id}\0${callee.id}\0calls`;
    if (existingKeys.has(key)) {
      return;
    }
    existingKeys.add(key);
    edges.push({
      from: caller.id,
      to: callee.id,
      kind: "calls",
      provenance: "inferred",
      confidence,
      label: callee.name,
      line: line ?? caller.line,
    });
  }

  for (const draft of callDrafts) {
    if (shouldStop()) {
      break;
    }
    const fileSymbols = (symbolsByPath.get(draft.path) ?? []).sort((left, right) => left.line - right.line);
    const caller =
      (draft.callerName
        ? fileSymbols.find(
            (symbol) => symbol.kind === "function" && symbol.name === draft.callerName,
          )
        : undefined) ?? nearestFunctionSymbol(fileSymbols, draft.line);
    if (!caller) {
      continue;
    }
    const candidates = functionSymbolsByName.get(draft.calleeName) ?? [];
    const callee = [...candidates]
      .filter((candidate) => candidate.id !== caller.id)
      .sort((left, right) => {
        const leftSamePath = left.path === draft.path ? 0 : 1;
        const rightSamePath = right.path === draft.path ? 0 : 1;
        if (leftSamePath !== rightSamePath) {
          return leftSamePath - rightSamePath;
        }
        return left.path.localeCompare(right.path) || left.line - right.line;
      })[0];
    if (!callee) {
      continue;
    }
    addCallEdge(caller, callee, callee.path === draft.path ? 0.9 : 0.78, draft.line);
  }

  for (const file of files) {
    if (shouldStop()) {
      break;
    }
    if (file.parser?.engine === "tree-sitter") {
      continue;
    }
    const fileSymbols = (symbolsByPath.get(file.path) ?? []).sort((left, right) => left.line - right.line);
    if (fileSymbols.length === 0) {
      continue;
    }
    const lines = file.content.split("\n");
    for (let index = 0; index < fileSymbols.length; index += 1) {
      const caller = fileSymbols[index]!;
      if (caller.kind !== "function") {
        continue;
      }
      const next = fileSymbols[index + 1];
      const body = lines.slice(caller.line - 1, next ? next.line - 1 : lines.length).join("\n");
      for (const callee of symbols) {
        if (shouldStop()) {
          break;
        }
        if (callee.id === caller.id || callee.kind !== "function" || callee.name.length < 3) {
          continue;
        }
        const regex = new RegExp(`\\b${escapeRegex(callee.name)}\\s*\\(`);
        if (!regex.test(body)) {
          continue;
        }
        const key = `${caller.id}\0${callee.id}\0calls`;
        if (existingKeys.has(key)) {
          continue;
        }
        existingKeys.add(key);
        edges.push({
          from: caller.id,
          to: callee.id,
          kind: "calls",
          provenance: "inferred",
          confidence: callee.path === file.path ? 0.85 : 0.75,
          label: callee.name,
          line: caller.line,
        });
      }
    }
  }
  return edges;
}

function nearestFunctionSymbol(
  fileSymbols: RepoIndexSymbol[],
  line: number,
): RepoIndexSymbol | undefined {
  let nearest: RepoIndexSymbol | undefined;
  for (const symbol of fileSymbols) {
    if (symbol.kind !== "function" || symbol.line > line) {
      continue;
    }
    if (!nearest || symbol.line > nearest.line) {
      nearest = symbol;
    }
  }
  return nearest;
}

function identifierTokens(content: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of content.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g)) {
    const token = match[0];
    if (token.length >= 3) {
      tokens.add(token);
    }
  }
  return tokens;
}

function resolveEdgeTarget(draft: EdgeDraft, knownFiles: Set<string>): string | undefined {
  const specifier = stripSpecifierSuffix(draft.specifier.replace(/\\/g, "/"));
  if (isExternalSpecifier(specifier, draft.kind)) {
    return `external:${specifier}`;
  }

  const base = path.posix.normalize(path.posix.join(path.posix.dirname(draft.from), specifier));

  if (base === ".." || base.startsWith("../") || path.posix.isAbsolute(base)) {
    return undefined;
  }

  const candidates = [
    base,
    ...LOCAL_RESOLUTION_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...LOCAL_RESOLUTION_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => knownFiles.has(candidate));
}

function isExternalSpecifier(
  specifier: string,
  kind: Extract<RepoIndexEdgeKind, "imports" | "links">,
): boolean {
  if (specifier.length === 0) {
    return true;
  }
  if (kind === "imports") {
    return !specifier.startsWith(".");
  }
  return /^[a-z]+:/i.test(specifier) || specifier.startsWith("#");
}

function resolveBestNode(index: RepoIndex, target: string): RepoIndexResolvedNode | undefined {
  const normalizedTarget = toRepoPath(target).toLowerCase();
  const symbol = index.symbols.find((candidate) => candidate.name.toLowerCase() === normalizedTarget);
  if (symbol) {
    return {
      id: symbol.id,
      kind: "symbol",
      path: symbol.path,
      name: symbol.name,
      line: symbol.line,
    };
  }

  const file =
    index.files.find((candidate) => candidate.path.toLowerCase() === normalizedTarget) ??
    index.files.find((candidate) => candidate.path.toLowerCase().endsWith(`/${normalizedTarget}`)) ??
    index.files.find((candidate) => candidate.path.toLowerCase().includes(normalizedTarget));
  if (file) {
    return {
      id: file.path,
      kind: "file",
      path: file.path,
    };
  }

  const fuzzySymbol = index.symbols.find((candidate) =>
    candidate.name.toLowerCase().includes(normalizedTarget),
  );
  if (fuzzySymbol) {
    return {
      id: fuzzySymbol.id,
      kind: "symbol",
      path: fuzzySymbol.path,
      name: fuzzySymbol.name,
      line: fuzzySymbol.line,
    };
  }

  return undefined;
}

function resolveCandidateNodeIds(index: RepoIndex, target: string): string[] {
  const normalizedTarget = toRepoPath(target).toLowerCase();
  const ids: string[] = [];

  for (const file of index.files) {
    const filePath = file.path.toLowerCase();
    if (
      filePath === normalizedTarget ||
      filePath.endsWith(`/${normalizedTarget}`) ||
      filePath.includes(normalizedTarget)
    ) {
      ids.push(file.path);
    }
  }

  for (const symbol of index.symbols) {
    const symbolName = symbol.name.toLowerCase();
    if (symbolName === normalizedTarget || symbolName.includes(normalizedTarget)) {
      ids.push(symbol.id);
    }
  }

  return [...new Set(ids)];
}

function createAdjacency(index: RepoIndex): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  function add(from: string, to: string): void {
    const current = adjacency.get(from) ?? [];
    current.push(to);
    adjacency.set(from, current);
  }

  for (const edge of index.edges) {
    add(edge.from, edge.to);
    if (
      edge.kind === "defines" ||
      edge.kind === "imports" ||
      edge.kind === "links" ||
      edge.kind === "references" ||
      edge.kind === "calls"
    ) {
      add(edge.to, edge.from);
    }
  }

  return adjacency;
}

function labelNode(index: RepoIndex, nodeId: string): string {
  if (index.files.some((file) => file.path === nodeId)) {
    return nodeId;
  }
  const symbol = index.symbols.find((candidate) => candidate.id === nodeId);
  return symbol ? `${symbol.path}#${symbol.name}` : nodeId;
}

function graphTextForFile(index: RepoIndex, filePath: string): string {
  return index.edges
    .filter((edge) => edge.from === filePath || edge.to === filePath)
    .map((edge) => `${edge.kind} ${edge.label ?? ""} ${edge.from} ${edge.to}`)
    .join(" ");
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_$]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreText(text: string, tokens: string[], queryLower?: string): number {
  const lower = text.toLowerCase();
  let score = queryLower && queryLower.length > 0 && lower.includes(queryLower) ? 20 : 0;
  for (const token of tokens) {
    if (lower.includes(token)) {
      score += 5;
    }
  }
  return score;
}

function compactLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length <= 160) {
    return trimmed;
  }
  return `${trimmed.slice(0, 157)}...`;
}

function matchesInclude(relativePath: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  return matchesAny(relativePath, patterns);
}

function matchesAny(relativePath: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => matchesPattern(relativePath, pattern));
}

function matchesPattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = toRepoPath(pattern).replace(/^\.\//, "");
  if (containsGlob(normalizedPattern)) {
    return globToRegex(normalizedPattern).test(relativePath);
  }
  if (normalizedPattern.includes("/")) {
    return relativePath === normalizedPattern || relativePath.startsWith(`${normalizedPattern}/`);
  }
  return relativePath
    .split("/")
    .some(
      (segment) =>
        segment === normalizedPattern ||
        segment.replace(path.posix.extname(segment), "") === normalizedPattern,
    );
}

function stripSpecifierSuffix(specifier: string): string {
  return specifier.split(/[?#]/, 1)[0] ?? "";
}

function createRepoIndexFingerprint(
  repoRoot: string,
  options: NormalizedRepoIndexBuildOptions,
): string {
  return createRepoIndexFingerprintFromEntries(createRepoIndexFingerprintEntries(repoRoot, options));
}

export function createRepoIndexFingerprintFromEntries(entries: readonly string[]): string {
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

function createRepoIndexFingerprintEntries(
  repoRoot: string,
  options: NormalizedRepoIndexBuildOptions,
): string[] {
  const candidateResult = listCandidateFiles(repoRoot, options);
  const candidateFiles = candidateResult.files;
  const selectedFiles = candidateFiles.slice(0, options.maxFiles);
  const entries = createRepoIndexFingerprintBaseEntries({
    repoRoot,
    buildOptions: options,
    candidateFiles,
    skippedByWalk: candidateResult.skipped,
  });
  let totalBytes = 0;

  for (const relativePath of selectedFiles) {
    const absolutePath = path.join(repoRoot, relativePath);
    const stat = statSync(absolutePath);
    if (stat.size > options.maxFileBytes || totalBytes + stat.size > options.maxTotalBytes) {
      entries.push(`skipped-by-size:${relativePath}:${stat.size}:${stat.mtimeMs}`);
      continue;
    }
    totalBytes += stat.size;
    const contentHash = createHash("sha256")
      .update(normalizeLineEndings(readFileSync(absolutePath, "utf8")))
      .digest("hex");
    entries.push(`indexed:${relativePath}:${stat.size}:${contentHash}`);
  }

  return entries;
}

function createRepoIndexFingerprintBaseEntries(input: {
  repoRoot: string;
  buildOptions: NormalizedRepoIndexBuildOptions;
  candidateFiles: string[];
  skippedByWalk: RepoWalkSkipped[];
}): string[] {
  const entries = [`extractor:${REPO_INDEX_EXTRACTOR_VERSION}`];
  entries.push(
    ...input.skippedByWalk.map((skipped) => `skipped-by-walk:${skipped.reason}:${skipped.path}`),
  );
  entries.push(
    ...input.candidateFiles.slice(input.buildOptions.maxFiles).map((relativePath) => {
      const stat = statSync(path.join(input.repoRoot, relativePath));
      return `skipped-by-count:${relativePath}:${stat.size}:${stat.mtimeMs}`;
    }),
  );
  return entries;
}

function createRepoIndexFingerprintEntriesFromFiles(input: {
  files: RepoIndexFile[];
  skippedFiles: string[];
}): string[] {
  return [
    `extractor:${REPO_INDEX_EXTRACTOR_VERSION}`,
    ...input.skippedFiles.map((relativePath) => `skipped:${relativePath}`),
    ...input.files.map((file) => `indexed:${file.path}:${file.byteLength}:${file.hash}`),
  ];
}

function pushAll<T>(target: T[], values: T[]): void {
  const chunkSize = 1_000;
  for (let index = 0; index < values.length; index += chunkSize) {
    target.push(...values.slice(index, index + chunkSize));
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizePatternList(patterns?: string[]): string[] | undefined {
  if (!patterns || patterns.length === 0) {
    return undefined;
  }
  return patterns.map((pattern) => toRepoPath(pattern).replace(/^\.\//, "")).sort();
}

function containsGlob(pattern: string): boolean {
  return /[*?[\]]/.test(pattern);
}

function globToRegex(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    const next = pattern[index + 1] ?? "";
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char);
    }
  }
  source += "$";
  return new RegExp(source);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRepoRelativePath(relativePath: string): string {
  return toRepoPath(relativePath).replace(/^\.\//, "");
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  return content.split("\n").length;
}

function toRepoPath(input: string): string {
  return input.replace(/\\/g, "/");
}

function createRepoIndexFileFromContent(input: {
  relativePath: string;
  content: string;
  mtimeMs: number;
}): RepoIndexFile {
  const language = languageForPath(input.relativePath);
  const extracted = extractRepoFileFacts({
    path: input.relativePath,
    language,
    content: input.content,
  });
  return {
    path: input.relativePath,
    language,
    parser: extracted.parser,
    lineCount: countLines(input.content),
    byteLength: Buffer.byteLength(input.content, "utf8"),
    mtimeMs: input.mtimeMs,
    hash: createHash("sha256").update(input.content).digest("hex"),
    symbols: extracted.symbols,
    content: input.content,
  };
}
