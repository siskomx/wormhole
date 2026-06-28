import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  buildDomainIndex,
  compareDomainIndexes,
  type DomainApiEndpoint,
  type DomainCoverageGap,
  type DomainDriftReport,
  type DomainIndex,
  type DomainIndexFeature,
  type DomainTable,
  type DomainVerificationGatePlan,
} from "./domain-index.js";
import { createIndexHealthSnapshot, type IndexHealthSnapshot } from "./index-health.js";

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

export type DomainIndexSummary = {
  repoRoot: string;
  generatedAt: string;
  fingerprint: string;
  manifestPresent: boolean;
  fileCount: number;
  featureCount: number;
  apiEndpointCount: number;
  tableCount: number;
  coverageGapCount: number;
  warningCount: number;
};

export type DomainIndexRefreshResult = {
  repoRoot: string;
  indexPath: string;
  summary: DomainIndexSummary;
};

export type DomainIndexStatus = {
  repoRoot: string;
  indexPath: string;
  fresh: boolean;
  summary: DomainIndexSummary;
  indexHealth: IndexHealthSnapshot;
  warnings: string[];
};

export type DomainQueryBaseResult = {
  repoRoot: string;
  indexPath: string;
  fresh: boolean;
  indexHealth: IndexHealthSnapshot;
  warnings: string[];
  refused?: boolean;
};

export type DomainSliceQueryResult = DomainQueryBaseResult & {
  feature?: DomainIndexFeature;
  files: DomainIndex["files"];
  apiEndpoints: DomainApiEndpoint[];
  tables: DomainTable[];
  coverageGaps: DomainCoverageGap[];
  verificationGates: DomainVerificationGatePlan[];
};

export type DomainApiQueryResult = DomainQueryBaseResult & {
  endpoints: DomainApiEndpoint[];
};

export type DomainTableQueryResult = DomainQueryBaseResult & {
  table?: DomainTable;
  tables: DomainTable[];
};

export type DomainCoverageQueryResult = DomainQueryBaseResult & {
  gaps: DomainCoverageGap[];
};

export type DomainVerificationGateQueryResult = DomainQueryBaseResult & {
  gates: DomainVerificationGatePlan[];
};

const DOMAIN_SQLITE_SCHEMA_VERSION = "domain-index.sqlite.v1";
const require = createRequire(import.meta.url);

export function domainIndexSqlitePath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), ".wormhole", "indexes", "domain-index.sqlite");
}

export function refreshDomainIndex(input: { repoRoot: string; generatedAt?: string }): DomainIndexRefreshResult {
  const index = buildDomainIndex(input);
  const indexPath = writeSqliteDomainIndex(index);
  return {
    repoRoot: index.repoRoot,
    indexPath,
    summary: summarizeDomainIndex(index),
  };
}

export function readDomainIndexStatus(input: { repoRoot: string }): DomainIndexStatus | undefined {
  const repoRoot = path.resolve(input.repoRoot);
  const indexPath = domainIndexSqlitePath(repoRoot);
  if (!existsSync(indexPath)) {
    return undefined;
  }

  const stored = readStoredIndex(indexPath);
  if (!stored) {
    return undefined;
  }
  const current = buildDomainIndex({ repoRoot });
  const fresh = stored.schemaVersion === "domain-index.v0" && stored.fingerprint === current.fingerprint;
  const summary = summarizeDomainIndex(stored);
  const indexHealth = createDomainIndexHealth({
    indexPath,
    fresh,
    summary,
    warnings: stored.warnings,
  });
  return {
    repoRoot,
    indexPath,
    fresh,
    summary,
    indexHealth,
    warnings: domainIndexWarnings(indexHealth),
  };
}

export function queryDomainSlice(input: {
  repoRoot: string;
  feature: string;
  requireFresh?: boolean;
}): DomainSliceQueryResult {
  const context = readQueryContext(input.repoRoot);
  if (shouldRefuse(context, input.requireFresh)) {
    return {
      ...baseResult(context, true),
      files: [],
      apiEndpoints: [],
      tables: [],
      coverageGaps: [],
      verificationGates: [],
    };
  }
  const index = context.index;
  const feature = index ? findFeature(index, input.feature) : undefined;
  return {
    ...baseResult(context),
    ...(feature ? { feature } : {}),
    files: feature && index ? featureFiles(index, feature) : [],
    apiEndpoints: feature && index ? index.apiEndpoints.filter((endpoint) => endpoint.featureId === feature.featureId) : [],
    tables: feature && index ? index.tables.filter((table) => feature.tables.includes(table.name) || table.featureId === feature.featureId) : [],
    coverageGaps: feature
      ? index?.coverage.gaps.filter((gap) => gap.subject.includes(`:${feature.featureId}`) || gap.message.includes(feature.featureId)) ?? []
      : [],
    verificationGates: feature
      ? index?.verificationGates.filter((gate) => gate.matchedFeatureIds.includes(feature.featureId)) ?? []
      : [],
  };
}

export function queryDomainApi(input: {
  repoRoot: string;
  feature?: string;
  method?: string;
  pathTemplate?: string;
  query?: string;
  requireFresh?: boolean;
}): DomainApiQueryResult {
  const context = readQueryContext(input.repoRoot);
  if (shouldRefuse(context, input.requireFresh)) {
    return { ...baseResult(context, true), endpoints: [] };
  }
  const feature = input.feature && context.index ? findFeature(context.index, input.feature) : undefined;
  const query = input.query?.toLowerCase();
  const endpoints = (context.index?.apiEndpoints ?? []).filter((endpoint) => {
    if (feature && endpoint.featureId !== feature.featureId) return false;
    if (input.method && endpoint.method !== input.method.toUpperCase()) return false;
    if (input.pathTemplate && endpoint.pathTemplate !== input.pathTemplate) return false;
    if (query && !`${endpoint.method} ${endpoint.pathTemplate} ${endpoint.operationId ?? ""}`.toLowerCase().includes(query)) return false;
    return true;
  });
  return { ...baseResult(context), endpoints };
}

export function queryDomainTable(input: {
  repoRoot: string;
  table?: string;
  feature?: string;
  requireFresh?: boolean;
}): DomainTableQueryResult {
  const context = readQueryContext(input.repoRoot);
  if (shouldRefuse(context, input.requireFresh)) {
    return { ...baseResult(context, true), tables: [] };
  }
  const feature = input.feature && context.index ? findFeature(context.index, input.feature) : undefined;
  const tableName = input.table?.toLowerCase();
  const tables = (context.index?.tables ?? []).filter((table) => {
    if (tableName && table.name !== tableName) return false;
    if (feature && table.featureId !== feature.featureId && !feature.tables.includes(table.name)) return false;
    return true;
  });
  return { ...baseResult(context), table: tableName ? tables[0] : undefined, tables };
}

export function queryDomainCoverage(input: {
  repoRoot: string;
  severity?: DomainCoverageGap["severity"];
  kind?: DomainCoverageGap["kind"];
  requireFresh?: boolean;
}): DomainCoverageQueryResult {
  const context = readQueryContext(input.repoRoot);
  if (shouldRefuse(context, input.requireFresh)) {
    return { ...baseResult(context, true), gaps: [] };
  }
  const gaps = (context.index?.coverage.gaps ?? []).filter((gap) => {
    if (input.severity && gap.severity !== input.severity) return false;
    if (input.kind && gap.kind !== input.kind) return false;
    return true;
  });
  return { ...baseResult(context), gaps };
}

export function queryDomainDrift(input: { repoRoot: string }): DomainDriftReport {
  const repoRoot = path.resolve(input.repoRoot);
  const indexPath = domainIndexSqlitePath(repoRoot);
  const current = buildDomainIndex({ repoRoot });
  const stored = existsSync(indexPath) ? readStoredIndex(indexPath) : undefined;
  if (!stored) {
    return {
      fresh: false,
      currentFingerprint: current.fingerprint,
      addedFiles: current.files.map((file) => file.path).sort((left, right) => left.localeCompare(right)),
      removedFiles: [],
      changedFiles: [],
      coverageGaps: current.coverage.gaps,
      warnings: ["Domain index is missing; refresh before relying on domain-specific repo guidance."],
    };
  }
  return compareDomainIndexes(stored, current);
}

export function queryDomainVerificationGatePlan(input: {
  repoRoot: string;
  gateId?: string;
  feature?: string;
  requireFresh?: boolean;
}): DomainVerificationGateQueryResult {
  const context = readQueryContext(input.repoRoot);
  if (shouldRefuse(context, input.requireFresh)) {
    return { ...baseResult(context, true), gates: [] };
  }
  const feature = input.feature && context.index ? findFeature(context.index, input.feature) : undefined;
  const gates = (context.index?.verificationGates ?? []).filter((gate) => {
    if (input.gateId && gate.gateId !== input.gateId) return false;
    if (feature && !gate.matchedFeatureIds.includes(feature.featureId)) return false;
    return true;
  });
  return { ...baseResult(context), gates };
}

function writeSqliteDomainIndex(index: DomainIndex): string {
  const indexPath = domainIndexSqlitePath(index.repoRoot);
  mkdirSync(path.dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(tempPath);
  let writeSucceeded = false;
  try {
    createSchema(db);
    db.exec("BEGIN IMMEDIATE");
    writeMetadata(db, index);
    writeFiles(db, index);
    writeFeatures(db, index);
    writeApiEndpoints(db, index);
    writeTables(db, index);
    writeFacts(db, index);
    writeCoverageGaps(db, index);
    writeVerificationGates(db, index);
    writeSourceConflicts(db, index);
    db.exec("COMMIT");
    writeSucceeded = true;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Surface the original write failure.
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

function createSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE files (
      path TEXT NOT NULL,
      role TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (path, role)
    );

    CREATE TABLE features (
      feature_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );

    CREATE TABLE feature_aliases (
      feature_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      PRIMARY KEY (feature_id, alias)
    );

    CREATE TABLE feature_roots (
      feature_id TEXT NOT NULL,
      root TEXT NOT NULL,
      PRIMARY KEY (feature_id, root)
    );

    CREATE TABLE feature_portals (
      feature_id TEXT NOT NULL,
      portal TEXT NOT NULL,
      PRIMARY KEY (feature_id, portal)
    );

    CREATE TABLE feature_tables (
      feature_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      PRIMARY KEY (feature_id, table_name)
    );

    CREATE TABLE feature_files (
      feature_id TEXT NOT NULL,
      role TEXT NOT NULL,
      path TEXT NOT NULL,
      PRIMARY KEY (feature_id, role, path)
    );

    CREATE TABLE api_endpoints (
      id INTEGER PRIMARY KEY,
      feature_id TEXT,
      method TEXT NOT NULL,
      origin TEXT NOT NULL,
      path_template TEXT NOT NULL,
      operation_id TEXT,
      source TEXT NOT NULL,
      request_content_type TEXT,
      response_content_type TEXT,
      auth_required INTEGER NOT NULL,
      source_path TEXT NOT NULL
    );

    CREATE TABLE api_endpoint_query_keys (
      endpoint_id INTEGER NOT NULL,
      query_key TEXT NOT NULL,
      PRIMARY KEY (endpoint_id, query_key)
    );

    CREATE TABLE api_endpoint_response_schemas (
      endpoint_id INTEGER NOT NULL,
      response_schema TEXT NOT NULL,
      PRIMARY KEY (endpoint_id, response_schema)
    );

    CREATE TABLE db_tables (
      name TEXT PRIMARY KEY,
      feature_id TEXT,
      first_migration TEXT,
      last_migration TEXT
    );

    CREATE TABLE db_columns (
      table_name TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      nullable INTEGER NOT NULL,
      default_value TEXT,
      PRIMARY KEY (table_name, name)
    );

    CREATE TABLE db_indexes (
      table_name TEXT NOT NULL,
      index_name TEXT NOT NULL,
      PRIMARY KEY (table_name, index_name)
    );

    CREATE TABLE db_foreign_keys (
      table_name TEXT NOT NULL,
      foreign_key TEXT NOT NULL,
      PRIMARY KEY (table_name, foreign_key)
    );

    CREATE TABLE facts (
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      summary TEXT NOT NULL,
      PRIMARY KEY (kind, path)
    );

    CREATE TABLE coverage_gaps (
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      PRIMARY KEY (kind, subject)
    );

    CREATE TABLE verification_gates (
      gate_id TEXT PRIMARY KEY
    );

    CREATE TABLE verification_gate_scripts (
      gate_id TEXT NOT NULL,
      script_name TEXT NOT NULL,
      PRIMARY KEY (gate_id, script_name)
    );

    CREATE TABLE verification_gate_features (
      gate_id TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      PRIMARY KEY (gate_id, feature_id)
    );

    CREATE TABLE verification_gate_side_effects (
      gate_id TEXT NOT NULL,
      side_effect TEXT NOT NULL,
      PRIMARY KEY (gate_id, side_effect)
    );

    CREATE TABLE verification_gate_commands (
      gate_id TEXT NOT NULL,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      args_json TEXT NOT NULL,
      cwd TEXT,
      tier TEXT,
      source TEXT,
      reason TEXT,
      PRIMARY KEY (gate_id, name, command, args_json)
    );

    CREATE TABLE source_conflicts (
      subject TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      resolution TEXT NOT NULL,
      message TEXT NOT NULL,
      conflict_json TEXT NOT NULL
    );

    CREATE INDEX idx_api_feature ON api_endpoints(feature_id);
    CREATE INDEX idx_api_path ON api_endpoints(path_template);
    CREATE INDEX idx_tables_feature ON db_tables(feature_id);
    CREATE INDEX idx_gaps_kind ON coverage_gaps(kind);
  `);
}

function writeMetadata(db: DatabaseSync, index: DomainIndex): void {
  const insert = db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)");
  const values: Record<string, string> = {
    schemaVersion: DOMAIN_SQLITE_SCHEMA_VERSION,
    domainSchemaVersion: index.schemaVersion,
    repoRoot: index.repoRoot,
    generatedAt: index.generatedAt,
    fingerprint: index.fingerprint,
    manifestPath: index.manifestPath,
    manifestPresent: String(index.manifestPresent),
    warnings: JSON.stringify(index.warnings),
    summary: JSON.stringify(summarizeDomainIndex(index)),
    indexJson: JSON.stringify(index),
  };
  for (const [key, value] of Object.entries(values)) {
    insert.run(key, value);
  }
}

function writeFiles(db: DatabaseSync, index: DomainIndex): void {
  const insert = db.prepare("INSERT INTO files(path, role, hash) VALUES (?, ?, ?)");
  for (const file of index.files) {
    insert.run(file.path, file.role, file.hash);
  }
}

function writeFeatures(db: DatabaseSync, index: DomainIndex): void {
  const insertFeature = db.prepare("INSERT INTO features(feature_id, display_name) VALUES (?, ?)");
  const insertAlias = db.prepare("INSERT INTO feature_aliases(feature_id, alias) VALUES (?, ?)");
  const insertRoot = db.prepare("INSERT INTO feature_roots(feature_id, root) VALUES (?, ?)");
  const insertPortal = db.prepare("INSERT INTO feature_portals(feature_id, portal) VALUES (?, ?)");
  const insertTable = db.prepare("INSERT INTO feature_tables(feature_id, table_name) VALUES (?, ?)");
  const insertFile = db.prepare("INSERT INTO feature_files(feature_id, role, path) VALUES (?, ?, ?)");
  for (const feature of index.features) {
    insertFeature.run(feature.featureId, feature.displayName);
    for (const alias of feature.aliases) insertAlias.run(feature.featureId, alias);
    for (const root of feature.roots) insertRoot.run(feature.featureId, root);
    for (const portal of feature.portals) insertPortal.run(feature.featureId, portal);
    for (const table of feature.tables) insertTable.run(feature.featureId, table);
    for (const route of feature.routes) insertFile.run(feature.featureId, "route", route);
    for (const hook of feature.hooks) insertFile.run(feature.featureId, "hook", hook);
    for (const service of feature.services) insertFile.run(feature.featureId, "service", service);
  }
}

function writeApiEndpoints(db: DatabaseSync, index: DomainIndex): void {
  const insertEndpoint = db.prepare(`
    INSERT INTO api_endpoints(id, feature_id, method, origin, path_template, operation_id, source, request_content_type, response_content_type, auth_required, source_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertQueryKey = db.prepare("INSERT INTO api_endpoint_query_keys(endpoint_id, query_key) VALUES (?, ?)");
  const insertResponseSchema = db.prepare("INSERT INTO api_endpoint_response_schemas(endpoint_id, response_schema) VALUES (?, ?)");
  index.apiEndpoints.forEach((endpoint, offset) => {
    const endpointId = offset + 1;
    insertEndpoint.run(
      endpointId,
      endpoint.featureId ?? null,
      endpoint.method,
      endpoint.origin,
      endpoint.pathTemplate,
      endpoint.operationId ?? null,
      endpoint.source,
      endpoint.requestContentType ?? null,
      endpoint.responseContentType ?? null,
      endpoint.authRequired ? 1 : 0,
      endpoint.sourcePath,
    );
    for (const queryKey of endpoint.queryKeys) insertQueryKey.run(endpointId, queryKey);
    for (const responseSchema of endpoint.responseSchemas) insertResponseSchema.run(endpointId, responseSchema);
  });
}

function writeTables(db: DatabaseSync, index: DomainIndex): void {
  const insertTable = db.prepare("INSERT INTO db_tables(name, feature_id, first_migration, last_migration) VALUES (?, ?, ?, ?)");
  const insertColumn = db.prepare("INSERT INTO db_columns(table_name, name, type, nullable, default_value) VALUES (?, ?, ?, ?, ?)");
  const insertIndex = db.prepare("INSERT INTO db_indexes(table_name, index_name) VALUES (?, ?)");
  const insertForeignKey = db.prepare("INSERT INTO db_foreign_keys(table_name, foreign_key) VALUES (?, ?)");
  for (const table of index.tables) {
    insertTable.run(table.name, table.featureId ?? null, table.firstMigration ?? null, table.lastMigration ?? null);
    for (const column of table.columns) {
      insertColumn.run(table.name, column.name, column.type, column.nullable ? 1 : 0, column.defaultValue ?? null);
    }
    for (const indexName of table.indexes) insertIndex.run(table.name, indexName);
    for (const foreignKey of table.foreignKeys) insertForeignKey.run(table.name, foreignKey);
  }
}

function writeFacts(db: DatabaseSync, index: DomainIndex): void {
  const insert = db.prepare("INSERT INTO facts(kind, path, summary) VALUES (?, ?, ?)");
  for (const fact of index.migrations) insert.run("migration", fact.path, fact.summary);
  for (const fact of index.conventions) insert.run("convention", fact.path, fact.summary);
  for (const fact of index.memory) insert.run("memory", fact.path, fact.summary);
}

function writeCoverageGaps(db: DatabaseSync, index: DomainIndex): void {
  const insert = db.prepare("INSERT INTO coverage_gaps(kind, severity, subject, message) VALUES (?, ?, ?, ?)");
  for (const gap of index.coverage.gaps) {
    insert.run(gap.kind, gap.severity, gap.subject, gap.message);
  }
}

function writeVerificationGates(db: DatabaseSync, index: DomainIndex): void {
  const insertGate = db.prepare("INSERT INTO verification_gates(gate_id) VALUES (?)");
  const insertScript = db.prepare("INSERT INTO verification_gate_scripts(gate_id, script_name) VALUES (?, ?)");
  const insertFeature = db.prepare("INSERT INTO verification_gate_features(gate_id, feature_id) VALUES (?, ?)");
  const insertSideEffect = db.prepare("INSERT INTO verification_gate_side_effects(gate_id, side_effect) VALUES (?, ?)");
  const insertCommand = db.prepare(`
    INSERT INTO verification_gate_commands(gate_id, name, command, args_json, cwd, tier, source, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const gate of index.verificationGates) {
    insertGate.run(gate.gateId);
    for (const scriptName of gate.scriptNames) insertScript.run(gate.gateId, scriptName);
    for (const featureId of gate.matchedFeatureIds) insertFeature.run(gate.gateId, featureId);
    for (const sideEffect of gate.whenFeatureTouches) insertSideEffect.run(gate.gateId, sideEffect);
    for (const command of gate.commands) {
      insertCommand.run(
        gate.gateId,
        command.name,
        command.command,
        JSON.stringify(command.args ?? []),
        command.cwd ?? null,
        command.tier ?? null,
        command.source ?? null,
        command.reason ?? null,
      );
    }
  }
}

function writeSourceConflicts(db: DatabaseSync, index: DomainIndex): void {
  const insert = db.prepare("INSERT INTO source_conflicts(subject, severity, resolution, message, conflict_json) VALUES (?, ?, ?, ?, ?)");
  for (const conflict of index.sourceConflicts) {
    insert.run(conflict.subject, conflict.severity, conflict.resolution, conflict.message, JSON.stringify(conflict));
  }
}

function readStoredIndex(indexPath: string): DomainIndex | undefined {
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(indexPath);
  try {
    const metadata = readMetadata(db);
    if (metadata.schemaVersion !== DOMAIN_SQLITE_SCHEMA_VERSION || !metadata.indexJson) {
      return undefined;
    }
    return JSON.parse(metadata.indexJson) as DomainIndex;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

function readQueryContext(repoRootInput: string): {
  repoRoot: string;
  indexPath: string;
  index?: DomainIndex;
  fresh: boolean;
  indexHealth: IndexHealthSnapshot;
  warnings: string[];
} {
  const repoRoot = path.resolve(repoRootInput);
  const indexPath = domainIndexSqlitePath(repoRoot);
  const index = existsSync(indexPath) ? readStoredIndex(indexPath) : undefined;
  if (!index) {
    const indexHealth = createIndexHealthSnapshot({
      source: "domain_index",
      present: false,
      indexPath,
    });
    return {
      repoRoot,
      indexPath,
      fresh: false,
      indexHealth,
      warnings: domainIndexWarnings(indexHealth),
    };
  }
  const current = buildDomainIndex({ repoRoot });
  const fresh = index.fingerprint === current.fingerprint;
  const indexHealth = createDomainIndexHealth({
    indexPath,
    fresh,
    summary: summarizeDomainIndex(index),
    warnings: index.warnings,
  });
  return {
    repoRoot,
    indexPath,
    index,
    fresh,
    indexHealth,
    warnings: domainIndexWarnings(indexHealth),
  };
}

function readMetadata(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM metadata").all();
  const metadata: Record<string, string> = {};
  for (const row of rows) {
    metadata[String(row.key)] = String(row.value);
  }
  return metadata;
}

function baseResult(context: ReturnType<typeof readQueryContext>, refused?: boolean): DomainQueryBaseResult {
  return {
    repoRoot: context.repoRoot,
    indexPath: context.indexPath,
    fresh: context.fresh,
    indexHealth: context.indexHealth,
    warnings: context.warnings,
    ...(refused ? { refused: true } : {}),
  };
}

function shouldRefuse(context: ReturnType<typeof readQueryContext>, requireFresh?: boolean): boolean {
  return Boolean(requireFresh && (!context.index || !context.fresh));
}

function summarizeDomainIndex(index: DomainIndex): DomainIndexSummary {
  return {
    repoRoot: index.repoRoot,
    generatedAt: index.generatedAt,
    fingerprint: index.fingerprint,
    manifestPresent: index.manifestPresent,
    fileCount: index.files.length,
    featureCount: index.features.length,
    apiEndpointCount: index.apiEndpoints.length,
    tableCount: index.tables.length,
    coverageGapCount: index.coverage.gaps.length,
    warningCount: index.warnings.length,
  };
}

function createDomainIndexHealth(input: {
  indexPath: string;
  fresh: boolean;
  summary: DomainIndexSummary;
  warnings: string[];
}): IndexHealthSnapshot {
  return createIndexHealthSnapshot({
    source: "domain_index",
    present: true,
    fresh: input.fresh,
    builtAt: input.summary.generatedAt,
    fingerprint: input.summary.fingerprint,
    indexPath: input.indexPath,
    fileCount: input.summary.fileCount,
    reasons: input.warnings,
  });
}

function domainIndexWarnings(health: IndexHealthSnapshot): string[] {
  if (health.status === "stale") {
    return ["Domain index is stale; refresh before relying on domain-specific repo guidance."];
  }
  if (health.status === "missing") {
    return ["Domain index is missing; refresh before relying on domain-specific repo guidance."];
  }
  if (health.status === "unknown") {
    return ["Domain index freshness is unknown."];
  }
  return [];
}

function findFeature(index: DomainIndex, query: string): DomainIndexFeature | undefined {
  const normalized = normalizeId(query);
  return index.features.find((feature) => feature.featureId === normalized || feature.aliases.includes(normalized));
}

function featureFiles(index: DomainIndex, feature: DomainIndexFeature): DomainIndex["files"] {
  const owned = new Set([...feature.routes, ...feature.hooks, ...feature.services]);
  return index.files.filter((file) => owned.has(file.path));
}

function normalizeId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/_+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function loadSqlite(): SqliteModule {
  try {
    return require("node:sqlite") as SqliteModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SQLite domain indexes require Node's built-in node:sqlite module: ${message}`);
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
