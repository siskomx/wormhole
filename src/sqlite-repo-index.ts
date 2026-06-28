import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { classifyProjectLane, PROJECT_LANES, type ProjectLane } from "./project-lanes.js";
import {
  createIndexHealthSnapshot,
  type IndexHealthSnapshot,
} from "./index-health.js";
import {
  isRepoIndexFresh,
  summarizeRepoIndex,
  type RepoIndex,
  type RepoIndexQueryResult,
  type RepoIndexSearchResult,
  type RepoIndexSummary,
  type NormalizedRepoIndexBuildOptions,
} from "./repo-index.js";

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

export type SqliteRepoIndexStatus = {
  indexPath: string;
  fresh: boolean;
  ftsAvailable: boolean;
  retrievalModes: SqliteRepoIndexRetrievalMode[];
  summary: RepoIndexSummary;
  indexHealth: IndexHealthSnapshot;
};

export type SqliteRepoIndexRetrievalMode = "sqlite_fts" | "sqlite_like";

type SqliteRepoIndexSchema = {
  ftsAvailable: boolean;
};

const require = createRequire(import.meta.url);

export function sqliteRepoIndexPath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), ".wormhole", "indexes", "repo-index.sqlite");
}

export function writeSqliteRepoIndex(index: RepoIndex): string {
  const indexPath = sqliteRepoIndexPath(index.repoRoot);
  mkdirSync(path.dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;

  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(tempPath);
  let writeSucceeded = false;
  try {
    const schema = createSchema(db);
    db.exec("BEGIN IMMEDIATE");
    writeMetadata(db, index, schema);
    writeFiles(db, index, schema);
    writeSymbols(db, index, schema);
    writeEdges(db, index);
    db.exec("COMMIT");
    writeSucceeded = true;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors and surface the original failure.
    }
    throw error;
  } finally {
    db.close();
    if (!writeSucceeded) {
      rmSync(tempPath, { force: true });
    }
  }
  replaceFileWithBackup(tempPath, indexPath);
  return indexPath;
}

export function readSqliteRepoIndexStatus(repoRootInput: string): SqliteRepoIndexStatus | undefined {
  const repoRoot = path.resolve(repoRootInput);
  const indexPath = sqliteRepoIndexPath(repoRoot);
  if (!existsSync(indexPath)) {
    return undefined;
  }

  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(indexPath);
  try {
    const metadata = readMetadata(db);
    const buildOptions = JSON.parse(metadata.buildOptions ?? "{}") as NormalizedRepoIndexBuildOptions;
    const summary = JSON.parse(metadata.summary ?? "{}") as RepoIndexSummary;
    const ftsAvailable = metadata.ftsAvailable === "true" && hasFtsTables(db);
    const fresh = isRepoIndexFresh({
      repoRoot,
      builtAt: metadata.builtAt ?? "",
      buildOptions,
      fingerprint: metadata.fingerprint ?? "",
      files: [],
      symbols: [],
      edges: [],
      truncated: metadata.truncated === "true",
      skippedFiles: JSON.parse(metadata.skippedFiles ?? "[]") as string[],
    });
    const skippedFiles = Array.isArray(summary.skippedFiles) ? summary.skippedFiles : [];
    const indexHealth = createIndexHealthSnapshot({
      source: "durable_sqlite_index",
      present: true,
      fresh,
      truncated: summary.truncated,
      builtAt: summary.builtAt,
      indexPath,
      fileCount: summary.fileCount,
      skippedFiles,
      languageCoverage: summary.indexHealth?.languageCoverage ?? [],
      reasons: summary.indexHealth?.languageCoverage?.flatMap((coverage) => coverage.reasons) ?? [],
    });
    return {
      indexPath,
      fresh,
      ftsAvailable,
      retrievalModes: ftsAvailable ? ["sqlite_fts", "sqlite_like"] : ["sqlite_like"],
      summary: {
        ...summary,
        skippedFiles,
        indexHealth: summary.indexHealth ?? indexHealth,
      },
      indexHealth,
    };
  } finally {
    db.close();
  }
}

export function querySqliteRepoIndex(input: {
  repoRoot: string;
  query: string;
  lanes?: ProjectLane[];
  limit?: number;
}): RepoIndexQueryResult & {
  queriedLanes: ProjectLane[];
  indexPath: string;
  retrievalMode: SqliteRepoIndexRetrievalMode;
} | undefined {
  const repoRoot = path.resolve(input.repoRoot);
  const indexPath = sqliteRepoIndexPath(repoRoot);
  if (!existsSync(indexPath)) {
    return undefined;
  }
  const indexHealth =
    readSqliteRepoIndexStatus(repoRoot)?.indexHealth ??
    createIndexHealthSnapshot({
      source: "durable_sqlite_index",
      present: false,
      indexPath,
    });
  const limit = input.limit ?? 10;
  const tokens = tokenize(input.query);
  if (tokens.length === 0 || limit <= 0) {
    return {
      query: input.query,
      results: [],
      queriedLanes: input.lanes ?? [],
      indexPath,
      retrievalMode: "sqlite_like",
      indexHealth,
    };
  }

  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(indexPath);
  try {
    const lanes = input.lanes ?? readAvailableLanes(db);
    const queryResult = querySqliteCandidates(db, input.query, tokens, lanes);
    return {
      query: input.query,
      results: sortResults(queryResult.results, limit),
      queriedLanes: lanes,
      indexPath,
      retrievalMode: queryResult.retrievalMode,
      indexHealth,
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
    throw new Error(`SQLite durable indexes require Node's built-in node:sqlite module: ${message}`);
  }
}

function replaceFileWithBackup(sourcePath: string, targetPath: string): void {
  const backupPath = `${targetPath}.bak`;
  rmSync(backupPath, { force: true });
  if (!existsSync(targetPath)) {
    renameSync(sourcePath, targetPath);
    return;
  }

  renameSync(targetPath, backupPath);
  try {
    renameSync(sourcePath, targetPath);
    rmSync(backupPath, { force: true });
  } catch (error) {
    if (existsSync(backupPath) && !existsSync(targetPath)) {
      renameSync(backupPath, targetPath);
    }
    throw error;
  } finally {
    rmSync(sourcePath, { force: true });
  }
}

function createSchema(db: DatabaseSync): SqliteRepoIndexSchema {
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      lane TEXT NOT NULL,
      shard_root TEXT NOT NULL,
      line_count INTEGER NOT NULL,
      byte_length INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      hash TEXT NOT NULL,
      content TEXT NOT NULL,
      symbols_text TEXT NOT NULL
    );

    CREATE TABLE symbols (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      lane TEXT NOT NULL,
      line INTEGER NOT NULL
    );

    CREATE TABLE edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_node TEXT NOT NULL,
      to_node TEXT NOT NULL,
      kind TEXT NOT NULL,
      provenance TEXT NOT NULL,
      confidence REAL NOT NULL,
      line INTEGER,
      label TEXT
    );

    CREATE INDEX idx_files_lane ON files(lane);
    CREATE INDEX idx_files_path ON files(path);
    CREATE INDEX idx_symbols_lane ON symbols(lane);
    CREATE INDEX idx_symbols_name ON symbols(name);
    CREATE INDEX idx_symbols_path ON symbols(path);
    CREATE INDEX idx_edges_from ON edges(from_node);
    CREATE INDEX idx_edges_to ON edges(to_node);
  `);
  return { ftsAvailable: tryCreateFtsSchema(db) };
}

function tryCreateFtsSchema(db: DatabaseSync): boolean {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE files_fts USING fts5(
        path,
        language,
        lane UNINDEXED,
        symbols_text,
        content
      );

      CREATE VIRTUAL TABLE symbols_fts USING fts5(
        id UNINDEXED,
        name,
        kind,
        path,
        lane UNINDEXED
      );
    `);
    return true;
  } catch {
    return false;
  }
}

function writeMetadata(db: DatabaseSync, index: RepoIndex, schema: SqliteRepoIndexSchema): void {
  const insert = db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)");
  const summary = summarizeRepoIndex(index);
  const values: Record<string, string> = {
    version: "1",
    schemaVersion: "2",
    ftsAvailable: String(schema.ftsAvailable),
    repoRoot: index.repoRoot,
    builtAt: index.builtAt,
    buildOptions: JSON.stringify(index.buildOptions),
    fingerprint: index.fingerprint,
    truncated: String(index.truncated),
    skippedFiles: JSON.stringify(index.skippedFiles),
    summary: JSON.stringify(summary),
  };
  for (const [key, value] of Object.entries(values)) {
    insert.run(key, value);
  }
}

function writeFiles(db: DatabaseSync, index: RepoIndex, schema: SqliteRepoIndexSchema): void {
  const insert = db.prepare(`
    INSERT INTO files(path, language, lane, shard_root, line_count, byte_length, mtime_ms, hash, content, symbols_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = schema.ftsAvailable
    ? db.prepare(`
        INSERT INTO files_fts(path, language, lane, symbols_text, content)
        VALUES (?, ?, ?, ?, ?)
      `)
    : undefined;
  for (const file of index.files) {
    const lane = classifyProjectLane(file.path);
    const symbolsText = file.symbols.map((symbol) => symbol.name).join(" ");
    insert.run(
      file.path,
      file.language,
      lane,
      shardRootForPath(file.path),
      file.lineCount,
      file.byteLength,
      file.mtimeMs,
      file.hash,
      file.content,
      symbolsText,
    );
    insertFts?.run(file.path, file.language, lane, symbolsText, file.content);
  }
}

function writeSymbols(db: DatabaseSync, index: RepoIndex, schema: SqliteRepoIndexSchema): void {
  const insert = db.prepare(`
    INSERT INTO symbols(id, name, kind, path, lane, line)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertFts = schema.ftsAvailable
    ? db.prepare(`
        INSERT INTO symbols_fts(id, name, kind, path, lane)
        VALUES (?, ?, ?, ?, ?)
      `)
    : undefined;
  for (const symbol of index.symbols) {
    const lane = classifyProjectLane(symbol.path);
    insert.run(symbol.id, symbol.name, symbol.kind, symbol.path, lane, symbol.line);
    insertFts?.run(symbol.id, symbol.name, symbol.kind, symbol.path, lane);
  }
}

function writeEdges(db: DatabaseSync, index: RepoIndex): void {
  const insert = db.prepare(`
    INSERT INTO edges(from_node, to_node, kind, provenance, confidence, line, label)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const edge of index.edges) {
    insert.run(
      edge.from,
      edge.to,
      edge.kind,
      edge.provenance,
      edge.confidence,
      edge.line ?? null,
      edge.label ?? null,
    );
  }
}

function readMetadata(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM metadata").all();
  const metadata: Record<string, string> = {};
  for (const row of rows) {
    metadata[String(row.key)] = String(row.value);
  }
  return metadata;
}

function readAvailableLanes(db: DatabaseSync): ProjectLane[] {
  const lanes = db
    .prepare("SELECT DISTINCT lane FROM files ORDER BY lane")
    .all()
    .map((row) => String(row.lane))
    .filter((lane): lane is ProjectLane => PROJECT_LANES.includes(lane as ProjectLane));
  return lanes;
}

function querySqliteCandidates(
  db: DatabaseSync,
  query: string,
  tokens: string[],
  lanes: ProjectLane[],
): { results: RepoIndexSearchResult[]; retrievalMode: SqliteRepoIndexRetrievalMode } {
  if (hasFtsTables(db)) {
    try {
      return {
        retrievalMode: "sqlite_fts",
        results: [
          ...querySymbolsFts(db, query, tokens, lanes),
          ...queryFilesFts(db, query, tokens, lanes),
        ],
      };
    } catch {
      // Older SQLite builds can create the regular tables but lack working FTS5 support.
    }
  }
  return {
    retrievalMode: "sqlite_like",
    results: [
      ...querySymbols(db, query, tokens, lanes),
      ...queryFiles(db, query, tokens, lanes),
    ],
  };
}

function querySymbolsFts(
  db: DatabaseSync,
  query: string,
  tokens: string[],
  lanes: ProjectLane[],
): RepoIndexSearchResult[] {
  return searchSymbolRows(selectFtsRows(db, "symbols", tokens, lanes), query, tokens);
}

function querySymbols(
  db: DatabaseSync,
  query: string,
  tokens: string[],
  lanes: ProjectLane[],
): RepoIndexSearchResult[] {
  const rows = selectCandidateRows(db, "symbols", "lower(name || ' ' || kind || ' ' || path)", tokens, lanes);
  return searchSymbolRows(rows, query, tokens);
}

function searchSymbolRows(
  rows: Record<string, unknown>[],
  query: string,
  tokens: string[],
): RepoIndexSearchResult[] {
  const queryLower = query.toLowerCase();
  return rows.flatMap((row) => {
    const name = String(row.name);
    const kind = String(row.kind);
    const symbolPath = String(row.path);
    const line = Number(row.line);
    const haystack = `${name} ${kind} ${symbolPath}`;
    const score = scoreText(haystack, tokens, queryLower) + scoreText(name, tokens) * 3;
    if (score <= 0) {
      return [];
    }
    return [
      {
        kind: "symbol" as const,
        path: symbolPath,
        line,
        score: score + 5,
        title: `${kind} ${name}`,
        excerpt: `${kind} ${name} in ${symbolPath}:${line}`,
      },
    ];
  });
}

function queryFilesFts(
  db: DatabaseSync,
  query: string,
  tokens: string[],
  lanes: ProjectLane[],
): RepoIndexSearchResult[] {
  return searchFileRows(selectFtsRows(db, "files", tokens, lanes), query, tokens);
}

function queryFiles(
  db: DatabaseSync,
  query: string,
  tokens: string[],
  lanes: ProjectLane[],
): RepoIndexSearchResult[] {
  const rows = selectCandidateRows(
    db,
    "files",
    "lower(path || ' ' || language || ' ' || symbols_text || ' ' || content)",
    tokens,
    lanes,
  );
  return searchFileRows(rows, query, tokens);
}

function searchFileRows(
  rows: Record<string, unknown>[],
  query: string,
  tokens: string[],
): RepoIndexSearchResult[] {
  const queryLower = query.toLowerCase();
  const results: RepoIndexSearchResult[] = [];
  for (const row of rows) {
    const filePath = String(row.path);
    const language = String(row.language);
    const symbolsText = String(row.symbols_text);
    const content = String(row.content);
    const pathScore = scoreText(`${filePath} ${language}`, tokens, queryLower) * 2;
    const symbolScore = scoreText(symbolsText, tokens, queryLower);
    if (pathScore + symbolScore > 0) {
      results.push({
        kind: "file",
        path: filePath,
        line: 1,
        score: pathScore + symbolScore,
        title: filePath,
        excerpt: filePath,
      });
    }

    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const lineScore = scoreText(line, tokens, queryLower);
      if (lineScore === 0) {
        continue;
      }
      results.push({
        kind: "file",
        path: filePath,
        line: index + 1,
        score: lineScore + pathScore + symbolScore,
        title: `${filePath}:${index + 1}`,
        excerpt: compactLine(line),
      });
    }
  }
  return results;
}

function selectFtsRows(
  db: DatabaseSync,
  table: "files" | "symbols",
  tokens: string[],
  lanes: ProjectLane[],
): Record<string, unknown>[] {
  const ftsTable = `${table}_fts`;
  const joinColumn = table === "files" ? "path" : "id";
  const lanePlaceholders = lanes.map(() => "?").join(", ");
  const clauses = [
    lanes.length > 0 ? `${table}.lane IN (${lanePlaceholders})` : "",
    `${ftsTable} MATCH ?`,
  ].filter(Boolean);
  const sql = [
    `SELECT ${table}.* FROM ${table}`,
    `JOIN ${ftsTable} ON ${ftsTable}.${joinColumn} = ${table}.${joinColumn}`,
    `WHERE ${clauses.join(" AND ")}`,
  ].join(" ");
  return db.prepare(sql).all(...lanes, createFtsQuery(tokens));
}

function selectCandidateRows(
  db: DatabaseSync,
  table: "files" | "symbols",
  haystackSql: string,
  tokens: string[],
  lanes: ProjectLane[],
): Record<string, unknown>[] {
  const lanePlaceholders = lanes.map(() => "?").join(", ");
  const tokenClauses = tokens.map(() => `${haystackSql} LIKE ? ESCAPE '\\'`).join(" OR ");
  const sql = [
    `SELECT * FROM ${table}`,
    lanes.length > 0 || tokens.length > 0 ? "WHERE" : "",
    lanes.length > 0 ? `lane IN (${lanePlaceholders})` : "",
    lanes.length > 0 && tokens.length > 0 ? "AND" : "",
    tokens.length > 0 ? `(${tokenClauses})` : "",
  ].filter(Boolean).join(" ");
  return db.prepare(sql).all(...lanes, ...tokens.map((token) => `%${escapeLikeToken(token.toLowerCase())}%`));
}

function hasFtsTables(db: DatabaseSync): boolean {
  const files = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'files_fts'")
    .get();
  const symbols = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'symbols_fts'")
    .get();
  return Boolean(files && symbols);
}

function createFtsQuery(tokens: string[]): string {
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
}

function sortResults(results: RepoIndexSearchResult[], limit: number): RepoIndexSearchResult[] {
  return results
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.path !== right.path) {
        return left.path.localeCompare(right.path);
      }
      return (left.line ?? 0) - (right.line ?? 0);
    })
    .slice(0, limit);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_$]+/i)
    .filter(Boolean);
}

function scoreText(text: string, tokens: string[], queryLower?: string): number {
  const lower = text.toLowerCase();
  let score = queryLower && lower.includes(queryLower) ? queryLower.length * 2 : 0;
  for (const token of tokens) {
    if (lower.includes(token)) {
      score += token.length;
    }
  }
  return score;
}

function escapeLikeToken(token: string): string {
  return token.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function compactLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length <= 160) {
    return trimmed;
  }
  return `${trimmed.slice(0, 157)}...`;
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
