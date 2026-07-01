import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  REPO_INDEX_EXTRACTOR_VERSION,
  isRepoIndexFresh,
  type NormalizedRepoIndexBuildOptions,
  type RepoIndex,
  type RepoIndexEdge,
  type RepoIndexEdgeKind,
  type RepoIndexEdgeProvenance,
  type RepoIndexSymbol,
} from "./repo-index.js";

export type RepoFactNodeKind =
  | "repo"
  | "file"
  | "symbol"
  | "test"
  | "external";

export type RepoFactEdgeKind =
  | "contains"
  | "defines"
  | "imports"
  | "links"
  | "references"
  | "calls"
  | "tests"
  | "tested_by";

export type RepoFactProvenance = RepoIndexEdgeProvenance | "derived" | "declared";

export type RepoFactMetadata = {
  analyzer: string;
  source: string;
  commit?: string;
  builtAt: string;
  fingerprint: string;
  confidence: number;
  freshness: "fresh" | "stale" | "unknown";
};

export type RepoFactNode = {
  id: string;
  kind: RepoFactNodeKind;
  label: string;
  path?: string;
  line?: number;
  metadata: RepoFactMetadata;
};

export type RepoFactEdge = {
  id: string;
  from: string;
  to: string;
  kind: RepoFactEdgeKind;
  label?: string;
  line?: number;
  provenance: RepoFactProvenance;
  confidence: number;
  metadata: RepoFactMetadata;
};

export type RepoFactGraph = {
  version: 1;
  repoRoot: string;
  builtAt: string;
  fingerprint: string;
  extractorVersion: string;
  buildOptions?: NormalizedRepoIndexBuildOptions;
  nodes: RepoFactNode[];
  edges: RepoFactEdge[];
  warnings: string[];
};

export const REPO_FACT_NODE_KINDS = [
  "repo",
  "file",
  "symbol",
  "test",
  "external",
] as const satisfies readonly RepoFactNodeKind[];

export const REPO_FACT_EDGE_KINDS = [
  "contains",
  "defines",
  "imports",
  "links",
  "references",
  "calls",
  "tests",
  "tested_by",
] as const satisfies readonly RepoFactEdgeKind[];

export const repoFactEdgeKindSchema = z.enum(REPO_FACT_EDGE_KINDS);

const REPO_FACT_PROVENANCES = [
  "extracted",
  "inferred",
  "ambiguous",
  "derived",
  "declared",
] as const satisfies readonly RepoFactProvenance[];

const REPO_INDEX_EDGE_KIND_TO_FACT_KIND: Record<RepoIndexEdgeKind, RepoFactEdgeKind> = {
  defines: "defines",
  imports: "imports",
  links: "links",
  references: "references",
  calls: "calls",
};

export function stableFactHash(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update("\0");
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function createRepoFactGraphFromIndex(input: { index: RepoIndex }): RepoFactGraph {
  const { index } = input;
  const builtAt = new Date().toISOString();
  const repoNodeId = `repo:${stableFactHash([index.repoRoot])}`;
  const symbolById = new Map(index.symbols.map((symbol) => [symbol.id, symbol]));
  const filePaths = new Set(index.files.map((file) => normalizeRepoPath(file.path)));
  const nodes = new Map<string, RepoFactNode>();
  const edges = new Map<string, RepoFactEdge>();
  const warnings: string[] = [];
  const freshness = isRepoIndexFresh(index) ? "fresh" : "stale";

  if (index.truncated) {
    warnings.push("Repo index was truncated; canonical facts may be partial.");
  }
  if (index.skippedFiles.length > 0) {
    warnings.push(`Repo index skipped ${index.skippedFiles.length} file(s).`);
  }

  function metadata(source: string, confidence: number): RepoFactMetadata {
    return {
      analyzer: `repo-index:${REPO_INDEX_EXTRACTOR_VERSION}`,
      source,
      builtAt,
      fingerprint: index.fingerprint,
      confidence,
      freshness,
    };
  }

  function addNode(node: RepoFactNode): void {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
    }
  }

  function addEdge(edge: Omit<RepoFactEdge, "id" | "metadata">): void {
    const id = createEdgeId(edge.kind, edge.from, edge.to, edge.label, edge.line);
    if (edges.has(id)) {
      return;
    }
    edges.set(id, {
      ...edge,
      id,
      metadata: metadata(edge.label ?? `${edge.from}->${edge.to}`, edge.confidence),
    });
  }

  addNode({
    id: repoNodeId,
    kind: "repo",
    label: path.basename(index.repoRoot) || index.repoRoot,
    path: index.repoRoot,
    metadata: metadata(index.repoRoot, 1),
  });

  for (const file of index.files) {
    const repoPath = normalizeRepoPath(file.path);
    const fileNodeId = `file:${repoPath}`;
    addNode({
      id: fileNodeId,
      kind: isTestPath(repoPath) ? "test" : "file",
      label: repoPath,
      path: repoPath,
      metadata: metadata(repoPath, 1),
    });
    addEdge({
      from: repoNodeId,
      to: fileNodeId,
      kind: "contains",
      label: repoPath,
      provenance: "derived",
      confidence: 1,
    });
  }

  for (const symbol of index.symbols) {
    addNode({
      id: `symbol:${symbol.id}`,
      kind: "symbol",
      label: symbol.name,
      path: normalizeRepoPath(symbol.path),
      line: symbol.line,
      metadata: metadata(symbol.path, 1),
    });
  }

  for (const edge of index.edges) {
    addExternalEndpointNode(edge.to);
    addExternalEndpointNode(edge.from);
    addIndexEdge(edge);
  }

  addTestCoverageEdges();

  return {
    version: 1,
    repoRoot: index.repoRoot,
    builtAt,
    fingerprint: index.fingerprint,
    extractorVersion: index.extractorVersion ?? REPO_INDEX_EXTRACTOR_VERSION,
    buildOptions: index.buildOptions,
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id)),
    warnings,
  };

  function addIndexEdge(edge: RepoIndexEdge): void {
    addEdge({
      from: normalizeEndpoint(edge.from),
      to: normalizeEndpoint(edge.to),
      kind: REPO_INDEX_EDGE_KIND_TO_FACT_KIND[edge.kind],
      ...(edge.label === undefined ? {} : { label: edge.label }),
      ...(edge.line === undefined ? {} : { line: edge.line }),
      provenance: edge.provenance,
      confidence: edge.confidence,
    });
  }

  function addExternalEndpointNode(endpoint: string): void {
    if (!endpoint.startsWith("external:")) {
      return;
    }
    const specifier = endpoint.slice("external:".length);
    addNode({
      id: endpoint,
      kind: "external",
      label: specifier,
      metadata: metadata(specifier, 1),
    });
  }

  function normalizeEndpoint(endpoint: string): string {
    if (isRepoRootEndpoint(endpoint)) {
      return repoNodeId;
    }
    if (endpoint.startsWith("external:")) {
      return endpoint;
    }
    if (endpoint.startsWith("repo:")) {
      return endpoint;
    }
    if (endpoint.startsWith("file:")) {
      return `file:${normalizeRepoPath(endpoint.slice("file:".length))}`;
    }
    if (endpoint.startsWith("symbol:")) {
      return endpoint;
    }
    if (symbolById.has(endpoint) || endpoint.includes("#")) {
      return `symbol:${endpoint}`;
    }
    return `file:${normalizeRepoPath(endpoint)}`;
  }

  function isRepoRootEndpoint(endpoint: string): boolean {
    return endpoint === index.repoRoot || (path.isAbsolute(endpoint) && path.resolve(endpoint) === path.resolve(index.repoRoot));
  }

  function addTestCoverageEdges(): void {
    for (const edge of index.edges) {
      const fromPath = repoPathForEndpoint(edge.from);
      if (!fromPath || !isTestPath(fromPath) || edge.kind === "defines") {
        continue;
      }

      const targetPath = repoPathForEndpoint(edge.to);
      if (!targetPath || isTestPath(targetPath)) {
        continue;
      }

      const testEndpoint = `file:${normalizeRepoPath(fromPath)}`;
      const targetEndpoint = normalizeEndpoint(edge.to);
      if (!nodes.has(testEndpoint) || !nodes.has(targetEndpoint)) {
        continue;
      }

      addEdge({
        from: testEndpoint,
        to: targetEndpoint,
        kind: "tests",
        ...(edge.label === undefined ? {} : { label: edge.label }),
        ...(edge.line === undefined ? {} : { line: edge.line }),
        provenance: "derived",
        confidence: edge.confidence,
      });
      addEdge({
        from: targetEndpoint,
        to: testEndpoint,
        kind: "tested_by",
        ...(edge.label === undefined ? {} : { label: edge.label }),
        ...(edge.line === undefined ? {} : { line: edge.line }),
        provenance: "derived",
        confidence: edge.confidence,
      });
    }
  }

  function repoPathForEndpoint(endpoint: string): string | undefined {
    if (endpoint.startsWith("external:") || isRepoRootEndpoint(endpoint)) {
      return undefined;
    }
    if (endpoint.startsWith("file:")) {
      return normalizeRepoPath(endpoint.slice("file:".length));
    }
    if (endpoint.startsWith("symbol:")) {
      return symbolById.get(endpoint.slice("symbol:".length))?.path;
    }
    const symbol = symbolById.get(endpoint);
    if (symbol) {
      return symbol.path;
    }
    const repoPath = normalizeRepoPath(endpoint);
    return filePaths.has(repoPath) ? repoPath : undefined;
  }
}

export function validateRepoFactGraph(graph: RepoFactGraph): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nodeKinds = new Set<RepoFactNodeKind>(REPO_FACT_NODE_KINDS);
  const edgeKinds = new Set<RepoFactEdgeKind>(REPO_FACT_EDGE_KINDS);
  const provenances = new Set<RepoFactProvenance>(REPO_FACT_PROVENANCES);

  if (graph.version !== 1) {
    errors.push(`unsupported fact graph version: ${String(graph.version)}`);
  }

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
    if (!nodeKinds.has(node.kind)) {
      errors.push(`invalid node kind: ${node.kind}`);
    }
    validateMetadata(`node ${node.id}`, node.metadata, errors);
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(`duplicate edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);
    if (!edgeKinds.has(edge.kind)) {
      errors.push(`invalid edge kind: ${edge.kind}`);
    }
    if (!provenances.has(edge.provenance)) {
      errors.push(`invalid edge provenance: ${edge.provenance}`);
    }
    if (!nodeIds.has(edge.from)) {
      errors.push(`missing edge endpoint: ${edge.id} from ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`missing edge endpoint: ${edge.id} to ${edge.to}`);
    }
    if (edge.confidence < 0 || edge.confidence > 1) {
      errors.push(`invalid edge confidence: ${edge.id}`);
    }
    validateMetadata(`edge ${edge.id}`, edge.metadata, errors);
  }

  return { valid: errors.length === 0, errors };
}

function createEdgeId(
  kind: RepoFactEdgeKind,
  from: string,
  to: string,
  label?: string,
  line?: number,
): string {
  return `edge:${kind}:${stableFactHash([from, to, label ?? "", String(line ?? "")])}`;
}

function validateMetadata(label: string, metadata: RepoFactMetadata, errors: string[]): void {
  if (!metadata.analyzer) {
    errors.push(`missing metadata analyzer: ${label}`);
  }
  if (!metadata.source) {
    errors.push(`missing metadata source: ${label}`);
  }
  if (!metadata.builtAt) {
    errors.push(`missing metadata builtAt: ${label}`);
  }
  if (!metadata.fingerprint) {
    errors.push(`missing metadata fingerprint: ${label}`);
  }
  if (metadata.confidence < 0 || metadata.confidence > 1) {
    errors.push(`invalid metadata confidence: ${label}`);
  }
  if (!["fresh", "stale", "unknown"].includes(metadata.freshness)) {
    errors.push(`invalid metadata freshness: ${label}`);
  }
}

function isTestPath(repoPath: string): boolean {
  return /(^|\/)(tests?|__tests__)\/|[._-](test|spec)\.[A-Za-z0-9]+$/.test(repoPath);
}

function normalizeRepoPath(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, "/").replace(/^\.\//, ""));
}
