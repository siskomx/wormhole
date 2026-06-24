import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type RepoIndexSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "constant"
  | "section";

export type RepoIndexEdgeKind = "defines" | "imports" | "links" | "references";

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
  line?: number;
  label?: string;
};

export type RepoIndexFile = {
  path: string;
  language: string;
  lineCount: number;
  byteLength: number;
  mtimeMs: number;
  hash: string;
  symbols: RepoIndexSymbol[];
  content: string;
};

export type NormalizedRepoIndexBuildOptions = {
  include?: string[];
  exclude?: string[];
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

export type RepoIndex = {
  repoRoot: string;
  builtAt: string;
  buildOptions: NormalizedRepoIndexBuildOptions;
  fingerprint: string;
  files: RepoIndexFile[];
  symbols: RepoIndexSymbol[];
  edges: RepoIndexEdge[];
  truncated: boolean;
  skippedFiles: string[];
};

export type RepoIndexBuildOptions = {
  repoRoot: string;
  include?: string[];
  exclude?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
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
};

type EdgeDraft = {
  from: string;
  specifier: string;
  kind: Extract<RepoIndexEdgeKind, "imports" | "links">;
  line: number;
};

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".wormhole",
  "build",
  "coverage",
  "dist",
  "graphify-out",
  "node_modules",
  "out",
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".cjs": "javascript",
  ".css": "css",
  ".html": "html",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  ".md": "markdown",
  ".mdx": "markdown",
  ".mjs": "javascript",
  ".ps1": "powershell",
  ".sh": "shell",
  ".sql": "sql",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".txt": "text",
  ".yaml": "yaml",
  ".yml": "yaml",
};

const LOCAL_RESOLUTION_EXTENSIONS = Object.keys(LANGUAGE_BY_EXTENSION);

export function buildRepoIndex(options: RepoIndexBuildOptions): RepoIndex {
  const repoRoot = path.resolve(options.repoRoot);
  const buildOptions = normalizeRepoIndexBuildOptions(options);
  const candidateFiles = listCandidateFiles(repoRoot, buildOptions);
  const selectedFiles = candidateFiles.slice(0, buildOptions.maxFiles);
  const skippedFiles = candidateFiles.slice(buildOptions.maxFiles);
  const files: RepoIndexFile[] = [];
  const symbols: RepoIndexSymbol[] = [];
  const edges: RepoIndexEdge[] = [];
  const edgeDrafts: EdgeDraft[] = [];
  let totalBytes = 0;

  for (const relativePath of selectedFiles) {
    const absolutePath = path.join(repoRoot, relativePath);
    const stat = statSync(absolutePath);
    if (
      stat.size > buildOptions.maxFileBytes ||
      totalBytes + stat.size > buildOptions.maxTotalBytes
    ) {
      skippedFiles.push(relativePath);
      continue;
    }
    totalBytes += stat.size;

    const content = normalizeLineEndings(readFileSync(absolutePath, "utf8"));
    const language = languageForPath(relativePath);
    const fileSymbols = extractSymbols(relativePath, language, content);
    const file: RepoIndexFile = {
      path: relativePath,
      language,
      lineCount: countLines(content),
      byteLength: Buffer.byteLength(content, "utf8"),
      mtimeMs: stat.mtimeMs,
      hash: createHash("sha256").update(content).digest("hex"),
      symbols: fileSymbols,
      content,
    };
    files.push(file);
    symbols.push(...fileSymbols);
    edges.push(
      ...fileSymbols.map((symbol) => ({
        from: relativePath,
        to: symbol.id,
        kind: "defines" as const,
        line: symbol.line,
        label: symbol.name,
      })),
    );
    edgeDrafts.push(...extractEdgeDrafts(relativePath, language, content));
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
      line: draft.line,
      label: draft.specifier,
    });
  }
  edges.push(...extractReferenceEdges(files, symbols, edges));

  return {
    repoRoot,
    builtAt: new Date().toISOString(),
    buildOptions,
    fingerprint: createRepoIndexFingerprint(repoRoot, buildOptions),
    files,
    symbols,
    edges,
    truncated: candidateFiles.length > selectedFiles.length || skippedFiles.length > 0,
    skippedFiles,
  };
}

export function normalizeRepoIndexBuildOptions(
  options: RepoIndexBuildOptions | NormalizedRepoIndexBuildOptions,
): NormalizedRepoIndexBuildOptions {
  return {
    include: normalizePatternList(options.include),
    exclude: normalizePatternList(options.exclude),
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  };
}

export function createRepoIndexCacheKey(options: RepoIndexBuildOptions): string {
  return JSON.stringify({
    repoRoot: path.resolve(options.repoRoot),
    ...normalizeRepoIndexBuildOptions(options),
  });
}

export function isRepoIndexFresh(index: RepoIndex): boolean {
  try {
    return index.fingerprint === createRepoIndexFingerprint(index.repoRoot, index.buildOptions);
  } catch {
    return false;
  }
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
  };
}

export function queryRepoIndex(
  index: RepoIndex,
  input: RepoIndexQueryInput,
): RepoIndexQueryResult {
  const limit = input.limit ?? 10;
  const tokens = tokenize(input.query);
  if (tokens.length === 0 || limit <= 0) {
    return { query: input.query, results: [] };
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
    return { from: input.from, to: input.to, found: false, path: [] };
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

  return { from: input.from, to: input.to, found: false, path: [] };
}

function listCandidateFiles(
  repoRoot: string,
  options: Pick<RepoIndexBuildOptions, "include" | "exclude">,
): string[] {
  const files: string[] = [];

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toRepoPath(path.relative(repoRoot, absolutePath));

      if (entry.isDirectory()) {
        if (DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name) || matchesAny(relativePath, options.exclude)) {
          continue;
        }
        visit(absolutePath);
        continue;
      }

      if (
        entry.isFile() &&
        isSupportedTextPath(relativePath) &&
        matchesInclude(relativePath, options.include) &&
        !matchesAny(relativePath, options.exclude)
      ) {
        files.push(relativePath);
      }
    }
  }

  visit(repoRoot);
  return files;
}

function extractSymbols(
  relativePath: string,
  language: string,
  content: string,
): RepoIndexSymbol[] {
  const lineStarts = createLineStarts(content);
  const symbols: RepoIndexSymbol[] = [];
  const seen = new Set<string>();

  function add(kind: RepoIndexSymbolKind, name: string, offset: number): void {
    const cleanedName =
      kind === "section" ? cleanMarkdownSymbolName(name) : cleanCodeSymbolName(name);
    if (!cleanedName) {
      return;
    }
    const line = lineForOffset(lineStarts, offset);
    const key = `${cleanedName}:${line}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    symbols.push({
      id: `${relativePath}#${cleanedName}:${line}`,
      name: cleanedName,
      kind,
      path: relativePath,
      line,
    });
  }

  if (language === "markdown") {
    for (const match of content.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
      add("section", match[2] ?? "", match.index ?? 0);
    }
    return symbols;
  }

  if (language === "typescript" || language === "javascript") {
    addRegexMatches(content, /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g, "function", add);
    addRegexMatches(content, /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g, "class", add);
    addRegexMatches(content, /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/g, "interface", add);
    addRegexMatches(content, /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g, "type", add);
    addRegexMatches(
      content,
      /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
      "function",
      add,
    );
    addRegexMatches(content, /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g, "constant", add);
  }

  return symbols;
}

function addRegexMatches(
  content: string,
  regex: RegExp,
  kind: RepoIndexSymbolKind,
  add: (kind: RepoIndexSymbolKind, name: string, offset: number) => void,
): void {
  for (const match of content.matchAll(regex)) {
    add(kind, match[1] ?? "", match.index ?? 0);
  }
}

function extractEdgeDrafts(
  relativePath: string,
  language: string,
  content: string,
): EdgeDraft[] {
  const lineStarts = createLineStarts(content);
  const drafts: EdgeDraft[] = [];

  function add(
    kind: Extract<RepoIndexEdgeKind, "imports" | "links">,
    specifier: string,
    offset: number,
  ): void {
    if (!specifier) {
      return;
    }
    drafts.push({
      from: relativePath,
      specifier,
      kind,
      line: lineForOffset(lineStarts, offset),
    });
  }

  if (language === "typescript" || language === "javascript") {
    for (const regex of [
      /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
      /\bexport\s+[^'"]+\s+from\s+["']([^"']+)["']/g,
      /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    ]) {
      for (const match of content.matchAll(regex)) {
        add("imports", match[1] ?? "", match.index ?? 0);
      }
    }
  }

  if (language === "markdown") {
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)#?]+)(?:[)#?][^)]*)?\)/g)) {
      add("links", match[1] ?? "", match.index ?? 0);
    }
  }

  return drafts;
}

function extractReferenceEdges(
  files: RepoIndexFile[],
  symbols: RepoIndexSymbol[],
  existingEdges: RepoIndexEdge[],
): RepoIndexEdge[] {
  const existingKeys = new Set(
    existingEdges.map((edge) => `${edge.from}\0${edge.to}\0${edge.kind}`),
  );
  const edges: RepoIndexEdge[] = [];

  for (const file of files) {
    for (const symbol of symbols) {
      if (symbol.path === file.path || symbol.name.length < 3) {
        continue;
      }
      const regex = new RegExp(`\\b${escapeRegex(symbol.name)}\\b`);
      if (!regex.test(file.content)) {
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
        label: symbol.name,
      });
    }
  }

  return edges;
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
      edge.kind === "references"
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

function isSupportedTextPath(relativePath: string): boolean {
  return languageForPath(relativePath) !== "unknown";
}

function languageForPath(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? "unknown";
}

function cleanCodeSymbolName(name: string): string {
  return name.trim();
}

function cleanMarkdownSymbolName(name: string): string {
  return name.replace(/[`*_]/g, "").trim();
}

function stripSpecifierSuffix(specifier: string): string {
  return specifier.split(/[?#]/, 1)[0] ?? "";
}

function createRepoIndexFingerprint(
  repoRoot: string,
  options: NormalizedRepoIndexBuildOptions,
): string {
  const candidateFiles = listCandidateFiles(repoRoot, options);
  const selectedFiles = candidateFiles.slice(0, options.maxFiles);
  const entries = candidateFiles.slice(options.maxFiles).map((relativePath) => {
    const stat = statSync(path.join(repoRoot, relativePath));
    return `skipped-by-count:${relativePath}:${stat.size}:${stat.mtimeMs}`;
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

  return createHash("sha256").update(entries.join("\n")).digest("hex");
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

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  return content.split("\n").length;
}

function createLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineForOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid] ?? 0;
    if (lineStart <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return high + 1;
}

function toRepoPath(input: string): string {
  return input.replace(/\\/g, "/");
}
