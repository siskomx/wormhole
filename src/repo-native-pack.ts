import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createFeatureIndex, type FeatureSideEffect, type RepoFeature } from "./feature-index.js";
import {
  detectProjectContract,
  type ProjectPackageManager,
  type ProjectScript,
} from "./project-contract.js";
import { buildRepoIndex, type RepoIndexFile } from "./repo-index.js";
import type { SourceConflict, SourceProvenance } from "./source-authority.js";
import { analyzeSourceConflicts } from "./source-conflicts.js";
import { analyzeTestImpactV2 } from "./test-impact-v2.js";
import { createVerificationPlan, type VerificationCommand } from "./verification-runner.js";

export type RepoNativePackInput = {
  repoRoot: string;
  objective?: string;
  query?: string;
  changedFiles?: string[];
  diffText?: string;
  limit?: number;
};

export type RepoNativeScript = ProjectScript & {
  category: "test" | "lint" | "migration" | "security" | "build" | "other";
};

export type RepoNativeConvention = {
  path: string;
  source: "repo-pack" | "discovered";
};

export type RepoNativeSchemaTable = {
  name: string;
  sourcePath: string;
};

export type RepoNativeFeatureSlice = {
  featureId: string;
  name: string;
  keyFiles: string[];
  routes: string[];
  hooks: string[];
  services: string[];
  schemaFiles: string[];
  schemaTables: string[];
  tests: string[];
  docs: string[];
  sideEffects: FeatureSideEffect[];
  sourceOfTruth: SourceProvenance[];
  supportingDocs: SourceProvenance[];
  conflicts: SourceConflict[];
};

export type RepoNativeVerificationGate = {
  gateId: string;
  scriptNames: string[];
  commands: VerificationCommand[];
  whenSideEffects: FeatureSideEffect[];
  matchedFeatureIds: string[];
};

export type RepoNativeCoverageGap = {
  kind:
    | "feature-route-without-test"
    | "schema-without-migration-check"
    | "authz-without-policy-gate"
    | "convention-path-missing";
  severity: "warning" | "blocker";
  subject: string;
  message: string;
};

export type RepoNativePack = {
  schemaVersion: "repo-native-pack.v0";
  generatedAt: string;
  repoRoot: string;
  objective: string;
  query: string;
  reusedTools: string[];
  capabilities: {
    scripts: RepoNativeScript[];
    conventions: RepoNativeConvention[];
  };
  schema: {
    tables: RepoNativeSchemaTable[];
    migrationFiles: string[];
    schemaFiles: string[];
  };
  featureSlices: RepoNativeFeatureSlice[];
  verificationGates: RepoNativeVerificationGate[];
  coverage: {
    gaps: RepoNativeCoverageGap[];
  };
  sourceConflicts: SourceConflict[];
};

export type FeatureSliceQueryResult = {
  repoRoot: string;
  query: string;
  slices: RepoNativeFeatureSlice[];
};

type RepoPackConfig = {
  conventions: string[];
  verificationGates: Array<{
    gateId: string;
    scriptNames: string[];
    whenSideEffects: FeatureSideEffect[];
  }>;
};

type SchemaSummary = RepoNativePack["schema"];

const REUSED_TOOLS = [
  "createFeatureIndex",
  "detectProjectContract",
  "buildRepoIndex",
  "analyzeSourceConflicts",
  "analyzeTestImpactV2",
  "createVerificationPlan",
];

const VALID_SIDE_EFFECTS = new Set<FeatureSideEffect>([
  "authz",
  "database_schema",
  "destructive_mutation",
  "file_io",
  "http_mutation",
  "notification",
  "realtime",
  "workflow_cascade",
]);

export function buildRepoNativePack(input: RepoNativePackInput): RepoNativePack {
  const repoRoot = path.resolve(input.repoRoot);
  const objective = input.objective ?? "Understand repo-native coverage.";
  const query = input.query ?? objective;
  const changedFiles = normalizePaths(input.changedFiles ?? []);
  const contract = detectProjectContract({ repoRoot });
  const index = buildRepoIndex({ repoRoot, preset: "large_repo" });
  const featureIndex = createFeatureIndex({ repoRoot });
  const sourceConflicts = analyzeSourceConflicts({ repoRoot, index, contract }).conflicts;
  const impact = analyzeTestImpactV2({ repoRoot, changedFiles, diffText: input.diffText, index });
  const verificationPlan = createVerificationPlan({
    contract,
    impact: {
      ...impact,
      likelyTests: impact.likelyTests.map((test) => test.path),
    },
    changedFiles,
  });
  const repoPack = readRepoPackConfig(repoRoot);
  const scripts = contract.scripts.map((script) => ({
    ...script,
    category: scriptCategory(script.name, script.command),
  }));
  const schema = scanSchema(index.files);
  const featureSlices = selectFeatureSlices({
    features: featureIndex.features,
    query,
    changedFiles,
    sourceConflicts,
    schema,
    limit: input.limit ?? 3,
  });
  const conventions = collectConventions(repoRoot, repoPack.conventions);
  const verificationGates = createRepoNativeVerificationGates({
    packageManager: contract.packageManager,
    repoRoot,
    repoPackGates: repoPack.verificationGates,
    scripts,
    verificationCommands: verificationPlan.commands,
    slices: featureSlices,
  });

  return {
    schemaVersion: "repo-native-pack.v0",
    generatedAt: new Date().toISOString(),
    repoRoot,
    objective,
    query,
    reusedTools: [...REUSED_TOOLS],
    capabilities: { scripts, conventions },
    schema,
    featureSlices,
    verificationGates,
    coverage: {
      gaps: createCoverageGaps({ repoRoot, slices: featureSlices, conventions, schema, verificationGates }),
    },
    sourceConflicts,
  };
}

export function queryFeatureSlice(input: RepoNativePackInput): FeatureSliceQueryResult {
  const pack = buildRepoNativePack({ ...input, limit: input.limit ?? 5 });
  return {
    repoRoot: pack.repoRoot,
    query: pack.query,
    slices: pack.featureSlices,
  };
}

function readRepoPackConfig(repoRoot: string): RepoPackConfig {
  const configPath = path.join(repoRoot, ".wormhole", "repo-pack.json");
  if (!existsSync(configPath)) {
    return { conventions: [], verificationGates: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    if (!isRecord(raw)) {
      return { conventions: [], verificationGates: [] };
    }
    const conventions = Array.isArray(raw.conventions)
      ? raw.conventions.filter((value): value is string => typeof value === "string").map(toRepoPath)
      : [];
    const verificationGates = Array.isArray(raw.verificationGates)
      ? raw.verificationGates.flatMap((gate): RepoPackConfig["verificationGates"] => {
          if (!isRecord(gate) || typeof gate.gateId !== "string") {
            return [];
          }
          const scriptNames = Array.isArray(gate.scriptNames)
            ? gate.scriptNames.filter((value): value is string => typeof value === "string")
            : [];
          const whenSideEffects = Array.isArray(gate.whenSideEffects)
            ? gate.whenSideEffects.filter((value): value is FeatureSideEffect =>
                typeof value === "string" && VALID_SIDE_EFFECTS.has(value as FeatureSideEffect),
              )
            : [];
          return [{ gateId: gate.gateId, scriptNames, whenSideEffects }];
        })
      : [];
    return { conventions: uniqueSorted(conventions), verificationGates };
  } catch {
    return { conventions: [], verificationGates: [] };
  }
}

function collectConventions(repoRoot: string, configured: string[]): RepoNativeConvention[] {
  const byPath = new Map<string, RepoNativeConvention>();
  for (const repoPath of configured.map(toRepoPath)) {
    byPath.set(repoPath, { path: repoPath, source: "repo-pack" });
  }
  for (const repoPath of discoverConventionFiles(repoRoot)) {
    if (!byPath.has(repoPath)) {
      byPath.set(repoPath, { path: repoPath, source: "discovered" });
    }
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function discoverConventionFiles(repoRoot: string): string[] {
  const results: string[] = [];
  for (const topLevel of ["AGENTS.md", "CLAUDE.md"]) {
    if (existsSync(path.join(repoRoot, topLevel))) {
      results.push(topLevel);
    }
  }
  const docsRoot = path.join(repoRoot, "docs");
  if (!existsSync(docsRoot) || !statSync(docsRoot).isDirectory()) {
    return uniqueSorted(results);
  }
  const queue = [docsRoot];
  while (queue.length > 0 && results.length < 200) {
    const directory = queue.shift();
    if (!directory) {
      break;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const repoPath = toRepoPath(path.relative(repoRoot, absolutePath));
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (entry.isFile() && /(?:^|\/)(?:conventions?|security)[^/]*\.md$/i.test(repoPath)) {
        results.push(repoPath);
      }
    }
  }
  return uniqueSorted(results);
}

function scanSchema(files: RepoIndexFile[]): SchemaSummary {
  const tables = new Map<string, RepoNativeSchemaTable>();
  const migrationFiles = new Set<string>();
  const schemaFiles = new Set<string>();
  for (const file of files) {
    const lower = file.path.toLowerCase();
    const isMigration = lower.startsWith("migrations/") || lower.includes("/migrations/") || lower.includes("migration");
    const isSchema =
      lower.endsWith(".sql") ||
      isMigration ||
      /(?:^|\/)(?:db|database|schema|schemas)(?:\/|\.|-|_)/.test(lower) ||
      /(?:schema|schemas?|types?)\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(lower);
    if (isMigration) {
      migrationFiles.add(file.path);
    }
    if (isSchema) {
      schemaFiles.add(file.path);
    }
    if (!isSchema) {
      continue;
    }
    for (const match of file.content.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:"?[\w]+"?)\.)?["`]?([a-zA-Z0-9_]+)["`]?/gi)) {
      if (match[1]) {
        const tableName = match[1].toLowerCase();
        tables.set(`${tableName}:${file.path}`, { name: tableName, sourcePath: file.path });
      }
    }
  }
  return {
    tables: [...tables.values()].sort(compareByNameThenPath),
    migrationFiles: uniqueSorted([...migrationFiles]),
    schemaFiles: uniqueSorted([...schemaFiles]),
  };
}

function selectFeatureSlices(input: {
  features: RepoFeature[];
  query: string;
  changedFiles: string[];
  sourceConflicts: SourceConflict[];
  schema: SchemaSummary;
  limit: number;
}): RepoNativeFeatureSlice[] {
  const scored = input.features
    .map((feature) => ({ feature, score: scoreFeature(feature, input.query, input.changedFiles) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.feature.featureId.localeCompare(right.feature.featureId);
    });
  const selected = scored.length > 0 ? scored : input.features.map((feature) => ({ feature, score: 0 }));
  return selected.slice(0, Math.max(0, input.limit)).map(({ feature }) =>
    toFeatureSlice({
      feature,
      sourceConflicts: input.sourceConflicts,
      schema: input.schema,
    }),
  );
}

function toFeatureSlice(input: {
  feature: RepoFeature;
  sourceConflicts: SourceConflict[];
  schema: SchemaSummary;
}): RepoNativeFeatureSlice {
  const services = input.feature.files
    .filter((file) => file.roles.includes("service"))
    .map((file) => file.path);
  const schemaFiles = uniqueSorted([
    ...input.feature.files.filter((file) => file.roles.includes("db") || file.roles.includes("schema")).map((file) => file.path),
    ...input.schema.schemaFiles.filter((repoPath) => pathBelongsToFeature(repoPath, input.feature.featureId)),
  ]);
  const schemaTables = uniqueSorted([
    ...input.feature.dbTables,
    ...input.schema.tables
      .filter((table) => tableMatchesFeature(table.name, input.feature.featureId))
      .map((table) => table.name),
  ]);
  const keyFiles = uniqueSorted([
    ...input.feature.routes,
    ...services,
    ...input.feature.hooks,
    ...schemaFiles,
    ...input.feature.tests,
    ...input.feature.files.slice(0, 12).map((file) => file.path),
  ]);
  const featurePaths = uniqueSorted([...input.feature.files.map((file) => file.path), ...keyFiles]);
  return {
    featureId: input.feature.featureId,
    name: input.feature.name,
    keyFiles,
    routes: [...input.feature.routes],
    hooks: [...input.feature.hooks],
    services,
    schemaFiles,
    schemaTables,
    tests: [...input.feature.tests],
    docs: [...input.feature.docs],
    sideEffects: [...input.feature.risk.sideEffects],
    sourceOfTruth: [...input.feature.sourceOfTruth],
    supportingDocs: [...input.feature.supportingDocs],
    conflicts: input.sourceConflicts.filter((conflict) => conflictTouchesFeature(conflict, featurePaths)),
  };
}

function createRepoNativeVerificationGates(input: {
  packageManager: ProjectPackageManager;
  repoRoot: string;
  repoPackGates: RepoPackConfig["verificationGates"];
  scripts: RepoNativeScript[];
  verificationCommands: VerificationCommand[];
  slices: RepoNativeFeatureSlice[];
}): RepoNativeVerificationGate[] {
  const gates = input.repoPackGates.map((gate) =>
    createGate({
      packageManager: input.packageManager,
      repoRoot: input.repoRoot,
      gateId: gate.gateId,
      scriptNames: gate.scriptNames,
      whenSideEffects: gate.whenSideEffects,
      scripts: input.scripts,
      verificationCommands: input.verificationCommands,
      slices: input.slices,
    }),
  );
  if (gates.length > 0) {
    return gates.sort((left, right) => left.gateId.localeCompare(right.gateId));
  }
  const inferred: RepoNativeVerificationGate[] = [];
  const authzScripts = input.scripts.filter((script) => script.category === "lint" || script.category === "security");
  if (authzScripts.length > 0) {
    inferred.push(
      createGate({
        packageManager: input.packageManager,
        repoRoot: input.repoRoot,
        gateId: "authz-policy-check",
        scriptNames: authzScripts.map((script) => script.name),
        whenSideEffects: ["authz"],
        scripts: input.scripts,
        verificationCommands: input.verificationCommands,
        slices: input.slices,
      }),
    );
  }
  const migrationScripts = input.scripts.filter((script) => script.category === "migration");
  if (migrationScripts.length > 0) {
    inferred.push(
      createGate({
        packageManager: input.packageManager,
        repoRoot: input.repoRoot,
        gateId: "schema-migration-check",
        scriptNames: migrationScripts.map((script) => script.name),
        whenSideEffects: ["database_schema"],
        scripts: input.scripts,
        verificationCommands: input.verificationCommands,
        slices: input.slices,
      }),
    );
  }
  return inferred.sort((left, right) => left.gateId.localeCompare(right.gateId));
}

function createGate(input: {
  packageManager: ProjectPackageManager;
  repoRoot: string;
  gateId: string;
  scriptNames: string[];
  whenSideEffects: FeatureSideEffect[];
  scripts: RepoNativeScript[];
  verificationCommands: VerificationCommand[];
  slices: RepoNativeFeatureSlice[];
}): RepoNativeVerificationGate {
  const scriptNames = uniqueSorted(input.scriptNames);
  const commands = scriptNames.flatMap((scriptName) => {
    const existing = input.verificationCommands.find((command) => command.name === scriptName);
    if (existing) {
      return [existing];
    }
    const script = input.scripts.find((candidate) => candidate.name === scriptName);
    return script ? [commandFromScript(input.packageManager, script, input.repoRoot)] : [];
  });
  return {
    gateId: input.gateId,
    scriptNames,
    commands,
    whenSideEffects: uniqueSorted(input.whenSideEffects) as FeatureSideEffect[],
    matchedFeatureIds: input.slices
      .filter((slice) => input.whenSideEffects.some((sideEffect) => slice.sideEffects.includes(sideEffect)))
      .map((slice) => slice.featureId)
      .sort((left, right) => left.localeCompare(right)),
  };
}

function createCoverageGaps(input: {
  repoRoot: string;
  slices: RepoNativeFeatureSlice[];
  conventions: RepoNativeConvention[];
  schema: SchemaSummary;
  verificationGates: RepoNativeVerificationGate[];
}): RepoNativeCoverageGap[] {
  const gaps: RepoNativeCoverageGap[] = [];
  const hasSchemaGate = input.verificationGates.some((gate) => gate.whenSideEffects.includes("database_schema"));
  const hasAuthzGate = input.verificationGates.some((gate) => gate.whenSideEffects.includes("authz"));
  for (const slice of input.slices) {
    for (const route of slice.routes) {
      if (!hasRouteSpecificTest(route, slice.tests)) {
        gaps.push({
          kind: "feature-route-without-test",
          severity: "warning",
          subject: `feature:${slice.featureId}:${route}`,
          message: `${slice.featureId} route ${route} has no route-specific test file in the selected feature slice.`,
        });
      }
    }
    if (slice.sideEffects.includes("authz") && !hasAuthzGate) {
      gaps.push({
        kind: "authz-without-policy-gate",
        severity: "blocker",
        subject: `feature:${slice.featureId}`,
        message: `${slice.featureId} has authorization side effects but no repo-native authz verification gate.`,
      });
    }
  }
  if (input.schema.tables.length > 0 && !hasSchemaGate) {
    gaps.push({
      kind: "schema-without-migration-check",
      severity: "warning",
      subject: "schema",
      message: "Schema tables were detected, but no repo-native migration verification gate is mapped.",
    });
  }
  for (const convention of input.conventions.filter((item) => item.source === "repo-pack")) {
    if (!existsSync(path.join(input.repoRoot, convention.path))) {
      gaps.push({
        kind: "convention-path-missing",
        severity: "warning",
        subject: `convention:${convention.path}`,
        message: `.wormhole/repo-pack.json declares ${convention.path}, but that file does not exist.`,
      });
    }
  }
  return gaps.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.subject.localeCompare(right.subject);
  });
}

function scoreFeature(feature: RepoFeature, query: string, changedFiles: string[]): number {
  const rawQueryTokens = new Set(tokenize(query));
  const queryTokens = new Set([...rawQueryTokens].flatMap(tokenVariants));
  const featureTokens = new Set(tokenVariants(feature.featureId));
  const haystack = [
    feature.featureId,
    feature.name,
    ...feature.roots,
    ...feature.files.map((file) => file.path),
    ...feature.dbTables,
  ].join(" ").toLowerCase();
  let score = 0;
  if (rawQueryTokens.has(feature.featureId)) {
    score += 80;
  }
  for (const token of queryTokens) {
    if (featureTokens.has(token)) {
      score += 50;
    } else if (haystack.includes(token)) {
      score += 10;
    }
  }
  for (const changedFile of changedFiles) {
    if (feature.files.some((file) => pathsEqual(file.path, changedFile))) {
      score += 100;
    } else if (feature.roots.some((root) => changedFile === root || changedFile.startsWith(`${root}/`))) {
      score += 25;
    }
  }
  return score;
}

function scriptCategory(name: string, command: string): RepoNativeScript["category"] {
  const text = `${name} ${command}`.toLowerCase();
  if (/\b(test|vitest|jest|playwright|mocha|pytest|cargo test|dotnet test)\b/.test(text)) {
    return "test";
  }
  if (/\b(lint|eslint|biome|ruff|clippy|typecheck|tenant|org-filter|policy)\b/.test(text)) {
    return "lint";
  }
  if (/\b(migration|migrations|schema|database|db)\b/.test(text)) {
    return "migration";
  }
  if (/\b(security|audit|secrets?|snyk|trivy)\b/.test(text)) {
    return "security";
  }
  if (/\b(build|compile|tsc|cargo build|dotnet build)\b/.test(text)) {
    return "build";
  }
  return "other";
}

function commandFromScript(
  packageManager: ProjectPackageManager,
  script: ProjectScript,
  repoRoot: string,
): VerificationCommand {
  const metadata = {
    name: script.name,
    cwd: repoRoot,
    tier: "focused" as const,
    source: "contract" as const,
    reason: `Run repo-native verification gate script ${script.name}.`,
  };
  switch (packageManager) {
    case "pnpm":
      return { ...metadata, command: "pnpm", args: ["run", script.name] };
    case "yarn":
      return { ...metadata, command: "yarn", args: [script.name] };
    case "bun":
      return { ...metadata, command: "bun", args: ["run", script.name] };
    case "cargo":
      return { ...metadata, command: "cargo", args: [script.name] };
    case "dotnet":
      return { ...metadata, command: "dotnet", args: [script.name] };
    case "npm":
    case "unknown":
      return { ...metadata, command: "npm", args: ["run", script.name] };
  }
}

function conflictTouchesFeature(conflict: SourceConflict, featurePaths: string[]): boolean {
  const evidencePaths = [
    ...conflict.authoritative.map((source) => source.sourcePath),
    ...conflict.conflicting.map((source) => source.sourcePath),
    conflict.subject,
  ];
  return evidencePaths.some((value) =>
    featurePaths.some((featurePath) => value.includes(featurePath) || featurePath.includes(value)),
  );
}

function hasRouteSpecificTest(route: string, tests: string[]): boolean {
  const routeStem = normalizeToken(path.posix.basename(route).replace(/\.[^.]+$/, ""));
  return tests.some((test) => normalizeToken(test).includes(routeStem));
}

function pathBelongsToFeature(repoPath: string, featureId: string): boolean {
  const normalizedPath = `/${toRepoPath(repoPath).toLowerCase()}/`;
  return tokenVariants(featureId).some((token) => normalizedPath.includes(`/${token}/`) || normalizedPath.includes(`/${token}.`));
}

function tableMatchesFeature(tableName: string, featureId: string): boolean {
  const normalizedTable = tableName.toLowerCase();
  return tokenVariants(featureId)
    .map((token) => token.replace(/-/g, "_"))
    .some((token) => normalizedTable === token || normalizedTable.startsWith(`${token}_`));
}

function tokenVariants(value: string): string[] {
  const normalized = normalizeToken(value);
  const variants = new Set([normalized, normalized.replace(/_/g, "-"), normalized.replace(/-/g, "_")]);
  if (normalized.endsWith("s") && normalized.length > 3) {
    variants.add(normalized.slice(0, -1));
    variants.add(normalized.slice(0, -1).replace(/-/g, "_"));
  } else if (normalized.length > 2) {
    variants.add(`${normalized}s`);
    variants.add(`${normalized.replace(/-/g, "_")}s`);
  }
  return [...variants].filter(Boolean);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizePaths(values: string[]): string[] {
  return uniqueSorted(values.map(toRepoPath));
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function compareByNameThenPath(left: RepoNativeSchemaTable, right: RepoNativeSchemaTable): number {
  if (left.name !== right.name) {
    return left.name.localeCompare(right.name);
  }
  return left.sourcePath.localeCompare(right.sourcePath);
}

function pathsEqual(left: string, right: string): boolean {
  return toRepoPath(left).toLowerCase() === toRepoPath(right).toLowerCase();
}

function normalizeToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
