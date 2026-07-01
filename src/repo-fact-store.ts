import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  REPO_INDEX_EXTRACTOR_VERSION,
  isRepoIndexFresh,
  type RepoIndex,
} from "./repo-index.js";
import {
  type RepoFactEdge,
  type RepoFactEdgeKind,
  type RepoFactGraph,
  type RepoFactMetadata,
  type RepoFactNode,
  type RepoFactNodeKind,
  type RepoFactProvenance,
} from "./repo-facts.js";
import { readSqliteRepoIndexStatus, sqliteRepoIndexPath } from "./sqlite-repo-index.js";

type DatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
  close(): void;
};

type SqliteModule = {
  DatabaseSync: new (filename: string) => DatabaseSync;
};

export type RepoFactStoreStatus = {
  repoRoot: string;
  sqlitePath: string;
  present: boolean;
  fresh: boolean;
  fingerprint?: string;
  extractorVersion?: string;
  nodeCount: number;
  edgeCount: number;
  staleReasons: string[];
  warnings: string[];
};

type RepoFactMetaRow = {
  repoRoot: string;
  fingerprint: string;
  extractorVersion: string;
  builtAt: string;
  buildOptionsJson: string;
  warnings: string[];
};

type DurableSqliteMetadata = {
  fingerprint?: string;
  extractorVersion?: string;
  buildOptionsJson?: string;
};

const require = createRequire(import.meta.url);

export function repoFactSqlitePath(repoRoot: string): string {
  return sqliteRepoIndexPath(repoRoot);
}

export function writeRepoFactGraph(graph: RepoFactGraph): {
  repoRoot: string;
  sqlitePath: string;
  graph: RepoFactGraph;
} {
  const repoRoot = path.resolve(graph.repoRoot);
  const sqlitePath = repoFactSqlitePath(repoRoot);
  mkdirSync(path.dirname(sqlitePath), { recursive: true });

  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(sqlitePath);
  const normalizedGraph: RepoFactGraph = { ...graph, repoRoot };
  try {
    createFactSchema(db);
    const durableMetadata = readDurableSqliteMetadata(db);
    const buildOptionsJson =
      graph.buildOptions === undefined
        ? canonicalJsonFromString(durableMetadata?.buildOptionsJson) ?? "{}"
        : canonicalJson(graph.buildOptions);

    db.exec("BEGIN IMMEDIATE");
    try {
      deleteRepoFacts(db, repoRoot);
      insertRepoFactMeta(db, normalizedGraph, buildOptionsJson);
      insertRepoFactNodes(db, normalizedGraph);
      insertRepoFactEdges(db, normalizedGraph);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Surface the original write failure.
      }
      throw error;
    }
  } finally {
    db.close();
  }

  return { repoRoot, sqlitePath, graph: normalizedGraph };
}

export function readRepoFactGraph(input: {
  repoRoot: string;
  limit?: number;
  cursor?: string;
}): { graph: RepoFactGraph; nextCursor?: string } | undefined {
  const repoRoot = path.resolve(input.repoRoot);
  const sqlitePath = repoFactSqlitePath(repoRoot);
  if (!existsSync(sqlitePath)) {
    return undefined;
  }

  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(sqlitePath);
  try {
    if (!hasFactSchema(db)) {
      return undefined;
    }
    const meta = readRepoFactMeta(db, repoRoot);
    if (!meta) {
      return undefined;
    }

    const nodeCount = countRows(db, "repo_fact_nodes", repoRoot);
    const edgeCount = countRows(db, "repo_fact_edges", repoRoot);
    const totalCount = nodeCount + edgeCount;
    const offset = parseCursor(input.cursor);
    const limit = normalizeLimit(input.limit);
    const page = createPageWindow({ nodeCount, edgeCount, offset, limit });
    const nodes = selectRepoFactNodes(db, repoRoot, page.nodeLimit, page.nodeOffset);
    const edges = selectRepoFactEdges(db, repoRoot, page.edgeLimit, page.edgeOffset);
    const readCount = nodes.length + edges.length;
    const nextOffset = offset + readCount;

    return {
      graph: {
        version: 1,
        repoRoot,
        builtAt: meta.builtAt,
        fingerprint: meta.fingerprint,
        extractorVersion: meta.extractorVersion,
        nodes,
        edges,
        warnings: meta.warnings,
      },
      ...(limit !== undefined && nextOffset < totalCount ? { nextCursor: String(nextOffset) } : {}),
    };
  } finally {
    db.close();
  }
}

export function repoFactStoreStatus(input: {
  repoRoot: string;
  currentIndex?: RepoIndex;
  requireFresh?: boolean;
}): RepoFactStoreStatus {
  const repoRoot = path.resolve(input.repoRoot);
  const sqlitePath = repoFactSqlitePath(repoRoot);
  if (!existsSync(sqlitePath)) {
    return missingStatus(repoRoot, sqlitePath);
  }

  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(sqlitePath);
  try {
    if (!hasFactSchema(db)) {
      return missingStatus(repoRoot, sqlitePath);
    }

    const meta = readRepoFactMeta(db, repoRoot);
    if (!meta) {
      return missingStatus(repoRoot, sqlitePath);
    }

    const nodeCount = countRows(db, "repo_fact_nodes", repoRoot);
    const edgeCount = countRows(db, "repo_fact_edges", repoRoot);
    const durableMetadata = readDurableSqliteMetadata(db);
    const staleReasons = collectStaleReasons({
      repoRoot,
      meta,
      durableMetadata,
      currentIndex: input.currentIndex,
    });

    return {
      repoRoot,
      sqlitePath,
      present: true,
      fresh: staleReasons.length === 0,
      fingerprint: meta.fingerprint,
      extractorVersion: meta.extractorVersion,
      nodeCount,
      edgeCount,
      staleReasons,
      warnings: meta.warnings,
    };
  } finally {
    db.close();
  }
}

function loadSqlite(): SqliteModule {
  try {
    return require("node:sqlite") as SqliteModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SQLite fact storage requires Node's built-in node:sqlite module: ${message}`);
  }
}

function createFactSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repo_fact_meta (
      repo_root TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      built_at TEXT NOT NULL,
      build_options_json TEXT NOT NULL,
      warning_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repo_fact_nodes (
      repo_root TEXT NOT NULL,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      path TEXT,
      line INTEGER,
      metadata_json TEXT NOT NULL,
      PRIMARY KEY (repo_root, id)
    );

    CREATE TABLE IF NOT EXISTS repo_fact_edges (
      repo_root TEXT NOT NULL,
      id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT,
      line INTEGER,
      provenance TEXT NOT NULL,
      confidence REAL NOT NULL,
      metadata_json TEXT NOT NULL,
      PRIMARY KEY (repo_root, id)
    );

    CREATE INDEX IF NOT EXISTS repo_fact_edges_from_kind ON repo_fact_edges(repo_root, from_id, kind);
    CREATE INDEX IF NOT EXISTS repo_fact_edges_to_kind ON repo_fact_edges(repo_root, to_id, kind);
    CREATE INDEX IF NOT EXISTS repo_fact_nodes_path ON repo_fact_nodes(repo_root, path);
    CREATE INDEX IF NOT EXISTS repo_fact_nodes_label ON repo_fact_nodes(repo_root, label);
  `);
}

function hasFactSchema(db: DatabaseSync): boolean {
  return tableExists(db, "repo_fact_meta") && tableExists(db, "repo_fact_nodes") && tableExists(db, "repo_fact_edges");
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function deleteRepoFacts(db: DatabaseSync, repoRoot: string): void {
  db.prepare("DELETE FROM repo_fact_edges WHERE repo_root = ?").run(repoRoot);
  db.prepare("DELETE FROM repo_fact_nodes WHERE repo_root = ?").run(repoRoot);
  db.prepare("DELETE FROM repo_fact_meta WHERE repo_root = ?").run(repoRoot);
}

function insertRepoFactMeta(db: DatabaseSync, graph: RepoFactGraph, buildOptionsJson: string): void {
  db.prepare(`
    INSERT INTO repo_fact_meta(repo_root, fingerprint, extractor_version, built_at, build_options_json, warning_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    graph.repoRoot,
    graph.fingerprint,
    graph.extractorVersion,
    graph.builtAt,
    buildOptionsJson,
    JSON.stringify(graph.warnings),
  );
}

function insertRepoFactNodes(db: DatabaseSync, graph: RepoFactGraph): void {
  const insert = db.prepare(`
    INSERT INTO repo_fact_nodes(repo_root, id, kind, label, path, line, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const nodes = [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id));
  for (const node of nodes) {
    insert.run(
      graph.repoRoot,
      node.id,
      node.kind,
      node.label,
      node.path ?? null,
      node.line ?? null,
      JSON.stringify(node.metadata),
    );
  }
}

function insertRepoFactEdges(db: DatabaseSync, graph: RepoFactGraph): void {
  const insert = db.prepare(`
    INSERT INTO repo_fact_edges(
      repo_root, id, from_id, to_id, kind, label, line, provenance, confidence, metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const edges = [...graph.edges].sort((left, right) => left.id.localeCompare(right.id));
  for (const edge of edges) {
    insert.run(
      graph.repoRoot,
      edge.id,
      edge.from,
      edge.to,
      edge.kind,
      edge.label ?? null,
      edge.line ?? null,
      edge.provenance,
      edge.confidence,
      JSON.stringify(edge.metadata),
    );
  }
}

function readRepoFactMeta(db: DatabaseSync, repoRoot: string): RepoFactMetaRow | undefined {
  const row = db
    .prepare(
      [
        "SELECT repo_root, fingerprint, extractor_version, built_at, build_options_json, warning_json",
        "FROM repo_fact_meta",
        "WHERE repo_root = ?",
      ].join(" "),
    )
    .get(repoRoot);
  if (!row) {
    return undefined;
  }
  return {
    repoRoot: String(row.repo_root),
    fingerprint: String(row.fingerprint),
    extractorVersion: String(row.extractor_version),
    builtAt: String(row.built_at),
    buildOptionsJson: String(row.build_options_json),
    warnings: parseJson(row.warning_json, [] as string[]),
  };
}

function readDurableSqliteMetadata(db: DatabaseSync): DurableSqliteMetadata | undefined {
  if (!tableExists(db, "metadata")) {
    return undefined;
  }
  const rows = db.prepare("SELECT key, value FROM metadata").all();
  if (rows.length === 0) {
    return undefined;
  }
  const metadata: Record<string, string> = {};
  for (const row of rows) {
    metadata[String(row.key)] = String(row.value);
  }
  return {
    fingerprint: metadata.fingerprint,
    extractorVersion: metadata.extractorVersion,
    buildOptionsJson: metadata.buildOptions,
  };
}

function countRows(db: DatabaseSync, tableName: "repo_fact_nodes" | "repo_fact_edges", repoRoot: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE repo_root = ?`).get(repoRoot);
  return Number(row?.count ?? 0);
}

function selectRepoFactNodes(
  db: DatabaseSync,
  repoRoot: string,
  limit?: number,
  offset = 0,
): RepoFactNode[] {
  const sql = [
    "SELECT id, kind, label, path, line, metadata_json",
    "FROM repo_fact_nodes",
    "WHERE repo_root = ?",
    "ORDER BY id",
    limit === undefined ? "" : "LIMIT ? OFFSET ?",
  ].filter(Boolean).join(" ");
  const rows =
    limit === undefined
      ? db.prepare(sql).all(repoRoot)
      : limit <= 0
        ? []
        : db.prepare(sql).all(repoRoot, limit, offset);
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind) as RepoFactNodeKind,
    label: String(row.label),
    ...(row.path === null || row.path === undefined ? {} : { path: String(row.path) }),
    ...optionalNumberProperty("line", row.line),
    metadata: parseJson(row.metadata_json, fallbackMetadata()),
  }));
}

function selectRepoFactEdges(
  db: DatabaseSync,
  repoRoot: string,
  limit?: number,
  offset = 0,
): RepoFactEdge[] {
  const sql = [
    "SELECT id, from_id, to_id, kind, label, line, provenance, confidence, metadata_json",
    "FROM repo_fact_edges",
    "WHERE repo_root = ?",
    "ORDER BY id",
    limit === undefined ? "" : "LIMIT ? OFFSET ?",
  ].filter(Boolean).join(" ");
  const rows =
    limit === undefined
      ? db.prepare(sql).all(repoRoot)
      : limit <= 0
        ? []
        : db.prepare(sql).all(repoRoot, limit, offset);
  return rows.map((row) => ({
    id: String(row.id),
    from: String(row.from_id),
    to: String(row.to_id),
    kind: String(row.kind) as RepoFactEdgeKind,
    ...(row.label === null || row.label === undefined ? {} : { label: String(row.label) }),
    ...optionalNumberProperty("line", row.line),
    provenance: String(row.provenance) as RepoFactProvenance,
    confidence: Number(row.confidence),
    metadata: parseJson(row.metadata_json, fallbackMetadata()),
  }));
}

function collectStaleReasons(input: {
  repoRoot: string;
  meta: RepoFactMetaRow;
  durableMetadata?: DurableSqliteMetadata;
  currentIndex?: RepoIndex;
}): string[] {
  const staleReasons = new Set<string>();
  const currentExtractorVersion = input.currentIndex?.extractorVersion;
  const currentBuildOptionsJson = input.currentIndex
    ? canonicalJson(input.currentIndex.buildOptions)
    : undefined;
  const durableBuildOptionsJson = canonicalJsonFromString(input.durableMetadata?.buildOptionsJson);

  if (input.meta.extractorVersion !== REPO_INDEX_EXTRACTOR_VERSION) {
    staleReasons.add("fact_extractor_version_mismatch");
  }

  if (!input.currentIndex) {
    staleReasons.add("current_index_missing");
  } else {
    if (!isRepoIndexFresh(input.currentIndex)) {
      staleReasons.add("current_index_stale");
    }
    if (input.meta.fingerprint !== input.currentIndex.fingerprint) {
      staleReasons.add("fact_fingerprint_mismatch");
    }
    if (currentExtractorVersion !== REPO_INDEX_EXTRACTOR_VERSION) {
      staleReasons.add("current_extractor_version_mismatch");
    }
    if (input.meta.extractorVersion !== currentExtractorVersion) {
      staleReasons.add("fact_extractor_version_mismatch");
    }
    if (input.meta.buildOptionsJson !== currentBuildOptionsJson) {
      staleReasons.add("build_options_mismatch");
    }
  }

  if (!input.durableMetadata) {
    staleReasons.add("durable_index_missing");
  } else {
    if (input.durableMetadata.fingerprint !== input.meta.fingerprint) {
      staleReasons.add("durable_index_fingerprint_mismatch");
    }
    if (input.currentIndex && input.durableMetadata.fingerprint !== input.currentIndex.fingerprint) {
      staleReasons.add("durable_index_fingerprint_mismatch");
    }
    if (input.durableMetadata.extractorVersion !== input.meta.extractorVersion) {
      staleReasons.add("durable_index_extractor_version_mismatch");
    }
    if (input.currentIndex && input.durableMetadata.extractorVersion !== currentExtractorVersion) {
      staleReasons.add("durable_index_extractor_version_mismatch");
    }
    if (durableBuildOptionsJson !== input.meta.buildOptionsJson) {
      staleReasons.add("build_options_mismatch");
    }
    if (currentBuildOptionsJson !== undefined && durableBuildOptionsJson !== currentBuildOptionsJson) {
      staleReasons.add("build_options_mismatch");
    }
    if (!safeDurableSqliteFresh(input.repoRoot)) {
      staleReasons.add("durable_index_stale");
    }
  }

  return [...staleReasons].sort((left, right) => left.localeCompare(right));
}

function safeDurableSqliteFresh(repoRoot: string): boolean {
  try {
    return readSqliteRepoIndexStatus(repoRoot)?.fresh === true;
  } catch {
    return false;
  }
}

function missingStatus(repoRoot: string, sqlitePath: string): RepoFactStoreStatus {
  return {
    repoRoot,
    sqlitePath,
    present: false,
    fresh: false,
    nodeCount: 0,
    edgeCount: 0,
    staleReasons: ["fact_store_missing"],
    warnings: [],
  };
}

function createPageWindow(input: {
  nodeCount: number;
  edgeCount: number;
  offset: number;
  limit?: number;
}): {
  nodeOffset: number;
  nodeLimit?: number;
  edgeOffset: number;
  edgeLimit?: number;
} {
  if (input.limit === undefined) {
    return { nodeOffset: 0, edgeOffset: 0 };
  }
  const boundedOffset = Math.max(0, Math.min(input.offset, input.nodeCount + input.edgeCount));
  const nodeOffset = Math.min(boundedOffset, input.nodeCount);
  const edgeOffset = Math.max(0, boundedOffset - input.nodeCount);
  const nodeLimit = Math.min(input.limit, Math.max(0, input.nodeCount - nodeOffset));
  const edgeLimit = Math.max(0, input.limit - nodeLimit);
  return { nodeOffset, nodeLimit, edgeOffset, edgeLimit };
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) {
    return undefined;
  }
  if (!Number.isFinite(limit)) {
    return undefined;
  }
  return Math.max(0, Math.floor(limit));
}

function optionalNumberProperty<Key extends string>(
  key: Key,
  value: unknown,
): Partial<Record<Key, number>> {
  if (value === null || value === undefined) {
    return {};
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? ({ [key]: numberValue } as Partial<Record<Key, number>>) : {};
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function canonicalJsonFromString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return canonicalJson(JSON.parse(value) as unknown);
  } catch {
    return value;
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      const nested = (value as Record<string, unknown>)[key];
      if (nested !== undefined) {
        sorted[key] = sortJsonValue(nested);
      }
    }
    return sorted;
  }
  return value;
}

function fallbackMetadata(): RepoFactMetadata {
  return {
    analyzer: "unknown",
    source: "sqlite",
    builtAt: "",
    fingerprint: "",
    confidence: 0,
    freshness: "unknown",
  };
}
