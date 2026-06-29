import path from "node:path";
import type { RepoIndex, RepoIndexSymbol } from "./repo-index.js";

export type CodeSmellFindingKind =
  | "potential_dead_code"
  | "complex_function"
  | "duplicate_block"
  | "needless_dependency";

export type CodeSmellFinding = {
  kind: CodeSmellFindingKind;
  severity: "info" | "warning" | "error";
  path: string;
  line?: number;
  subject: string;
  message: string;
};

export type CodeSmellScanResult = {
  repoRoot: string;
  scope: "changed_files_only";
  warning: string;
  changedFiles: string[];
  findings: CodeSmellFinding[];
};

export type CodeSmellScanInput = {
  repoRoot: string;
  index: RepoIndex;
  changedFiles?: string[];
  diffText?: string;
  maxComplexity?: number;
  duplicateMinLines?: number;
};

export function scanCodeSmells(input: CodeSmellScanInput): CodeSmellScanResult {
  const repoRoot = path.resolve(input.repoRoot);
  const changedFiles = uniqueSorted((input.changedFiles?.length ? input.changedFiles : filesFromDiff(input.diffText ?? ""))
    .map(toRepoPath));
  const changedSet = new Set(changedFiles);
  const findings: CodeSmellFinding[] = [
    ...deadCodeFindings(input.index, changedSet),
    ...complexityFindings(input.index, changedSet, input.maxComplexity ?? 12),
    ...duplicateBlockFindings(input.index, changedSet, input.duplicateMinLines ?? 8),
    ...needlessDependencyFindings(input.index, changedSet, input.diffText ?? ""),
  ];
  return {
    repoRoot,
    scope: "changed_files_only",
    warning:
      "code_smell_scan reviews only changed files and is not repo-wide reachability or deletion proof; use repo_reachability_analyze for repository-wide deletion review.",
    changedFiles,
    findings: findings.sort(compareFindings),
  };
}

function deadCodeFindings(index: RepoIndex, changedFiles: Set<string>): CodeSmellFinding[] {
  const inbound = new Set(
    index.edges
      .filter((edge) => edge.kind === "references" || edge.kind === "calls" || edge.kind === "imports")
      .filter((edge) => fileForNode(edge.from) !== fileForNode(edge.to))
      .map((edge) => edge.to),
  );
  return index.symbols
    .filter((symbol) => changedFiles.has(symbol.path))
    .filter((symbol) => !inbound.has(symbol.id))
    .map((symbol) => ({
      kind: "potential_dead_code" as const,
      severity: "warning" as const,
      path: symbol.path,
      line: symbol.line,
      subject: symbol.name,
      message: `${symbol.name} has no inbound reference or call edges from other files in the current repo graph.`,
    }));
}

function complexityFindings(
  index: RepoIndex,
  changedFiles: Set<string>,
  maxComplexity: number,
): CodeSmellFinding[] {
  const symbolsByPath = groupSymbolsByPath(index.symbols);
  const findings: CodeSmellFinding[] = [];
  for (const file of index.files.filter((candidate) => changedFiles.has(candidate.path))) {
    const symbols = symbolsByPath.get(file.path) ?? [];
    const functionSymbols = symbols.filter((symbol) => symbol.kind === "function").sort((a, b) => a.line - b.line);
    const lines = file.content.split("\n");
    for (let indexInFile = 0; indexInFile < functionSymbols.length; indexInFile += 1) {
      const symbol = functionSymbols[indexInFile]!;
      const next = functionSymbols[indexInFile + 1];
      const body = lines.slice(symbol.line - 1, next ? next.line - 1 : lines.length).join("\n");
      const complexity = approximateComplexity(body);
      if (complexity <= maxComplexity) {
        continue;
      }
      findings.push({
        kind: "complex_function",
        severity: "warning",
        path: file.path,
        line: symbol.line,
        subject: symbol.name,
        message: `${symbol.name} has approximate complexity ${complexity}, above threshold ${maxComplexity}.`,
      });
    }
  }
  return findings;
}

function duplicateBlockFindings(
  index: RepoIndex,
  changedFiles: Set<string>,
  duplicateMinLines: number,
): CodeSmellFinding[] {
  const seen = new Map<string, { path: string; line: number }>();
  const findings: CodeSmellFinding[] = [];
  for (const file of index.files.filter((candidate) => changedFiles.has(candidate.path))) {
    const normalized = file.content
      .split("\n")
      .map((line, index) => ({ line: normalizeDuplicateLine(line), number: index + 1 }))
      .filter((line) => line.line.length > 0 && line.line !== "{" && line.line !== "}");
    for (let indexInFile = 0; indexInFile <= normalized.length - duplicateMinLines; indexInFile += 1) {
      const window = normalized.slice(indexInFile, indexInFile + duplicateMinLines);
      const key = window.map((line) => line.line).join("\n");
      const first = seen.get(key);
      if (!first) {
        seen.set(key, { path: file.path, line: window[0]?.number ?? 1 });
        continue;
      }
      findings.push({
        kind: "duplicate_block",
        severity: "warning",
        path: file.path,
        line: window[0]?.number,
        subject: `${first.path}:${first.line}`,
        message: `${file.path}:${window[0]?.number ?? 1} duplicates a ${duplicateMinLines}-line block from ${first.path}:${first.line}.`,
      });
      break;
    }
  }
  return findings;
}

function needlessDependencyFindings(
  index: RepoIndex,
  changedFiles: Set<string>,
  diffText: string,
): CodeSmellFinding[] {
  if (!changedFiles.has("package.json")) {
    return [];
  }
  const addedDependencies = addedPackageDependencies(diffText);
  if (addedDependencies.length === 0) {
    return [];
  }
  const changedSourceText = index.files
    .filter((file) => changedFiles.has(file.path) && file.path !== "package.json")
    .map((file) => file.content)
    .join("\n")
    .toLowerCase();
  return addedDependencies
    .filter((dependency) => !changedSourceText.includes(dependency.toLowerCase()))
    .map((dependency) => ({
      kind: "needless_dependency" as const,
      severity: "warning" as const,
      path: "package.json",
      subject: dependency,
      message: `${dependency} was added to package.json but is not referenced by changed source files.`,
    }));
}

function addedPackageDependencies(diffText: string): string[] {
  const names: string[] = [];
  for (const line of diffText.split(/\r?\n/)) {
    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }
    const match = line.match(/^\+\s*"([^"]+)"\s*:/);
    if (match?.[1] && !["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].includes(match[1])) {
      names.push(match[1]);
    }
  }
  return uniqueSorted(names);
}

function filesFromDiff(diffText: string): string[] {
  return [...diffText.matchAll(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/gm)].map((match) => toRepoPath(match[2] ?? ""));
}

function approximateComplexity(body: string): number {
  const matches = body.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?/g);
  return 1 + (matches?.length ?? 0);
}

function groupSymbolsByPath(symbols: RepoIndexSymbol[]): Map<string, RepoIndexSymbol[]> {
  const byPath = new Map<string, RepoIndexSymbol[]>();
  for (const symbol of symbols) {
    byPath.set(symbol.path, [...(byPath.get(symbol.path) ?? []), symbol]);
  }
  return byPath;
}

function normalizeDuplicateLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function fileForNode(nodeId: string): string {
  return nodeId.split("#", 1)[0] ?? nodeId;
}

function compareFindings(left: CodeSmellFinding, right: CodeSmellFinding): number {
  const severityRank = { error: 0, warning: 1, info: 2 };
  return (
    severityRank[left.severity] - severityRank[right.severity] ||
    left.path.localeCompare(right.path) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.kind.localeCompare(right.kind) ||
    left.subject.localeCompare(right.subject)
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
