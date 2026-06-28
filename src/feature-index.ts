import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  classifySourceProvenance,
  compareSourceProvenance,
  isAuthoritativeSource,
  type SourceConflict,
  type SourceProvenance,
} from "./source-authority.js";

export type FeatureFileRole =
  | "backend"
  | "component"
  | "db"
  | "doc"
  | "frontend"
  | "hook"
  | "job"
  | "page"
  | "realtime"
  | "route"
  | "schema"
  | "service"
  | "test"
  | "other";

export type FeatureSideEffect =
  | "authz"
  | "database_schema"
  | "destructive_mutation"
  | "file_io"
  | "http_mutation"
  | "notification"
  | "realtime"
  | "workflow_cascade";

export type FeatureIndexFile = {
  path: string;
  roles: FeatureFileRole[];
};

export type FeatureRiskSummary = {
  sideEffects: FeatureSideEffect[];
  confidence: number;
};

export type RepoFeature = {
  featureId: string;
  name: string;
  roots: string[];
  fileCount: number;
  files: FeatureIndexFile[];
  truncated: boolean;
  routes: string[];
  hooks: string[];
  dbTables: string[];
  tests: string[];
  docs: string[];
  sourceOfTruth: SourceProvenance[];
  supportingDocs: SourceProvenance[];
  conflicts: SourceConflict[];
  risk: FeatureRiskSummary;
  evidence: string[];
};

export type RepoFeatureIndex = {
  schemaVersion: "feature-index.v0";
  generatedAt: string;
  repoRoot: string;
  fingerprint: string;
  featureCount: number;
  features: RepoFeature[];
};

const MAX_FILES = 50_000;
const MAX_FEATURES = 120;
const MAX_FILES_PER_FEATURE = 120;

const IGNORED_DIRECTORIES = new Set([
  ".agents",
  ".claude",
  ".codex",
  ".cursor",
  ".git",
  ".next",
  ".pnpm-store",
  ".superpowers",
  ".turbo",
  ".wormhole",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
  "tmp",
]);

const ROLE_PRIORITY: FeatureFileRole[] = [
  "route",
  "service",
  "backend",
  "page",
  "component",
  "hook",
  "frontend",
  "db",
  "test",
  "doc",
  "realtime",
  "job",
  "schema",
  "other",
];

export function createFeatureIndex(input: { repoRoot: string; generatedAt?: string }): RepoFeatureIndex {
  const repoRoot = path.resolve(input.repoRoot);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const allFiles = listFeatureIndexFiles(repoRoot);
  const structuralMatches = new Map<string, Set<string>>();
  const featureIds = new Set<string>();

  for (const repoPath of allFiles) {
    const matches = new Set([
      ...structuralFeatureIds(repoPath),
      ...semanticFeatureIds(repoPath, safeReadSmallFile(path.join(repoRoot, repoPath))),
    ]);
    if (matches.size > 0) {
      structuralMatches.set(repoPath, matches);
      for (const featureId of matches) {
        featureIds.add(featureId);
      }
    }
  }

  const featureFiles = new Map<string, FeatureIndexFile[]>();
  const featureEvidence = new Map<string, Set<string>>();
  const featureTables = new Map<string, Set<string>>();
  const featureRisks = new Map<string, Set<FeatureSideEffect>>();

  for (const repoPath of allFiles) {
    const matchedFeatureIds = featureIdsForPath(repoPath, featureIds, structuralMatches.get(repoPath));
    if (matchedFeatureIds.size === 0) {
      continue;
    }
    const content = safeReadSmallFile(path.join(repoRoot, repoPath));
    const roles = classifyFeatureFile(repoPath);
    const sideEffects = detectSideEffects(repoPath, content);
    const tables = detectDbTables(content);
    for (const featureId of matchedFeatureIds) {
      pushMapArray(featureFiles, featureId, { path: repoPath, roles });
      pushEvidence(featureEvidence, featureId, repoPath);
      const tableSet = ensureSet(featureTables, featureId);
      for (const table of tables.filter((table) => tableBelongsToFeature(table, featureId))) {
        tableSet.add(table);
      }
      const riskSet = ensureSet(featureRisks, featureId);
      for (const sideEffect of sideEffects) {
        riskSet.add(sideEffect);
      }
    }
  }

  const features = [...featureFiles.entries()]
    .map(([featureId, files]) =>
      createFeature({
        featureId,
        files: uniqueFeatureFiles(files),
        evidence: [...(featureEvidence.get(featureId) ?? new Set<string>())],
        dbTables: [...(featureTables.get(featureId) ?? new Set<string>())],
        sideEffects: [...(featureRisks.get(featureId) ?? new Set<FeatureSideEffect>())],
      }),
    )
    .filter((feature) => feature.fileCount > 0)
    .sort((left, right) => {
      const scoreDelta = featureScore(right) - featureScore(left);
      return scoreDelta === 0 ? left.featureId.localeCompare(right.featureId) : scoreDelta;
    })
    .slice(0, MAX_FEATURES);

  const fingerprint = createHash("sha256")
    .update(features.map((feature) => `${feature.featureId}:${feature.files.map((file) => file.path).join(",")}`).join("\n"))
    .digest("hex")
    .slice(0, 16);

  return {
    schemaVersion: "feature-index.v0",
    generatedAt,
    repoRoot,
    fingerprint,
    featureCount: features.length,
    features,
  };
}

export function renderFeatureIndexMarkdown(featureIndex: RepoFeatureIndex): string {
  const featureLines = featureIndex.features.length > 0
    ? featureIndex.features.slice(0, 20).flatMap((feature) => [
        `## ${feature.name} (${feature.featureId})`,
        "",
        `Files: ${feature.fileCount}${feature.truncated ? " (truncated)" : ""}`,
        `Roots: ${feature.roots.join(", ") || "none"}`,
        `Side effects: ${feature.risk.sideEffects.join(", ") || "none detected"}`,
        "",
        ...feature.files.slice(0, 20).map((file) => `- ${file.path} [${file.roles.join(", ")}]`),
        "",
      ])
    : ["- No feature roots detected.", ""];
  return [
    "# Feature Index",
    "",
    `Schema: ${featureIndex.schemaVersion}`,
    `Features: ${featureIndex.featureCount}`,
    `Fingerprint: ${featureIndex.fingerprint}`,
    "",
    ...featureLines,
  ].join("\n");
}

function createFeature(input: {
  featureId: string;
  files: FeatureIndexFile[];
  evidence: string[];
  dbTables: string[];
  sideEffects: FeatureSideEffect[];
}): RepoFeature {
  const sortedFiles = input.files.sort(compareFeatureFiles);
  const truncated = sortedFiles.length > MAX_FILES_PER_FEATURE;
  const files = sortedFiles.slice(0, MAX_FILES_PER_FEATURE);
  const roots = [...new Set(files.map((file) => rootForFeature(input.featureId, file.path)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 20);
  const sourceProvenance = files
    .map((file) => classifySourceProvenance({ sourcePath: file.path }))
    .sort(compareSourceProvenance);
  return {
    featureId: input.featureId,
    name: titleCase(input.featureId),
    roots,
    fileCount: sortedFiles.length,
    files,
    truncated,
    routes: files.filter((file) => file.roles.includes("route")).map((file) => file.path),
    hooks: files.filter((file) => file.roles.includes("hook")).map((file) => file.path),
    dbTables: input.dbTables.sort((left, right) => left.localeCompare(right)),
    tests: files.filter((file) => file.roles.includes("test")).map((file) => file.path),
    docs: files.filter((file) => file.roles.includes("doc")).map((file) => file.path),
    sourceOfTruth: sourceProvenance.filter(isAuthoritativeSource).slice(0, 30),
    supportingDocs: sourceProvenance.filter((source) => !isAuthoritativeSource(source)).slice(0, 30),
    conflicts: [],
    risk: {
      sideEffects: input.sideEffects.sort((left, right) => left.localeCompare(right)),
      confidence: input.sideEffects.length > 0 ? 0.75 : 0.45,
    },
    evidence: input.evidence.sort((left, right) => left.localeCompare(right)).slice(0, 20),
  };
}

function listFeatureIndexFiles(repoRoot: string): string[] {
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    return [];
  }
  const files: string[] = [];
  const queue = [repoRoot];
  while (queue.length > 0 && files.length < MAX_FILES) {
    const directory = queue.shift();
    if (!directory) {
      break;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const repoPath = toRepoPath(path.relative(repoRoot, absolutePath));
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }
      if (entry.isFile() && isFeatureRelevantFile(repoPath)) {
        files.push(repoPath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function isFeatureRelevantFile(repoPath: string): boolean {
  const lower = repoPath.toLowerCase();
  if (lower.startsWith("docs/_archive/")) {
    return false;
  }
  return /\.(?:cjs|cs|csproj|css|cts|html|js|json|jsx|md|mdx|mjs|mts|py|sln|sql|ts|tsx|txt|xml|ya?ml)$/.test(repoPath);
}

function structuralFeatureIds(repoPath: string): Set<string> {
  const ids = new Set<string>();
  const normalized = toRepoPath(repoPath);
  const lower = normalized.toLowerCase();
  const structuralPatterns = [
    /(?:^|\/)src\/features\/([^/]+)/,
    /(?:^|\/)frontend\/src\/features\/([^/]+)/,
    /(?:^|\/)features\/([^/]+)/,
    /(?:^|\/)backend\/src\/modules\/([^/]+)/,
    /(?:^|\/)server\/src\/modules\/([^/]+)/,
    /(?:^|\/)src\/modules\/([^/]+)/,
    /(?:^|\/)docs\/discoveries\/features\/([^/.]+)/,
    /(?:^|\/)docs\/discoveries\/modules\/([^/.]+)/,
  ];
  for (const pattern of structuralPatterns) {
    const match = lower.match(pattern);
    if (match?.[1]) {
      addFeatureId(ids, match[1]);
    }
  }
  const hookDoc = lower.match(/(?:^|\/)docs\/discoveries\/hooks\/use([a-z0-9-]+)\.md$/i);
  if (hookDoc?.[1]) {
    addFeatureId(ids, hookDoc[1]);
  }
  addCompoundWorkflowFeatureIds(ids, lower);
  const basename = normalized.split("/").pop() ?? normalized;
  const pascalPrefix = basename.match(/^([A-Z][A-Za-z0-9]+?)(?:Routes|Controller|Service|Repository|Gateway|Schemas?|Types?|Window|Container|Dialog|Widget|Page|View|List|Queue|Message|Input|Button|Item|Job|Store|Provider|Context|Hook)?\./);
  if (pascalPrefix?.[1]) {
    addFeatureId(ids, pascalPrefix[1]);
  }
  const hookPrefix = basename.match(/^use([A-Z][A-Za-z0-9]+)\./);
  if (hookPrefix?.[1]) {
    addFeatureId(ids, hookPrefix[1]);
  }
  return ids;
}

function semanticFeatureIds(repoPath: string, content: string): Set<string> {
  const ids = new Set<string>();
  const lowerPath = toRepoPath(repoPath).toLowerCase();
  const lowerContent = content.toLowerCase();
  if (
    lowerPath.includes("webclient") ||
    lowerPath.includes("web-client") ||
    /hostwebclient|no\s*web\s*client|nowebclient|webdir|web client/.test(lowerContent)
  ) {
    addFeatureId(ids, "web-client");
  }
  return ids;
}

function addCompoundWorkflowFeatureIds(ids: Set<string>, lowerPath: string): void {
  const basename = lowerPath.split("/").pop() ?? lowerPath;
  const workflowMatch = basename.match(/^(?:org|saas)-([a-z0-9]+)-([a-z0-9]+)-[a-z0-9-]+(?:\.workflow\.test|\.behavior)?\./);
  if (!workflowMatch?.[1] || !workflowMatch[2]) {
    return;
  }
  addFeatureId(ids, `${workflowMatch[1]}-${workflowMatch[2]}`);
}

function featureIdsForPath(repoPath: string, knownFeatureIds: Set<string>, structuralIds?: Set<string>): Set<string> {
  const ids = new Set<string>(structuralIds ?? []);
  if (ids.size > 0 && isCompoundWorkflowPath(repoPath)) {
    return ids;
  }
  const lowerPath = `/${toRepoPath(repoPath).toLowerCase()}`;
  for (const featureId of knownFeatureIds) {
    if (featureId.length < 3) {
      continue;
    }
    const tokens = featureTokens(featureId);
    if (tokens.some((token) => lowerPath.includes(token))) {
      ids.add(featureId);
    }
  }
  return ids;
}

function isCompoundWorkflowPath(repoPath: string): boolean {
  const basename = toRepoPath(repoPath).toLowerCase().split("/").pop() ?? "";
  return /^(?:org|saas)-[a-z0-9]+-[a-z0-9]+-[a-z0-9-]+(?:\.workflow\.test|\.behavior)?\./.test(basename);
}

function featureTokens(featureId: string): string[] {
  const snake = featureId.replace(/-/g, "_");
  const pascal = featureId
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return [
    `/${featureId}/`,
    `/${featureId}.`,
    `/${featureId}-`,
    `/${featureId}_`,
    `-${featureId}-`,
    `_${snake}_`,
    `_${snake}.`,
    `/${snake}_`,
    `${pascal.toLowerCase()}routes.`,
    `${pascal.toLowerCase()}service.`,
    `use${pascal.toLowerCase()}.`,
  ];
}

function classifyFeatureFile(repoPathInput: string): FeatureFileRole[] {
  const repoPath = toRepoPath(repoPathInput);
  const lower = repoPath.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;
  const roles = new Set<FeatureFileRole>();
  if (/(^|\/)(tests?|__tests__|e2e)(\/|$)/.test(lower) || /[._-](test|spec)\.[a-z0-9]+$/.test(basename)) {
    roles.add("test");
  }
  if (lower.startsWith("docs/") || /\.(md|mdx)$/.test(basename)) {
    roles.add("doc");
  }
  if (lower.startsWith("migrations/") || /\.sql$/.test(basename)) {
    roles.add("db");
  }
  if (lower.startsWith("backend/") || lower.startsWith("server/") || lower.includes("/modules/") || /\.(cs|csproj|sln)$/.test(basename)) {
    roles.add("backend");
  }
  if (lower.startsWith("src/") || lower.startsWith("frontend/") || /\.(tsx|jsx|css|html)$/.test(basename)) {
    roles.add("frontend");
  }
  if (/(^|\/)pages?\//.test(lower) || /(?:page|view)\.(tsx|jsx|ts|js)$/.test(basename)) {
    roles.add("page");
  }
  if (/(^|\/)components?\//.test(lower) || /(?:component|container|dialog|widget|window|list|queue|message|input|button|item)\.(tsx|jsx|ts|js)$/.test(basename)) {
    roles.add("component");
  }
  if (/(^|\/)hooks?\//.test(lower) || /^use[a-z0-9]+/.test(basename)) {
    roles.add("hook");
  }
  if (/(routes?|controller)\.(ts|tsx|js|jsx|mts|mjs|cts|cjs|cs)$/.test(basename)) {
    roles.add("route");
  }
  if (/service\.(ts|tsx|js|jsx|mts|mjs|cts|cjs|cs)$/.test(basename)) {
    roles.add("service");
  }
  if (/gateway\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(basename) || lower.includes("realtime")) {
    roles.add("realtime");
  }
  if (/(^|\/)jobs?\//.test(lower) || /job\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(basename)) {
    roles.add("job");
  }
  if (/schemas?\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(basename) || /types?\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(basename)) {
    roles.add("schema");
  }
  if (roles.size === 0) {
    roles.add("other");
  }
  return [...roles].sort((left, right) => ROLE_PRIORITY.indexOf(left) - ROLE_PRIORITY.indexOf(right));
}

function detectSideEffects(repoPath: string, content: string): FeatureSideEffect[] {
  const sideEffects = new Set<FeatureSideEffect>();
  const lowerPath = repoPath.toLowerCase();
  const lowerContent = content.toLowerCase();
  if (lowerPath.startsWith("migrations/") || /\.sql$/.test(lowerPath)) {
    sideEffects.add("database_schema");
  }
  if (/\b(app|router|fastify)\.(post|put|patch|delete)\b/.test(lowerContent) || /method:\s*["'](?:post|put|patch|delete)["']/.test(lowerContent)) {
    sideEffects.add("http_mutation");
  }
  if (/\bdelete\b|remove-|archive|destroy/.test(lowerContent)) {
    sideEffects.add("destructive_mutation");
  }
  if (/realtime|websocket|socket|\.emit\(|broadcast/.test(lowerContent)) {
    sideEffects.add("realtime");
  }
  if (/email|notification|notify|mailer/.test(lowerContent)) {
    sideEffects.add("notification");
  }
  if (/authguard|permissionguard|require\(["']permission|authorization|authenticate|rate\s*limit|ratelimit/.test(lowerContent)) {
    sideEffects.add("authz");
  }
  if (/attachment|upload|download|filesystem|writefile|readfile/.test(lowerContent)) {
    sideEffects.add("file_io");
  }
  if (/convert|ticket|invoice|payment|subscription|cascade|history/.test(lowerContent)) {
    sideEffects.add("workflow_cascade");
  }
  return [...sideEffects];
}

function detectDbTables(content: string): string[] {
  const tables = new Set<string>();
  for (const match of content.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:"?[\w]+"?)\.)?["`]?([a-zA-Z0-9_]+)["`]?/gi)) {
    if (match[1]) {
      tables.add(match[1]);
    }
  }
  return [...tables];
}

function tableBelongsToFeature(tableName: string, featureId: string): boolean {
  const normalizedTable = tableName.toLowerCase();
  const normalizedFeature = featureId.replace(/-/g, "_").toLowerCase();
  return normalizedTable === normalizedFeature || normalizedTable.startsWith(`${normalizedFeature}_`);
}

function rootForFeature(featureId: string, repoPath: string): string {
  const segments = repoPath.split("/");
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const featureIndex = lowerSegments.findIndex((segment) => normalizeFeatureId(segment) === featureId);
  if (featureIndex >= 0) {
    return segments.slice(0, featureIndex + 1).join("/");
  }
  if (repoPath.startsWith("migrations/")) {
    return "migrations";
  }
  if (repoPath.startsWith("docs/discoveries/")) {
    return segments.slice(0, 3).join("/");
  }
  return segments.length > 1 ? segments.slice(0, 2).join("/") : ".";
}

function compareFeatureFiles(left: FeatureIndexFile, right: FeatureIndexFile): number {
  const roleDelta = bestRolePriority(left.roles) - bestRolePriority(right.roles);
  return roleDelta === 0 ? left.path.localeCompare(right.path) : roleDelta;
}

function bestRolePriority(roles: FeatureFileRole[]): number {
  return Math.min(...roles.map((role) => ROLE_PRIORITY.indexOf(role)).filter((index) => index >= 0));
}

function featureScore(feature: RepoFeature): number {
  return feature.fileCount + feature.routes.length * 5 + feature.hooks.length * 3 + feature.tests.length * 2 + feature.docs.length;
}

function uniqueFeatureFiles(files: FeatureIndexFile[]): FeatureIndexFile[] {
  const byPath = new Map<string, Set<FeatureFileRole>>();
  for (const file of files) {
    const roles = ensureSet(byPath, file.path);
    for (const role of file.roles) {
      roles.add(role);
    }
  }
  return [...byPath.entries()].map(([filePath, roles]) => ({
    path: filePath,
    roles: [...roles].sort((left, right) => ROLE_PRIORITY.indexOf(left) - ROLE_PRIORITY.indexOf(right)),
  }));
}

function pushMapArray<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

function pushEvidence(map: Map<string, Set<string>>, featureId: string, repoPath: string): void {
  const evidence = ensureSet(map, featureId);
  if (
    repoPath.startsWith("src/features/") ||
    repoPath.startsWith("backend/src/modules/") ||
    repoPath.startsWith("docs/discoveries/") ||
    repoPath.startsWith("migrations/")
  ) {
    evidence.add(repoPath);
  }
}

function ensureSet<T>(map: Map<string, Set<T>>, key: string): Set<T> {
  let existing = map.get(key);
  if (!existing) {
    existing = new Set<T>();
    map.set(key, existing);
  }
  return existing;
}

function addFeatureId(ids: Set<string>, value: string): void {
  const featureId = normalizeFeatureId(value);
  if (featureId.length >= 3 && !isNoisyFeatureId(featureId)) {
    ids.add(featureId);
  }
}

function normalizeFeatureId(value: string): string {
  return value
    .replace(/^use(?=[A-Z])/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function isNoisyFeatureId(featureId: string): boolean {
  return new Set([
    "index",
    "app",
    "base",
    "common",
    "component",
    "types",
    "schema",
    "schemas",
    "feature",
    "features",
    "domain",
    "internal",
    "route",
    "routes",
    "page",
    "pages",
    "view",
    "views",
    "model",
    "models",
    "dictionary",
    "dictionaries",
    "service",
    "services",
    "controller",
    "controllers",
    "components",
    "hooks",
    "utils",
    "shared",
  ]).has(featureId);
}

function titleCase(featureId: string): string {
  return featureId
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function safeReadSmallFile(filePath: string): string {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size > 250_000) {
      return "";
    }
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
