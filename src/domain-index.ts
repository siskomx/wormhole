import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createFeatureIndex, type FeatureSideEffect, type RepoFeature } from "./feature-index.js";
import { importOpenApi } from "./openapi-import.js";
import { detectProjectContract, type ProjectPackageManager, type ProjectScript } from "./project-contract.js";
import { buildRepoIndex, type RepoIndexFile } from "./repo-index.js";
import { extractRouteEndpoints } from "./route-extraction.js";
import type { SourceConflict } from "./source-authority.js";
import { analyzeSourceConflicts } from "./source-conflicts.js";
import { analyzeTestImpactV2 } from "./test-impact-v2.js";
import { createVerificationPlan, type VerificationCommand } from "./verification-runner.js";
import {
  readDomainIndexManifest,
  type DomainIndexManifest,
  type DomainIndexVerificationGateConfig,
} from "./domain-index-manifest.js";

export type DomainIndexInput = { repoRoot: string; generatedAt?: string };

export type DomainIndexFileRef = {
  path: string;
  role: "route" | "hook" | "service" | "migration" | "openapi" | "convention" | "memory";
  hash: string;
};

export type DomainIndexFeature = {
  featureId: string;
  displayName: string;
  aliases: string[];
  roots: string[];
  portals: string[];
  routes: string[];
  hooks: string[];
  services: string[];
  tables: string[];
};

export type DomainApiEndpoint = {
  featureId?: string;
  method: string;
  origin: string;
  pathTemplate: string;
  operationId?: string;
  source: "openapi" | "route-scan";
  queryKeys: string[];
  requestContentType?: string;
  responseContentType?: string;
  responseSchemas: string[];
  authRequired: boolean;
  sourcePath: string;
};

export type DomainColumn = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
};

export type DomainTable = {
  name: string;
  featureId?: string;
  columns: DomainColumn[];
  indexes: string[];
  foreignKeys: string[];
  firstMigration?: string;
  lastMigration?: string;
};

export type DomainFactRef = {
  path: string;
  summary: string;
};

export type DomainCoverageGap = {
  kind:
    | "manifest-missing"
    | "feature-without-manifest"
    | "feature-without-api"
    | "route-without-openapi"
    | "api-without-feature"
    | "table-without-owner"
    | "feature-table-without-migration"
    | "openapi-path-missing"
    | "migration-path-missing"
    | "convention-path-missing"
    | "memory-path-missing"
    | "source-conflict";
  severity: "warning" | "blocker";
  subject: string;
  message: string;
};

export type DomainDriftReport = {
  fresh: boolean;
  storedFingerprint?: string;
  currentFingerprint: string;
  addedFiles: string[];
  removedFiles: string[];
  changedFiles: string[];
  coverageGaps: DomainCoverageGap[];
  warnings: string[];
};

export type DomainVerificationGatePlan = {
  gateId: string;
  scriptNames: string[];
  matchedFeatureIds: string[];
  commands: VerificationCommand[];
  whenFeatureTouches: FeatureSideEffect[];
};

export type DomainIndex = {
  schemaVersion: "domain-index.v0";
  repoRoot: string;
  generatedAt: string;
  fingerprint: string;
  manifestPath: string;
  manifestPresent: boolean;
  warnings: string[];
  files: DomainIndexFileRef[];
  features: DomainIndexFeature[];
  apiEndpoints: DomainApiEndpoint[];
  tables: DomainTable[];
  migrations: DomainFactRef[];
  conventions: DomainFactRef[];
  memory: DomainFactRef[];
  verificationGates: DomainVerificationGatePlan[];
  sourceConflicts: SourceConflict[];
  coverage: { gaps: DomainCoverageGap[] };
};

type FeatureSideEffectMap = Map<string, Set<FeatureSideEffect>>;

export function buildDomainIndex(input: DomainIndexInput): DomainIndex {
  const repoRoot = path.resolve(input.repoRoot);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const manifestResult = readDomainIndexManifest({ repoRoot });
  const repoIndex = buildRepoIndex({ repoRoot, preset: "large_repo" });
  const featureIndex = createFeatureIndex({ repoRoot, generatedAt });
  const contract = detectProjectContract({ repoRoot });
  const sourceConflicts = analyzeSourceConflicts({ repoRoot, index: repoIndex, contract }).conflicts;
  const impact = analyzeTestImpactV2({ repoRoot, changedFiles: [], index: repoIndex });
  const verificationPlan = createVerificationPlan({
    contract,
    impact: { ...impact, likelyTests: impact.likelyTests.map((test) => test.path) },
    changedFiles: [],
  });

  const manifest = manifestResult.manifest;
  const files = manifest ? collectDomainFiles(repoRoot, repoIndex.files, manifest) : [];
  const features = manifest ? buildFeatures(manifest, files) : [];
  const sideEffects = detectFeatureSideEffects(repoRoot, features);
  const tables = manifest ? foldSqlMigrations(repoRoot, files, manifest) : [];
  const apiEndpoints = manifest ? collectApiEndpoints(repoRoot, files, features) : [];
  const conventions = files.filter((file) => file.role === "convention").map((file) => summarizeFact(repoRoot, file.path));
  const memory = files.filter((file) => file.role === "memory").map((file) => summarizeFact(repoRoot, file.path));
  const migrations = files.filter((file) => file.role === "migration").map((file) => summarizeFact(repoRoot, file.path));
  const verificationGates = createDomainVerificationGatePlans({
    manifest,
    features,
    sideEffects,
    packageManager: contract.packageManager,
    repoRoot,
    scripts: contract.scripts,
    verificationCommands: verificationPlan.commands,
  });
  const coverageGaps = createCoverageGaps({
    manifest,
    features,
    genericFeatures: featureIndex.features,
    apiEndpoints,
    tables,
    files,
    sourceConflicts,
  });

  const baseIndex: Omit<DomainIndex, "fingerprint"> = {
    schemaVersion: "domain-index.v0",
    repoRoot,
    generatedAt,
    manifestPath: manifestResult.manifestPath,
    manifestPresent: Boolean(manifest),
    warnings: manifestResult.warnings,
    files,
    features,
    apiEndpoints,
    tables,
    migrations,
    conventions,
    memory,
    verificationGates,
    sourceConflicts,
    coverage: { gaps: coverageGaps },
  };

  return {
    ...baseIndex,
    fingerprint: createHash("sha256").update(JSON.stringify({
      repoIndexFingerprint: repoIndex.fingerprint,
      repoIndexTruncated: repoIndex.truncated,
      repoIndexSkippedFiles: repoIndex.skippedFiles,
      contractScripts: contract.scripts,
      files,
      features,
      apiEndpoints,
      tables,
      conventions,
      memory,
      migrations,
      verificationGates,
      sourceConflicts,
      warnings: manifestResult.warnings,
    })).digest("hex"),
  };
}

export function compareDomainIndexes(stored: DomainIndex, current: DomainIndex): DomainDriftReport {
  const storedFiles = new Map(stored.files.map((file) => [`${file.role}:${file.path}`, file]));
  const currentFiles = new Map(current.files.map((file) => [`${file.role}:${file.path}`, file]));
  const addedFiles = uniqueSorted(
    [...currentFiles.entries()].filter(([key]) => !storedFiles.has(key)).map(([, file]) => file.path),
  );
  const removedFiles = uniqueSorted(
    [...storedFiles.entries()].filter(([key]) => !currentFiles.has(key)).map(([, file]) => file.path),
  );
  const changedFiles = uniqueSorted(
    [...currentFiles.entries()]
      .filter(([key, file]) => {
        const storedFile = storedFiles.get(key);
        return storedFile !== undefined && storedFile.hash !== file.hash;
      })
      .map(([, file]) => file.path),
  );
  return {
    fresh: stored.fingerprint === current.fingerprint,
    storedFingerprint: stored.fingerprint,
    currentFingerprint: current.fingerprint,
    addedFiles,
    removedFiles,
    changedFiles,
    coverageGaps: current.coverage.gaps,
    warnings: uniqueSorted([...stored.warnings, ...current.warnings]),
  };
}

function collectDomainFiles(repoRoot: string, files: RepoIndexFile[], manifest: DomainIndexManifest): DomainIndexFileRef[] {
  const refs: DomainIndexFileRef[] = [];
  for (const file of files) {
    if (matchesAny(file.path, manifest.fileGroups.routes)) refs.push({ path: file.path, role: "route", hash: file.hash });
    if (matchesAny(file.path, manifest.fileGroups.hooks)) refs.push({ path: file.path, role: "hook", hash: file.hash });
    if (matchesAny(file.path, manifest.fileGroups.services)) refs.push({ path: file.path, role: "service", hash: file.hash });
    if (matchesAny(file.path, manifest.fileGroups.migrations)) refs.push({ path: file.path, role: "migration", hash: file.hash });
    if (matchesAny(file.path, manifest.fileGroups.openapi)) refs.push({ path: file.path, role: "openapi", hash: file.hash });
    if (matchesAny(file.path, manifest.fileGroups.conventions)) refs.push({ path: file.path, role: "convention", hash: file.hash });
    if (matchesAny(file.path, manifest.fileGroups.memory)) refs.push({ path: file.path, role: "memory", hash: file.hash });
  }
  refs.push(...collectManifestDeclaredFiles(repoRoot, manifest));
  return uniqueFileRefs(refs);
}

function collectManifestDeclaredFiles(repoRoot: string, manifest: DomainIndexManifest): DomainIndexFileRef[] {
  return [
    ...collectFilesForRole(repoRoot, manifest.fileGroups.routes, "route"),
    ...collectFilesForRole(repoRoot, manifest.fileGroups.hooks, "hook"),
    ...collectFilesForRole(repoRoot, manifest.fileGroups.services, "service"),
    ...collectFilesForRole(repoRoot, manifest.fileGroups.migrations, "migration"),
    ...collectFilesForRole(repoRoot, manifest.fileGroups.openapi, "openapi"),
    ...collectFilesForRole(repoRoot, manifest.fileGroups.conventions, "convention"),
    ...collectFilesForRole(repoRoot, manifest.fileGroups.memory, "memory"),
  ];
}

function collectFilesForRole(repoRoot: string, patterns: string[], role: DomainIndexFileRef["role"]): DomainIndexFileRef[] {
  const refs: DomainIndexFileRef[] = [];
  for (const pattern of patterns) {
    for (const repoPath of expandManifestPattern(repoRoot, pattern)) {
      const content = safeRead(path.join(repoRoot, repoPath));
      refs.push({ path: repoPath, role, hash: createHash("sha256").update(content).digest("hex") });
    }
  }
  return refs;
}

function expandManifestPattern(repoRoot: string, pattern: string): string[] {
  const normalizedPattern = toRepoPath(pattern);
  if (!/[*?[\]]/.test(normalizedPattern)) {
    return existsSync(path.join(repoRoot, normalizedPattern)) ? [normalizedPattern] : [];
  }
  const base = staticPatternPrefix(normalizedPattern);
  const basePath = path.join(repoRoot, base);
  if (!existsSync(basePath)) {
    return [];
  }
  const candidates: string[] = [];
  const queue = [basePath];
  while (queue.length > 0) {
    const directory = queue.shift();
    if (!directory) {
      break;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const repoPath = toRepoPath(path.relative(repoRoot, absolutePath));
      if (entry.isDirectory()) {
        queue.push(absolutePath);
      } else if (entry.isFile() && matchesPattern(repoPath, normalizedPattern)) {
        candidates.push(repoPath);
      }
    }
  }
  return candidates.sort((left, right) => left.localeCompare(right));
}

function staticPatternPrefix(pattern: string): string {
  const segments = pattern.split("/");
  const staticSegments: string[] = [];
  for (const segment of segments) {
    if (/[*?[\]]/.test(segment)) {
      break;
    }
    staticSegments.push(segment);
  }
  return staticSegments.join("/") || ".";
}

function buildFeatures(manifest: DomainIndexManifest, files: DomainIndexFileRef[]): DomainIndexFeature[] {
  return manifest.features.map((feature) => {
    const owned = files.filter((file) => feature.roots.some((root) => file.path === root || file.path.startsWith(`${root}/`)));
    return {
      featureId: feature.featureId,
      displayName: feature.displayName,
      aliases: [...feature.aliases],
      roots: [...feature.roots],
      portals: [...feature.portals],
      routes: owned.filter((file) => file.role === "route").map((file) => file.path).sort(),
      hooks: owned.filter((file) => file.role === "hook").map((file) => file.path).sort(),
      services: owned.filter((file) => file.role === "service").map((file) => file.path).sort(),
      tables: [...feature.tables],
    };
  });
}

function collectApiEndpoints(repoRoot: string, files: DomainIndexFileRef[], features: DomainIndexFeature[]): DomainApiEndpoint[] {
  const openApiEndpoints = files.filter((file) => file.role === "openapi").flatMap((file) => {
    const specText = readFileSync(path.join(repoRoot, file.path), "utf8");
    const imported = importOpenApi({ specText, sourceName: file.path });
    const parsed = parseJsonObject(specText);
    return imported.observations.map((observation) => ({
      featureId: featureForEndpoint(observation.pathTemplate, features),
      method: observation.method,
      origin: observation.origin,
      pathTemplate: observation.pathTemplate,
      operationId: observation.operationId,
      source: "openapi" as const,
      queryKeys: observation.queryKeys,
      requestContentType: observation.requestContentType,
      responseContentType: observation.responseContentType,
      responseSchemas: parsed ? responseSchemasFor(parsed, observation.pathTemplate, observation.method) : [],
      authRequired: parsed ? authRequiredFor(parsed, observation.pathTemplate, observation.method) : false,
      sourcePath: file.path,
    }));
  });
  const routeFallbacks = scanRouteEndpoints(repoRoot, files, features, openApiEndpoints);
  return [...openApiEndpoints, ...routeFallbacks].sort((left, right) =>
    left.pathTemplate.localeCompare(right.pathTemplate) || left.method.localeCompare(right.method),
  );
}

function scanRouteEndpoints(
  repoRoot: string,
  files: DomainIndexFileRef[],
  features: DomainIndexFeature[],
  existing: DomainApiEndpoint[],
): DomainApiEndpoint[] {
  const existingKeys = new Set(existing.map((endpoint) => `${endpoint.method} ${endpoint.pathTemplate}`));
  const endpoints: DomainApiEndpoint[] = [];
  const routeFiles = files.filter((item) => item.role === "route").map((file) => file.path);
  for (const route of extractRouteEndpoints({ repoRoot, files: routeFiles })) {
    const key = `${route.method} ${route.pathTemplate}`;
    if (existingKeys.has(key)) {
      continue;
    }
    existingKeys.add(key);
    endpoints.push({
      featureId: featureForPath(route.sourcePath, features) ?? featureForEndpoint(route.pathTemplate, features),
      method: route.method,
      origin: "http://localhost",
      pathTemplate: route.pathTemplate,
      source: "route-scan",
      queryKeys: [],
      responseSchemas: [],
      authRequired: route.authRequired,
      sourcePath: route.sourcePath,
    });
  }
  return endpoints;
}

function foldSqlMigrations(repoRoot: string, files: DomainIndexFileRef[], manifest: DomainIndexManifest): DomainTable[] {
  const byTable = new Map<string, DomainTable>();
  const migrationPaths = files.filter((file) => file.role === "migration").map((file) => file.path).sort();
  for (const migrationPath of migrationPaths) {
    const sql = stripSqlComments(safeRead(path.join(repoRoot, migrationPath)));
    for (const statement of sql.split(";").map((item) => item.trim()).filter(Boolean)) {
      applySqlStatement(byTable, statement, migrationPath);
    }
  }
  const ownerByTable = new Map(manifest.features.flatMap((feature) => feature.tables.map((table) => [table, feature.featureId] as const)));
  return [...byTable.values()].map((table) => ({
    ...table,
    featureId: ownerByTable.get(table.name),
    columns: table.columns.sort((left, right) => left.name.localeCompare(right.name)),
    indexes: uniqueSorted(table.indexes),
    foreignKeys: uniqueSorted(table.foreignKeys),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function applySqlStatement(byTable: Map<string, DomainTable>, statement: string, migrationPath: string): void {
  const createTable = statement.match(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:"?[\w]+"?)\.)?["`]?([a-zA-Z0-9_]+)["`]?\s*\(([\s\S]+)\)$/i);
  if (createTable?.[1] && createTable[2]) {
    const table = ensureTable(byTable, createTable[1].toLowerCase(), migrationPath);
    for (const columnSql of splitSqlList(createTable[2])) {
      const column = parseColumn(columnSql);
      if (column) {
        setColumn(table, column);
      }
      const foreignKey = parseForeignKey(columnSql);
      if (foreignKey) {
        table.foreignKeys.push(foreignKey);
      }
    }
    table.lastMigration = migrationPath;
    return;
  }

  const alterAdd = statement.match(/\balter\s+table\s+["`]?([a-zA-Z0-9_]+)["`]?\s+add\s+column\s+([\s\S]+)$/i);
  if (alterAdd?.[1] && alterAdd[2]) {
    const table = ensureTable(byTable, alterAdd[1].toLowerCase(), migrationPath);
    const column = parseColumn(alterAdd[2]);
    if (column) {
      setColumn(table, column);
    }
    table.lastMigration = migrationPath;
    return;
  }

  const alterDrop = statement.match(/\balter\s+table\s+["`]?([a-zA-Z0-9_]+)["`]?\s+drop\s+column\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (alterDrop?.[1] && alterDrop[2]) {
    const table = ensureTable(byTable, alterDrop[1].toLowerCase(), migrationPath);
    table.columns = table.columns.filter((column) => column.name !== alterDrop[2]?.toLowerCase());
    table.lastMigration = migrationPath;
    return;
  }

  const createIndex = statement.match(/\bcreate\s+(?:unique\s+)?index\s+["`]?([a-zA-Z0-9_]+)["`]?\s+on\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (createIndex?.[1] && createIndex[2]) {
    const table = ensureTable(byTable, createIndex[2].toLowerCase(), migrationPath);
    table.indexes.push(createIndex[1]);
    table.lastMigration = migrationPath;
  }
}

function ensureTable(byTable: Map<string, DomainTable>, name: string, migrationPath: string): DomainTable {
  const existing = byTable.get(name);
  if (existing) {
    return existing;
  }
  const table: DomainTable = {
    name,
    columns: [],
    indexes: [],
    foreignKeys: [],
    firstMigration: migrationPath,
    lastMigration: migrationPath,
  };
  byTable.set(name, table);
  return table;
}

function parseColumn(sql: string): DomainColumn | undefined {
  const trimmed = sql.trim();
  if (/^(constraint|primary\s+key|foreign\s+key|unique|check)\b/i.test(trimmed)) {
    return undefined;
  }
  const match = trimmed.match(/^["`]?([a-zA-Z0-9_]+)["`]?\s+([a-zA-Z0-9_(),]+)/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const defaultMatch = trimmed.match(/\bdefault\s+(.+?)(?:\s+(?:not|null|primary|references|constraint)|$)/i);
  return {
    name: match[1].toLowerCase(),
    type: match[2].toLowerCase(),
    nullable: !/\bnot\s+null\b/i.test(trimmed) && !/\bprimary\s+key\b/i.test(trimmed),
    ...(defaultMatch?.[1] ? { defaultValue: defaultMatch[1].trim() } : {}),
  };
}

function setColumn(table: DomainTable, column: DomainColumn): void {
  const index = table.columns.findIndex((existing) => existing.name === column.name);
  if (index >= 0) {
    table.columns[index] = column;
  } else {
    table.columns.push(column);
  }
}

function parseForeignKey(sql: string): string | undefined {
  const inline = sql.match(/\breferences\s+["`]?([a-zA-Z0-9_]+)["`]?\s*\(([^)]+)\)/i);
  if (inline?.[1]) {
    return inline[0].trim();
  }
  const tableLevel = sql.match(/\bforeign\s+key\s*\(([^)]+)\)\s+references\s+["`]?([a-zA-Z0-9_]+)["`]?\s*\(([^)]+)\)/i);
  return tableLevel?.[0]?.trim();
}

function createDomainVerificationGatePlans(input: {
  manifest?: DomainIndexManifest;
  features: DomainIndexFeature[];
  sideEffects: FeatureSideEffectMap;
  packageManager: ProjectPackageManager;
  repoRoot: string;
  scripts: ProjectScript[];
  verificationCommands: VerificationCommand[];
}): DomainVerificationGatePlan[] {
  return (input.manifest?.verificationGates ?? []).map((gate) => {
    const matchedFeatureIds = input.features
      .filter((feature) => gate.whenFeatureTouches.some((sideEffect) => input.sideEffects.get(feature.featureId)?.has(sideEffect)))
      .map((feature) => feature.featureId)
      .sort();
    return {
      gateId: gate.gateId,
      scriptNames: [...gate.scriptNames],
      matchedFeatureIds,
      commands: gate.scriptNames.flatMap((scriptName) =>
        input.verificationCommands.find((command) => command.name === scriptName) ??
        commandFromScript({
          packageManager: input.packageManager,
          script: input.scripts.find((script) => script.name === scriptName),
          repoRoot: input.repoRoot,
        }) ?? [],
      ),
      whenFeatureTouches: [...gate.whenFeatureTouches],
    };
  }).sort((left, right) => left.gateId.localeCompare(right.gateId));
}

function commandFromScript(input: {
  packageManager: ProjectPackageManager;
  script?: ProjectScript;
  repoRoot: string;
}): VerificationCommand | undefined {
  if (!input.script) {
    return undefined;
  }
  const metadata = {
    name: input.script.name,
    cwd: input.repoRoot,
    tier: "focused" as const,
    source: "contract" as const,
    reason: `Run domain verification gate script ${input.script.name}.`,
  };
  switch (input.packageManager) {
    case "pnpm":
      return { ...metadata, command: "pnpm", args: ["run", input.script.name] };
    case "yarn":
      return { ...metadata, command: "yarn", args: [input.script.name] };
    case "bun":
      return { ...metadata, command: "bun", args: ["run", input.script.name] };
    case "npm":
    case "cargo":
    case "dotnet":
    case "unknown":
      return { ...metadata, command: "npm", args: ["run", input.script.name] };
  }
}

function detectFeatureSideEffects(repoRoot: string, features: DomainIndexFeature[]): FeatureSideEffectMap {
  const byFeature: FeatureSideEffectMap = new Map();
  for (const feature of features) {
    const effects = new Set<FeatureSideEffect>();
    for (const repoPath of [...feature.routes, ...feature.services, ...feature.hooks]) {
      const content = safeRead(path.join(repoRoot, repoPath)).toLowerCase();
      if (/authenticate|authorization|permission|prehandler|security|tenant|organization_id/.test(content)) {
        effects.add("authz");
      }
      if (/\b(post|put|patch|delete)\s*\(/.test(content)) {
        effects.add("http_mutation");
      }
      if (/socket|websocket|emit|broadcast|realtime/.test(content)) {
        effects.add("realtime");
      }
    }
    for (const table of feature.tables) {
      if (table) {
        effects.add("database_schema");
      }
    }
    byFeature.set(feature.featureId, effects);
  }
  return byFeature;
}

function createCoverageGaps(input: {
  manifest?: DomainIndexManifest;
  features: DomainIndexFeature[];
  genericFeatures: RepoFeature[];
  apiEndpoints: DomainApiEndpoint[];
  tables: DomainTable[];
  files: DomainIndexFileRef[];
  sourceConflicts: SourceConflict[];
}): DomainCoverageGap[] {
  const gaps: DomainCoverageGap[] = [];
  if (!input.manifest) {
    gaps.push({
      kind: "manifest-missing",
      severity: "warning",
      subject: "domain-index-manifest",
      message: ".wormhole/domain-index.json is missing; domain-specific indexing is unavailable.",
    });
    return gaps;
  }

  for (const feature of input.genericFeatures) {
    if (!genericFeatureDeclaredByManifest(feature, input.features)) {
      gaps.push({
        kind: "feature-without-manifest",
        severity: "warning",
        subject: `feature:${feature.featureId}`,
        message: `${feature.featureId} appears in the generic feature index but is not declared in .wormhole/domain-index.json.`,
      });
    }
  }

  for (const feature of input.features) {
    const featureEndpoints = input.apiEndpoints.filter((endpoint) => endpoint.featureId === feature.featureId);
    if (feature.routes.length > 0 && featureEndpoints.length === 0) {
      gaps.push({
        kind: "feature-without-api",
        severity: "warning",
        subject: `feature:${feature.featureId}`,
        message: `${feature.featureId} has route files but no indexed API endpoints.`,
      });
    }
    for (const endpoint of featureEndpoints.filter((endpoint) => endpoint.source === "route-scan")) {
      gaps.push({
        kind: "route-without-openapi",
        severity: "warning",
        subject: `api:${endpoint.method} ${endpoint.pathTemplate}`,
        message: `${endpoint.method} ${endpoint.pathTemplate} was inferred from a route file but is not documented by OpenAPI.`,
      });
    }
  }

  for (const endpoint of input.apiEndpoints.filter((endpoint) => !endpoint.featureId)) {
    gaps.push({
      kind: "api-without-feature",
      severity: "warning",
      subject: `api:${endpoint.method} ${endpoint.pathTemplate}`,
      message: `${endpoint.method} ${endpoint.pathTemplate} is indexed but not owned by a domain feature.`,
    });
  }

  const migrationFiles = input.files.filter((file) => file.role === "migration");
  for (const table of input.tables) {
    if (!table.featureId) {
      gaps.push({
        kind: "table-without-owner",
        severity: "warning",
        subject: `table:${table.name}`,
        message: `${table.name} is folded from migrations but not owned by a manifest feature.`,
      });
    }
    if (!table.firstMigration) {
      gaps.push({
        kind: "feature-table-without-migration",
        severity: "warning",
        subject: `table:${table.name}`,
        message: `${table.name} is declared by a feature but has no migration provenance.`,
      });
    }
  }

  for (const repoPath of input.manifest.fileGroups.openapi) {
    if (!globHasMatch(repoPath, input.files.filter((file) => file.role === "openapi"))) {
      gaps.push({
        kind: "openapi-path-missing",
        severity: "warning",
        subject: `openapi:${repoPath}`,
        message: `${repoPath} did not match any indexed OpenAPI file.`,
      });
    }
  }
  for (const repoPath of input.manifest.fileGroups.migrations) {
    if (migrationFiles.length === 0 || !globHasMatch(repoPath, migrationFiles)) {
      gaps.push({
        kind: "migration-path-missing",
        severity: "warning",
        subject: `migration:${repoPath}`,
        message: `${repoPath} did not match any indexed migration file.`,
      });
    }
  }
  for (const repoPath of input.manifest.fileGroups.conventions) {
    if (!globHasMatch(repoPath, input.files.filter((file) => file.role === "convention"))) {
      gaps.push({
        kind: "convention-path-missing",
        severity: "warning",
        subject: `convention:${repoPath}`,
        message: `${repoPath} did not match any indexed convention file.`,
      });
    }
  }
  for (const repoPath of input.manifest.fileGroups.memory) {
    if (!globHasMatch(repoPath, input.files.filter((file) => file.role === "memory"))) {
      gaps.push({
        kind: "memory-path-missing",
        severity: "warning",
        subject: `memory:${repoPath}`,
        message: `${repoPath} did not match any indexed memory file.`,
      });
    }
  }

  for (const conflict of input.sourceConflicts) {
    gaps.push({
      kind: "source-conflict",
      severity: conflict.severity === "blocking" ? "blocker" : "warning",
      subject: conflict.subject,
      message: conflict.message,
    });
  }

  return uniqueCoverageGaps(gaps);
}

function genericFeatureDeclaredByManifest(generic: RepoFeature, features: DomainIndexFeature[]): boolean {
  return features.some((feature) => {
    const declaredIds = [feature.featureId, ...feature.aliases].flatMap(tokenVariants);
    if (declaredIds.includes(generic.featureId)) {
      return true;
    }
    return generic.roots.some((root) =>
      feature.roots.some((featureRoot) =>
        root === featureRoot || root.startsWith(`${featureRoot}/`) || featureRoot.startsWith(`${root}/`),
      ),
    );
  });
}

function globHasMatch(pattern: string, files: DomainIndexFileRef[]): boolean {
  return files.some((file) => matchesPattern(file.path, pattern));
}

function featureForEndpoint(pathTemplate: string, features: DomainIndexFeature[]): string | undefined {
  const normalized = pathTemplate.toLowerCase();
  return features.find((feature) =>
    [feature.featureId, ...feature.aliases]
      .flatMap((value) => tokenVariants(value))
      .some((token) => normalized.includes(token.replace(/-/g, "_")) || normalized.includes(token)),
  )?.featureId;
}

function featureForPath(repoPath: string, features: DomainIndexFeature[]): string | undefined {
  return features.find((feature) => feature.roots.some((root) => repoPath === root || repoPath.startsWith(`${root}/`)))?.featureId;
}

function responseSchemasFor(spec: Record<string, unknown>, pathTemplate: string, method: string): string[] {
  const operation = operationFor(spec, pathTemplate, method);
  return uniqueSorted(findRefs(operation).map((ref) => ref.split("/").pop() ?? ref).filter(Boolean));
}

function authRequiredFor(spec: Record<string, unknown>, pathTemplate: string, method: string): boolean {
  const operation = operationFor(spec, pathTemplate, method);
  if (!isRecord(operation)) {
    return false;
  }
  if (operation["x-auth-required"] === true) {
    return true;
  }
  return Array.isArray(operation.security) && operation.security.length > 0;
}

function operationFor(spec: Record<string, unknown>, pathTemplate: string, method: string): unknown {
  const paths = isRecord(spec.paths) ? spec.paths : {};
  const pathItem = isRecord(paths[pathTemplate]) ? paths[pathTemplate] : {};
  return pathItem[method.toLowerCase()];
}

function findRefs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(findRefs);
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    key === "$ref" && typeof entry === "string" ? [entry] : findRefs(entry),
  );
}

function matchesAny(repoPath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(repoPath, pattern));
}

function matchesPattern(repoPath: string, pattern: string): boolean {
  const normalizedPath = toRepoPath(repoPath);
  const normalizedPattern = toRepoPath(pattern);
  const escaped = normalizedPattern
    .split("/")
    .map((segment) => {
      if (segment === "**") {
        return ".*";
      }
      return segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
    })
    .join("/");
  return new RegExp(`^${escaped}$`).test(normalizedPath);
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function summarizeFact(repoRoot: string, repoPath: string): DomainFactRef {
  const summary = safeRead(path.join(repoRoot, repoPath))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  return {
    path: repoPath,
    summary: summary.length <= 160 ? summary : `${summary.slice(0, 157)}...`,
  };
}

function splitSqlList(value: string): string[] {
  const results: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      results.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    results.push(current.trim());
  }
  return results;
}

function stripSqlComments(value: string): string {
  return value.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function safeRead(filePath: string): string {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  } catch {
    return "";
  }
}

function tokenVariants(value: string): string[] {
  const normalized = value.toLowerCase();
  const snake = normalized.replace(/-/g, "_");
  const dashed = normalized.replace(/_/g, "-");
  const singular = normalized.endsWith("s") ? normalized.slice(0, -1) : normalized;
  return uniqueSorted([normalized, snake, dashed, singular, singular.replace(/-/g, "_")].filter(Boolean));
}

function uniqueFileRefs(values: DomainIndexFileRef[]): DomainIndexFileRef[] {
  const byKey = new Map<string, DomainIndexFileRef>();
  for (const value of values) {
    byKey.set(`${value.role}:${value.path}`, value);
  }
  return [...byKey.values()].sort((left, right) => left.path.localeCompare(right.path) || left.role.localeCompare(right.role));
}

function uniqueCoverageGaps(values: DomainCoverageGap[]): DomainCoverageGap[] {
  const byKey = new Map<string, DomainCoverageGap>();
  for (const value of values) {
    byKey.set(`${value.kind}:${value.subject}`, value);
  }
  return [...byKey.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.subject.localeCompare(right.subject));
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
