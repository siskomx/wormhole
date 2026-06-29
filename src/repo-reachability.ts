import path from "node:path";
import { createRepoIndexHealth, type RepoIndex, type RepoIndexEdge } from "./repo-index.js";
import type { IndexHealthSnapshot } from "./index-health.js";

export type RepoReachabilityCategory =
  | "likely_used"
  | "manual_review"
  | "unknown"
  | "candidate_remove_pending_review";

export type RepoReachabilityEvidenceSource =
  | "static"
  | "dynamic"
  | "convention"
  | "entrypoint"
  | "script"
  | "workspace"
  | "knip"
  | "manual";

export type RepoReachabilityEvidence = {
  source: RepoReachabilityEvidenceSource;
  path: string;
  line?: number;
  symbol?: string;
  detail: string;
  confidence: number;
};

export type RepoReachabilityBlocker = {
  kind: "dynamic_import" | "framework_convention" | "boundary_blocker" | "manual_evidence" | "unknown_runtime";
  detail: string;
};

export type RepoReachabilityFinding = {
  path: string;
  category: RepoReachabilityCategory;
  confidence: number;
  reasons: string[];
  evidence: RepoReachabilityEvidence[];
  blockers: RepoReachabilityBlocker[];
  advisoryCommands: string[];
};

export type RepoReachabilityAnalyzeInput = {
  repoRoot: string;
  index: RepoIndex;
  entrypoints?: string[];
  paths?: string[];
  packageRoots?: string[];
  knownUsedFiles?: string[];
  knipUnusedFiles?: string[];
  limit?: number;
  cursor?: number;
};

export type RepoReachabilityAnalyzeResult = {
  repoRoot: string;
  generatedAt: string;
  requiresHumanApproval: true;
  disclaimer: string;
  scope: {
    paths: string[];
    packageRoots: string[];
    entrypoints: string[];
    limit: number;
    cursor: number;
  };
  summary: {
    analyzedFiles: number;
    returnedFindings: number;
    categories: Record<RepoReachabilityCategory, number>;
  };
  findings: RepoReachabilityFinding[];
  nextCursor?: number;
  indexHealth: IndexHealthSnapshot;
};

const DEFAULT_LIMIT = 100;
const DISCLAIMER =
  "Heuristic reachability review for coding agents. This is evidence collection, not proof of deletion safety; every removal requires human approval.";

export function analyzeRepoReachability(input: RepoReachabilityAnalyzeInput): RepoReachabilityAnalyzeResult {
  const repoRoot = path.resolve(input.repoRoot);
  const limit = clampLimit(input.limit ?? DEFAULT_LIMIT);
  const cursor = Math.max(0, input.cursor ?? 0);
  const packageRoots = uniqueSorted((input.packageRoots ?? []).map(toRepoPath));
  const entrypoints = uniqueSorted((input.entrypoints ?? []).map(toRepoPath));
  const pathPrefixes = uniqueSorted((input.paths ?? []).map(toRepoPath));
  const knownUsedFiles = new Set((input.knownUsedFiles ?? []).map(toRepoPath));
  const knipUnusedFiles = new Set((input.knipUnusedFiles ?? []).map(toRepoPath));
  const staticInbound = createStaticInboundMap(input.index);
  const reachableFiles = createReachableFileSet(input.index, entrypoints);
  const dynamicPrefixes = dynamicImportPrefixes(input.index);
  const analysisComplete = !input.index.truncated && entrypoints.length > 0;

  const allFindings = input.index.files
    .filter((file) => isAnalyzableSource(file.path))
    .filter((file) => pathPrefixes.length === 0 || pathPrefixes.some((prefix) => isPathOrDescendant(file.path, prefix)))
    .map((file) =>
      classifyFile({
        filePath: file.path,
        content: file.content,
        staticInbound,
        reachableFiles,
        dynamicPrefixes,
        knownUsedFiles,
        knipUnusedFiles,
        packageRoots,
        analysisComplete,
      }),
    )
    .sort(compareFindings);

  const findings = allFindings.slice(cursor, cursor + limit);
  const nextCursor = cursor + limit < allFindings.length ? cursor + limit : undefined;
  return {
    repoRoot,
    generatedAt: new Date().toISOString(),
    requiresHumanApproval: true,
    disclaimer: DISCLAIMER,
    scope: {
      paths: pathPrefixes,
      packageRoots,
      entrypoints,
      limit,
      cursor,
    },
    summary: {
      analyzedFiles: allFindings.length,
      returnedFindings: findings.length,
      categories: countCategories(allFindings),
    },
    findings,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    indexHealth: createRepoIndexHealth(input.index),
  };
}

function classifyFile(input: {
  filePath: string;
  content: string;
  staticInbound: Map<string, RepoIndexEdge[]>;
  reachableFiles: Set<string>;
  dynamicPrefixes: string[];
  knownUsedFiles: Set<string>;
  knipUnusedFiles: Set<string>;
  packageRoots: string[];
  analysisComplete: boolean;
}): RepoReachabilityFinding {
  const evidence: RepoReachabilityEvidence[] = [];
  const blockers: RepoReachabilityBlocker[] = [];
  const reasons: string[] = [];
  const inbound = input.staticInbound.get(input.filePath) ?? [];
  const packageRoot = packageRootFor(input.filePath, input.packageRoots);

  if (input.knipUnusedFiles.has(input.filePath)) {
    evidence.push({
      source: "knip",
      path: input.filePath,
      detail: "External Knip-style input reported this file as unused; Wormhole treats that as heuristic evidence only.",
      confidence: 0.45,
    });
  }

  if (input.knownUsedFiles.has(input.filePath)) {
    evidence.push({
      source: "manual",
      path: input.filePath,
      detail: "Caller supplied this file as known-used manual evidence.",
      confidence: 0.95,
    });
    blockers.push({ kind: "manual_evidence", detail: "Manual known-used evidence blocks removal classification." });
    reasons.push("Manual known-used evidence was supplied.");
    return finding(input.filePath, "likely_used", 0.95, reasons, evidence, blockers);
  }

  if (isFrameworkEntrypoint(input.filePath, input.content)) {
    evidence.push({
      source: "convention",
      path: input.filePath,
      detail: "Framework or route filename convention marks this file as an entrypoint.",
      confidence: 0.9,
    });
    blockers.push({ kind: "framework_convention", detail: "Framework convention blocks removal classification." });
    reasons.push("Matched a closed-list framework or route entrypoint convention.");
    return finding(input.filePath, "likely_used", 0.9, reasons, evidence, blockers);
  }

  if (isRuntimeWiredByConvention(input.filePath, input.content)) {
    evidence.push({
      source: "convention",
      path: input.filePath,
      detail: "Runtime-style wiring such as RSS, cron, worker, socket, or queue handling needs manual validation.",
      confidence: 0.7,
    });
    blockers.push({ kind: "unknown_runtime", detail: "Runtime or config wiring requires manual validation." });
    reasons.push("Runtime-style wiring is intentionally conservative.");
    return finding(input.filePath, "manual_review", 0.55, reasons, evidence, blockers);
  }

  if (input.reachableFiles.has(input.filePath)) {
    evidence.push({
      source: "entrypoint",
      path: input.filePath,
      detail: "File is reachable from an explicit or discovered entrypoint through static graph edges.",
      confidence: 0.9,
    });
    reasons.push("Static graph reaches this file from an entrypoint.");
    appendInboundEvidence(evidence, blockers, input.filePath, inbound, input.packageRoots, packageRoot);
    return finding(input.filePath, "likely_used", 0.88, reasons, evidence, blockers);
  }

  if (inbound.length > 0) {
    appendInboundEvidence(evidence, blockers, input.filePath, inbound, input.packageRoots, packageRoot);
    reasons.push("Static inbound references exist.");
    return finding(input.filePath, "likely_used", 0.82, reasons, evidence, blockers);
  }

  const dynamicMatch = input.dynamicPrefixes.find((prefix) => isPathOrDescendant(input.filePath, prefix));
  if (dynamicMatch) {
    evidence.push({
      source: "dynamic",
      path: input.filePath,
      detail: `A dynamic import pattern covers prefix ${dynamicMatch}.`,
      confidence: 0.6,
    });
    blockers.push({ kind: "dynamic_import", detail: `Dynamic import prefix ${dynamicMatch} requires manual validation.` });
    reasons.push("Potentially covered by a dynamic import expression.");
    return finding(input.filePath, "manual_review", 0.5, reasons, evidence, blockers);
  }

  if (!input.analysisComplete) {
    reasons.push("Reachability coverage is incomplete because the repo index is truncated or no entrypoints were available.");
    blockers.push({
      kind: "unknown_runtime",
      detail: "Incomplete reachability coverage blocks candidate removal classification.",
    });
    return finding(input.filePath, "unknown", 0.35, reasons, evidence, blockers);
  }

  reasons.push("No static inbound edges, entrypoint reachability, manual evidence, or known convention matched.");
  return finding(input.filePath, "candidate_remove_pending_review", 0.78, reasons, evidence, blockers);
}

function finding(
  filePath: string,
  category: RepoReachabilityCategory,
  confidence: number,
  reasons: string[],
  evidence: RepoReachabilityEvidence[],
  blockers: RepoReachabilityBlocker[],
): RepoReachabilityFinding {
  return {
    path: filePath,
    category,
    confidence,
    reasons,
    evidence,
    blockers,
    advisoryCommands: advisoryCommandsFor(filePath),
  };
}

function createStaticInboundMap(index: RepoIndex): Map<string, RepoIndexEdge[]> {
  const inbound = new Map<string, RepoIndexEdge[]>();
  for (const edge of index.edges) {
    if (!["imports", "references", "calls"].includes(edge.kind)) {
      continue;
    }
    const toPath = fileForNode(edge.to);
    const fromPath = fileForNode(edge.from);
    if (!toPath || !fromPath || toPath === fromPath) {
      continue;
    }
    inbound.set(toPath, [...(inbound.get(toPath) ?? []), edge]);
  }
  return inbound;
}

function createReachableFileSet(index: RepoIndex, entrypoints: string[]): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of index.edges) {
    if (!["imports", "references", "calls"].includes(edge.kind)) {
      continue;
    }
    const fromPath = fileForNode(edge.from);
    const toPath = fileForNode(edge.to);
    if (!fromPath || !toPath || fromPath === toPath) {
      continue;
    }
    adjacency.set(fromPath, new Set([...(adjacency.get(fromPath) ?? []), toPath]));
  }
  const seen = new Set<string>();
  const queue = [...entrypoints];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        queue.push(next);
      }
    }
  }
  return seen;
}

function appendInboundEvidence(
  evidence: RepoReachabilityEvidence[],
  blockers: RepoReachabilityBlocker[],
  filePath: string,
  inbound: RepoIndexEdge[],
  packageRoots: string[],
  packageRoot: string | undefined,
): void {
  for (const edge of inbound.slice(0, 8)) {
    const fromPath = fileForNode(edge.from);
    evidence.push({
      source: "static",
      path: fromPath,
      line: edge.line,
      detail: `${fromPath} has a ${edge.kind} edge to ${filePath}.`,
      confidence: edge.confidence,
      ...(edge.label ? { symbol: edge.label } : {}),
    });
    const fromPackageRoot = packageRootFor(fromPath, packageRoots);
    if (packageRoot && fromPackageRoot && packageRoot !== fromPackageRoot) {
      blockers.push({
        kind: "boundary_blocker",
        detail: `Reference crosses package boundary from ${fromPackageRoot} to ${packageRoot}.`,
      });
    }
  }
}

function dynamicImportPrefixes(index: RepoIndex): string[] {
  const prefixes: string[] = [];
  for (const file of index.files) {
    const dirname = path.posix.dirname(file.path);
    for (const match of file.content.matchAll(/\bimport\(\s*`([^`$]*)\$\{/g)) {
      const prefix = normalizeDynamicPrefix(dirname, match[1] ?? "");
      if (prefix) {
        prefixes.push(prefix);
      }
    }
    for (const match of file.content.matchAll(/\bimport\(\s*["']([^"']*\/)["']\s*\+/g)) {
      const prefix = normalizeDynamicPrefix(dirname, match[1] ?? "");
      if (prefix) {
        prefixes.push(prefix);
      }
    }
  }
  return uniqueSorted(prefixes);
}

function normalizeDynamicPrefix(dirname: string, rawPrefix: string): string | undefined {
  if (!rawPrefix.startsWith(".")) {
    return undefined;
  }
  return toRepoPath(path.posix.normalize(path.posix.join(dirname, rawPrefix))).replace(/\/+$/, "");
}

function isFrameworkEntrypoint(filePath: string, content: string): boolean {
  const normalized = filePath.toLowerCase();
  return (
    /(^|\/)(app|src\/app)\/.+\/(page|layout|route)\.(ts|tsx|js|jsx)$/.test(normalized) ||
    /(^|\/)(pages|src\/pages)\/.+\.(ts|tsx|js|jsx)$/.test(normalized) ||
    /(^|\/)(api|routes|controllers)\//.test(normalized) ||
    /\b(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/.test(content)
  );
}

function isRuntimeWiredByConvention(filePath: string, content: string): boolean {
  const haystack = `${filePath}\n${content}`;
  return /\b(RssFetcher|rss|cron|worker|queue|WebSocket|WebSocketServer|handleUpgrade|upgrade|socket)\b/i.test(haystack);
}

function isAnalyzableSource(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(filePath) && !/(^|\/)(node_modules|dist|build|coverage)\//.test(filePath);
}

function packageRootFor(filePath: string, packageRoots: string[]): string | undefined {
  return packageRoots
    .filter((root) => filePath === root || filePath.startsWith(`${root}/`))
    .sort((left, right) => right.length - left.length)[0];
}

function isPathOrDescendant(filePath: string, candidateRoot: string): boolean {
  return filePath === candidateRoot || filePath.startsWith(`${candidateRoot}/`);
}

function advisoryCommandsFor(filePath: string): string[] {
  const basename = path.posix.basename(filePath).replace(/\.[^.]+$/, "");
  return [
    `rg -n "${escapeDoubleQuotes(filePath)}|${escapeDoubleQuotes(basename)}" .`,
    "Run the package test/build commands before any approved deletion.",
  ];
}

function countCategories(findings: RepoReachabilityFinding[]): Record<RepoReachabilityCategory, number> {
  return {
    likely_used: findings.filter((finding) => finding.category === "likely_used").length,
    manual_review: findings.filter((finding) => finding.category === "manual_review").length,
    unknown: findings.filter((finding) => finding.category === "unknown").length,
    candidate_remove_pending_review: findings.filter((finding) => finding.category === "candidate_remove_pending_review").length,
  };
}

function compareFindings(left: RepoReachabilityFinding, right: RepoReachabilityFinding): number {
  const categoryRank: Record<RepoReachabilityCategory, number> = {
    candidate_remove_pending_review: 0,
    manual_review: 1,
    unknown: 2,
    likely_used: 3,
  };
  return categoryRank[left.category] - categoryRank[right.category] || left.path.localeCompare(right.path);
}

function fileForNode(nodeId: string): string {
  return nodeId.split("#", 1)[0] ?? nodeId;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(500, Math.floor(limit)));
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function escapeDoubleQuotes(value: string): string {
  return value.replace(/"/g, '\\"');
}
