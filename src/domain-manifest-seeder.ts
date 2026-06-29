import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  createFeatureIndex,
  type FeatureSideEffect,
} from "./feature-index.js";
import { detectFrameworkProfile } from "./framework-profile.js";
import { extractRouteEndpoints } from "./route-extraction.js";
import {
  domainIndexManifestPath,
  readDomainIndexManifest,
  type DomainIndexFeatureConfig,
  type DomainIndexFileGroups,
  type DomainIndexManifest,
  type DomainIndexVerificationGateConfig,
} from "./domain-index-manifest.js";

export type DomainManifestDiffOperation =
  | {
      kind: "add-feature";
      featureId: string;
      candidate: DomainIndexFeatureConfig;
    }
  | {
      kind: "update-feature-roots";
      featureId: string;
      current: string[];
      candidate: string[];
    }
  | {
      kind: "update-feature-tables";
      featureId: string;
      current: string[];
      candidate: string[];
    }
  | {
      kind: "update-file-groups";
      group: keyof DomainIndexFileGroups;
      current: string[];
      candidate: string[];
    }
  | {
      kind: "add-verification-gate";
      gateId: string;
      candidate: DomainIndexVerificationGateConfig;
    };

export type DomainManifestGenerateResult = {
  repoRoot: string;
  manifestPath: string;
  present: boolean;
  valid: boolean;
  currentHash?: string;
  candidateHash: string;
  manifest: DomainIndexManifest;
  warnings: string[];
  blockers: string[];
  sourceSummary: {
    genericFeatureCount: number;
    inferredFeatureCount: number;
    preservedFeatureCount: number;
  };
};

export type DomainManifestDiffResult = {
  repoRoot: string;
  manifestPath: string;
  present: boolean;
  valid: boolean;
  baseHash: string;
  candidateHash: string;
  operations: DomainManifestDiffOperation[];
  warnings: string[];
  blockers: string[];
};

export type DomainManifestStatusResult = {
  repoRoot: string;
  manifestPath: string;
  present: boolean;
  valid: boolean;
  currentHash?: string;
  candidateHash: string;
  pendingOperationCount: number;
  operationCounts: Record<string, number>;
  warnings: string[];
  blockers: string[];
};

export type DomainManifestApplyResult = {
  repoRoot: string;
  manifestPath: string;
  baseHash: string;
  candidateHash: string;
  appliedOperationCount: number;
  backupPath?: string;
  manifest: DomainIndexManifest;
  warnings: string[];
};

const EMPTY_FILE_GROUPS: DomainIndexFileGroups = {
  routes: [],
  hooks: [],
  services: [],
  migrations: [],
  openapi: [],
  conventions: [],
  memory: [],
};

const ABSENT_MANIFEST_HASH = hashText("domain-index-manifest:absent");
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
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
  "tmp",
]);

const FILE_GROUP_KEYS: Array<keyof DomainIndexFileGroups> = [
  "routes",
  "hooks",
  "services",
  "migrations",
  "openapi",
  "conventions",
  "memory",
];

const ROUTE_CANDIDATE_LIMIT = 2_000;

export function generateDomainManifestCandidate(input: { repoRoot: string }): DomainManifestGenerateResult {
  const repoRoot = path.resolve(input.repoRoot);
  const manifestPath = domainIndexManifestPath(repoRoot);
  const present = existsSync(manifestPath);
  const current = readDomainIndexManifest({ repoRoot });
  const valid = !present || current.manifest !== undefined;
  const blockers = valid ? [] : ["Current .wormhole/domain-index.json is invalid; fix it before applying generated seeders."];
  const genericIndex = createFeatureIndex({ repoRoot });
  const repoFiles = listRepoFiles(repoRoot);
  const frameworkProfile = detectFrameworkProfile({ repoRoot, repoFiles });
  const routeCandidateSelection = selectRouteCandidateFiles(repoFiles);
  const routeEndpoints = extractRouteEndpoints({
    repoRoot,
    files: routeCandidateSelection.files,
  });
  const currentManifest = current.manifest ?? emptyManifest();
  const currentFeaturesById = new Map(currentManifest.features.map((feature) => [feature.featureId, feature]));
  const genericFeaturesById = new Set(genericIndex.features.map((feature) => feature.featureId));
  const canonicalFeatureIds = new Set(currentManifest.features.map((feature) => feature.featureId));
  for (const feature of genericIndex.features) {
    canonicalFeatureIds.add(feature.featureId);
  }
  const aliasToFeatureId = createAliasMap(currentManifest.features);
  const candidateFeatures = new Map<string, DomainIndexFeatureConfig>();
  const observedFeatureIds = new Set<string>();

  for (const feature of currentManifest.features) {
    candidateFeatures.set(feature.featureId, cloneFeature(feature));
  }

  for (const feature of genericIndex.features) {
    const featureId = canonicalFeatureId(feature.featureId, {
      aliasToFeatureId,
      currentFeatureIds: new Set(currentFeaturesById.keys()),
      genericFeatureIds: genericFeaturesById,
      canonicalFeatureIds,
    });
    observedFeatureIds.add(featureId);
    const existing = candidateFeatures.get(featureId) ?? currentFeaturesById.get(featureId);
    const roots = featureId === feature.featureId
      ? feature.roots.filter((root) => root !== "migrations")
      : feature.roots.filter((root) => rootBelongsToFeature(root, featureId));
    candidateFeatures.set(featureId, {
      featureId,
      displayName: existing?.displayName ?? (featureId === feature.featureId ? feature.name : titleCase(featureId)),
      aliases: uniqueSorted(existing?.aliases ?? []),
      roots: uniqueSorted([...(existing?.roots ?? []), ...roots]),
      portals: uniqueSorted(existing?.portals ?? []),
      tables: uniqueSorted([...(existing?.tables ?? []), ...feature.dbTables]),
    });
    aliasToFeatureId.set(feature.featureId, featureId);
  }

  const inferredFileGroups = inferFileGroups(repoFiles, {
    frameworkIds: frameworkProfile.frameworks.map((framework) => framework.id),
    routeFiles: routeEndpoints.map((endpoint) => endpoint.sourcePath),
  });
  const manifest: DomainIndexManifest = {
    schemaVersion: "domain-index.v0",
    features: [...candidateFeatures.values()].sort(compareByFeatureId),
    fileGroups: mergeFileGroups(currentManifest.fileGroups, inferredFileGroups),
    verificationGates: currentManifest.verificationGates.map(cloneVerificationGate).sort(compareByGateId),
  };

  const currentHash = current.manifest ? hashManifest(current.manifest) : undefined;
  const staleWarnings = currentManifest.features
    .filter((feature) => !observedFeatureIds.has(feature.featureId))
    .map((feature) => `Preserved stale manual domain feature not observed in repo evidence: ${feature.featureId}`);
  return {
    repoRoot,
    manifestPath,
    present,
    valid,
    ...(currentHash ? { currentHash } : {}),
    candidateHash: hashManifest(manifest),
    manifest,
    warnings: uniqueSorted([...current.warnings, ...staleWarnings, ...routeCandidateSelection.warnings]),
    blockers,
    sourceSummary: {
      genericFeatureCount: genericIndex.featureCount,
      inferredFeatureCount: genericIndex.features.length,
      preservedFeatureCount: currentManifest.features.length,
    },
  };
}

export function diffDomainManifestCandidate(input: { repoRoot: string }): DomainManifestDiffResult {
  const generated = generateDomainManifestCandidate(input);
  const current = readDomainIndexManifest({ repoRoot: generated.repoRoot });
  const currentManifest = current.manifest ?? emptyManifest();
  const operations: DomainManifestDiffOperation[] = [];
  const currentFeatures = new Map(currentManifest.features.map((feature) => [feature.featureId, feature]));

  for (const candidateFeature of generated.manifest.features) {
    const currentFeature = currentFeatures.get(candidateFeature.featureId);
    if (!currentFeature) {
      operations.push({
        kind: "add-feature",
        featureId: candidateFeature.featureId,
        candidate: candidateFeature,
      });
      continue;
    }
    if (!sameStringArray(currentFeature.roots, candidateFeature.roots)) {
      operations.push({
        kind: "update-feature-roots",
        featureId: candidateFeature.featureId,
        current: currentFeature.roots,
        candidate: candidateFeature.roots,
      });
    }
    if (!sameStringArray(currentFeature.tables, candidateFeature.tables)) {
      operations.push({
        kind: "update-feature-tables",
        featureId: candidateFeature.featureId,
        current: currentFeature.tables,
        candidate: candidateFeature.tables,
      });
    }
  }

  for (const group of FILE_GROUP_KEYS) {
    const currentGroup = currentManifest.fileGroups[group];
    const candidateGroup = generated.manifest.fileGroups[group];
    if (!sameStringArray(currentGroup, candidateGroup)) {
      operations.push({
        kind: "update-file-groups",
        group,
        current: currentGroup,
        candidate: candidateGroup,
      });
    }
  }

  const currentGates = new Set(currentManifest.verificationGates.map((gate) => gate.gateId));
  for (const candidateGate of generated.manifest.verificationGates) {
    if (!currentGates.has(candidateGate.gateId)) {
      operations.push({
        kind: "add-verification-gate",
        gateId: candidateGate.gateId,
        candidate: candidateGate,
      });
    }
  }

  return {
    repoRoot: generated.repoRoot,
    manifestPath: generated.manifestPath,
    present: generated.present,
    valid: generated.valid,
    baseHash: current.manifest ? hashManifest(current.manifest) : ABSENT_MANIFEST_HASH,
    candidateHash: generated.candidateHash,
    operations: operations.sort(compareOperations),
    warnings: uniqueSorted([...generated.warnings, ...current.warnings]),
    blockers: generated.blockers,
  };
}

export function readDomainManifestSeederStatus(input: { repoRoot: string }): DomainManifestStatusResult {
  const diff = diffDomainManifestCandidate(input);
  const counts: Record<string, number> = {};
  for (const operation of diff.operations) {
    counts[operation.kind] = (counts[operation.kind] ?? 0) + 1;
  }
  return {
    repoRoot: diff.repoRoot,
    manifestPath: diff.manifestPath,
    present: diff.present,
    valid: diff.valid,
    ...(diff.present && diff.baseHash !== ABSENT_MANIFEST_HASH ? { currentHash: diff.baseHash } : {}),
    candidateHash: diff.candidateHash,
    pendingOperationCount: diff.operations.length,
    operationCounts: counts,
    warnings: diff.warnings,
    blockers: diff.blockers,
  };
}

export function applyDomainManifestCandidate(input: { repoRoot: string; baseHash: string }): DomainManifestApplyResult {
  const repoRoot = path.resolve(input.repoRoot);
  const diff = diffDomainManifestCandidate({ repoRoot });
  if (diff.blockers.length > 0) {
    throw new Error(`Cannot apply domain manifest candidate: ${diff.blockers.join(" ")}`);
  }
  if (input.baseHash !== diff.baseHash) {
    throw new Error(
      `Domain manifest base hash is stale: expected ${diff.baseHash}, received ${input.baseHash}. Re-run domain_manifest_diff before applying.`,
    );
  }

  const generated = generateDomainManifestCandidate({ repoRoot });
  const manifestPath = generated.manifestPath;
  assertRepoConfinedPath(repoRoot, manifestPath);
  mkdirSync(path.dirname(manifestPath), { recursive: true });

  const backupPath = existsSync(manifestPath)
    ? path.join(path.dirname(manifestPath), `domain-index.${Date.now()}.${randomUUID()}.bak.json`)
    : undefined;
  if (backupPath) {
    writeFileSync(backupPath, readFileSync(manifestPath, "utf8"));
  }

  const tempPath = path.join(path.dirname(manifestPath), `.domain-index.${process.pid}.${randomUUID()}.tmp`);
  const rendered = `${JSON.stringify(generated.manifest, null, 2)}\n`;
  try {
    JSON.parse(rendered);
    writeFileSync(tempPath, rendered);
    renameSync(tempPath, manifestPath);
  } finally {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
  }

  const written = readDomainIndexManifest({ repoRoot });
  if (!written.manifest) {
    throw new Error(`Domain manifest apply wrote an unreadable manifest: ${written.warnings.join(" ")}`);
  }

  return {
    repoRoot,
    manifestPath,
    baseHash: diff.baseHash,
    candidateHash: generated.candidateHash,
    appliedOperationCount: diff.operations.length,
    ...(backupPath ? { backupPath } : {}),
    manifest: written.manifest,
    warnings: uniqueSorted([...diff.warnings, ...written.warnings]),
  };
}

function inferFileGroups(
  repoFiles: string[],
  signals: { frameworkIds: string[]; routeFiles: string[] },
): DomainIndexFileGroups {
  const groups = { ...EMPTY_FILE_GROUPS };
  if (repoFiles.some((repoPath) => /^backend\/src\/modules\/[^/]+\/[^/]+Routes\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/i.test(repoPath))) {
    groups.routes.push("backend/src/modules/*/*Routes.ts");
  }
  if (repoFiles.some((repoPath) => /^server\/src\/modules\/[^/]+\/[^/]+Routes\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/i.test(repoPath))) {
    groups.routes.push("server/src/modules/*/*Routes.ts");
  }
  if (repoFiles.some((repoPath) => /^src\/modules\/[^/]+\/[^/]+Routes\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/i.test(repoPath))) {
    groups.routes.push("src/modules/*/*Routes.ts");
  }
  groups.routes.push(...routeGroupPatternsFromSignals(repoFiles, signals));
  if (repoFiles.some((repoPath) => /^src\/features\/[^/]+\/hooks\/use[^/]+\.(?:ts|tsx|js|jsx)$/i.test(repoPath))) {
    groups.hooks.push("src/features/*/hooks/use*.ts");
  }
  if (repoFiles.some((repoPath) => /^frontend\/src\/features\/[^/]+\/hooks\/use[^/]+\.(?:ts|tsx|js|jsx)$/i.test(repoPath))) {
    groups.hooks.push("frontend/src/features/*/hooks/use*.ts");
  }
  if (repoFiles.some((repoPath) => /^backend\/src\/modules\/.+Service\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/i.test(repoPath))) {
    groups.services.push("backend/src/modules/**/*Service.ts");
  }
  if (repoFiles.some((repoPath) => /^server\/src\/modules\/.+Service\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/i.test(repoPath))) {
    groups.services.push("server/src/modules/**/*Service.ts");
  }
  if (repoFiles.some((repoPath) => /^src\/features\/.+Service\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/i.test(repoPath))) {
    groups.services.push("src/features/**/*Service.ts");
  }
  if (repoFiles.some((repoPath) => /^migrations\/[^/]+\.sql$/i.test(repoPath))) {
    groups.migrations.push("migrations/*.sql");
  }
  if (repoFiles.some((repoPath) => /^db\/migrations\/[^/]+\.sql$/i.test(repoPath))) {
    groups.migrations.push("db/migrations/*.sql");
  }
  if (repoFiles.includes("public/api-docs/openapi.json")) {
    groups.openapi.push("public/api-docs/openapi.json");
  }
  if (repoFiles.includes("openapi.json")) {
    groups.openapi.push("openapi.json");
  }
  if (repoFiles.includes("swagger.json")) {
    groups.openapi.push("swagger.json");
  }
  if (repoFiles.some((repoPath) => /^docs\/conventions\/[^/]+\.md$/i.test(repoPath))) {
    groups.conventions.push("docs/conventions/*.md");
  }
  if (repoFiles.some((repoPath) => /^\.wormhole\/memory\/[^/]+\.md$/i.test(repoPath))) {
    groups.memory.push(".wormhole/memory/*.md");
  }
  return normalizeFileGroups(groups);
}

function selectRouteCandidateFiles(repoFiles: string[]): { files: string[]; warnings: string[] } {
  const candidates = repoFiles
    .filter((repoPath) => /\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/i.test(repoPath))
    .filter((repoPath) => !/\.d\.ts$/i.test(repoPath))
    .sort((left, right) => routeCandidateScore(right) - routeCandidateScore(left) || left.localeCompare(right));
  const files = candidates.slice(0, ROUTE_CANDIDATE_LIMIT).sort((left, right) => left.localeCompare(right));
  const warnings =
    candidates.length > ROUTE_CANDIDATE_LIMIT
      ? [
          `ROUTE_CANDIDATE_CAP: scanned ${ROUTE_CANDIDATE_LIMIT}/${candidates.length} JavaScript/TypeScript files for route seed evidence.`,
        ]
      : [];
  return { files, warnings };
}

function routeCandidateScore(repoPath: string): number {
  const normalized = repoPath.toLowerCase();
  let score = 0;
  if (/(^|\/)(routes?|controllers?|api)(\/|$)/.test(normalized)) score += 8;
  if (/(route|router|controller)\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(normalized)) score += 6;
  if (/(server|app|main|index)\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(normalized)) score += 4;
  if (normalized.includes("/src/")) score += 2;
  return score;
}

function routeGroupPatternsFromSignals(
  repoFiles: string[],
  signals: { frameworkIds: string[]; routeFiles: string[] },
): string[] {
  const patterns = new Set<string>();
  const routeFiles = uniqueSorted(signals.routeFiles);
  const frameworkIds = new Set(signals.frameworkIds);

  for (const routeFile of routeFiles) {
    const routeDirectory = routeDirectoryPattern(routeFile);
    if (routeDirectory) {
      patterns.add(routeDirectory);
      continue;
    }
    const modulePattern = moduleRoutePattern(routeFile);
    if (modulePattern) {
      patterns.add(modulePattern);
    }
  }

  if (frameworkIds.has("express") || frameworkIds.has("fastify") || frameworkIds.has("nestjs")) {
    for (const prefix of ["src", "server/src", "backend/src", "app"]) {
      if (repoFiles.some((repoPath) => repoPath.startsWith(`${prefix}/routes/`))) {
        patterns.add(`${prefix}/routes/**/*.ts`);
      }
      if (repoFiles.some((repoPath) => repoPath.startsWith(`${prefix}/controllers/`))) {
        patterns.add(`${prefix}/controllers/**/*.ts`);
      }
    }
  }

  if (routeFiles.length > 0 && patterns.size === 0 && routeFiles.length <= 20) {
    for (const routeFile of routeFiles) {
      patterns.add(routeFile);
    }
  }

  return [...patterns];
}

function routeDirectoryPattern(repoPath: string): string | undefined {
  const segments = repoPath.split("/");
  const routeIndex = segments.findIndex((segment) => /^(routes?|controllers?|api)$/i.test(segment));
  if (routeIndex < 0) {
    return undefined;
  }
  const extension = path.extname(repoPath) || ".ts";
  return `${segments.slice(0, routeIndex + 1).join("/")}/**/*${extension}`;
}

function moduleRoutePattern(repoPath: string): string | undefined {
  const basename = path.basename(repoPath);
  const extension = path.extname(repoPath) || ".ts";
  if (!/(routes?|router|controller)/i.test(basename)) {
    return undefined;
  }
  const directory = path.posix.dirname(repoPath);
  const stem = basename.slice(0, -extension.length);
  if (/routes$/i.test(stem)) {
    return `${directory}/*Routes${extension}`;
  }
  if (/controller$/i.test(stem)) {
    return `${directory}/*Controller${extension}`;
  }
  return `${directory}/${basename}`;
}

function mergeFileGroups(current: DomainIndexFileGroups, inferred: DomainIndexFileGroups): DomainIndexFileGroups {
  return normalizeFileGroups({
    routes: [...current.routes, ...inferred.routes],
    hooks: [...current.hooks, ...inferred.hooks],
    services: [...current.services, ...inferred.services],
    migrations: [...current.migrations, ...inferred.migrations],
    openapi: [...current.openapi, ...inferred.openapi],
    conventions: [...current.conventions, ...inferred.conventions],
    memory: [...current.memory, ...inferred.memory],
  });
}

function normalizeFileGroups(groups: DomainIndexFileGroups): DomainIndexFileGroups {
  return {
    routes: uniqueSorted(groups.routes),
    hooks: uniqueSorted(groups.hooks),
    services: uniqueSorted(groups.services),
    migrations: uniqueSorted(groups.migrations),
    openapi: uniqueSorted(groups.openapi),
    conventions: uniqueSorted(groups.conventions),
    memory: uniqueSorted(groups.memory),
  };
}

function listRepoFiles(repoRoot: string): string[] {
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    return [];
  }
  const files: string[] = [];
  const queue = [repoRoot];
  while (queue.length > 0 && files.length < 50_000) {
    const directory = queue.shift();
    if (!directory) {
      break;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const repoPath = toRepoPath(path.relative(repoRoot, absolutePath));
      if (entry.isDirectory()) {
        if (shouldEnterDirectory(repoPath, entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }
      if (entry.isFile()) {
        files.push(repoPath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function shouldEnterDirectory(repoPath: string, name: string): boolean {
  if (repoPath === ".wormhole" || repoPath.startsWith(".wormhole/memory")) {
    return true;
  }
  return !IGNORED_DIRECTORIES.has(name);
}

function emptyManifest(): DomainIndexManifest {
  return {
    schemaVersion: "domain-index.v0",
    features: [],
    fileGroups: { ...EMPTY_FILE_GROUPS },
    verificationGates: [],
  };
}

function cloneFeature(feature: DomainIndexFeatureConfig): DomainIndexFeatureConfig {
  return {
    featureId: feature.featureId,
    displayName: feature.displayName,
    aliases: [...feature.aliases],
    roots: [...feature.roots],
    portals: [...feature.portals],
    tables: [...feature.tables],
  };
}

function cloneVerificationGate(gate: DomainIndexVerificationGateConfig): DomainIndexVerificationGateConfig {
  return {
    gateId: gate.gateId,
    scriptNames: [...gate.scriptNames],
    whenFeatureTouches: [...gate.whenFeatureTouches] as FeatureSideEffect[],
  };
}

function createAliasMap(features: DomainIndexFeatureConfig[]): Map<string, string> {
  const aliasMap = new Map<string, string>();
  for (const feature of features) {
    aliasMap.set(feature.featureId, feature.featureId);
    for (const alias of feature.aliases) {
      aliasMap.set(alias, feature.featureId);
    }
  }
  return aliasMap;
}

function canonicalFeatureId(
  featureId: string,
  input: {
    aliasToFeatureId: Map<string, string>;
    currentFeatureIds: Set<string>;
    genericFeatureIds: Set<string>;
    canonicalFeatureIds: Set<string>;
  },
): string {
  const aliasTarget = input.aliasToFeatureId.get(featureId);
  if (aliasTarget) {
    return aliasTarget;
  }
  for (const variant of pluralVariants(featureId)) {
    if (input.currentFeatureIds.has(variant) || input.genericFeatureIds.has(variant) || input.canonicalFeatureIds.has(variant)) {
      return variant;
    }
  }
  return featureId;
}

function pluralVariants(featureId: string): string[] {
  if (featureId.endsWith("s")) {
    return [];
  }
  const variants = [`${featureId}s`];
  if (featureId.endsWith("y") && featureId.length > 1) {
    variants.push(`${featureId.slice(0, -1)}ies`);
  }
  if (/(?:s|x|z|ch|sh)$/.test(featureId)) {
    variants.push(`${featureId}es`);
  }
  return variants;
}

function rootBelongsToFeature(root: string, featureId: string): boolean {
  const normalizedFeature = normalizeFeatureId(featureId);
  return root
    .split("/")
    .map(normalizeFeatureId)
    .some((segment) => segment === normalizedFeature);
}

function hashManifest(manifest: DomainIndexManifest): string {
  return hashText(stableStringify(manifest));
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareByFeatureId(left: DomainIndexFeatureConfig, right: DomainIndexFeatureConfig): number {
  return left.featureId.localeCompare(right.featureId);
}

function compareByGateId(
  left: DomainIndexVerificationGateConfig,
  right: DomainIndexVerificationGateConfig,
): number {
  return left.gateId.localeCompare(right.gateId);
}

function compareOperations(left: DomainManifestDiffOperation, right: DomainManifestDiffOperation): number {
  const leftKey = operationSortKey(left);
  const rightKey = operationSortKey(right);
  return leftKey.localeCompare(rightKey);
}

function operationSortKey(operation: DomainManifestDiffOperation): string {
  if ("featureId" in operation && operation.featureId) {
    return `${operation.kind}:${operation.featureId}`;
  }
  if ("group" in operation && operation.group) {
    return `${operation.kind}:${operation.group}`;
  }
  if ("gateId" in operation && operation.gateId) {
    return `${operation.kind}:${operation.gateId}`;
  }
  return operation.kind;
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function titleCase(featureId: string): string {
  return featureId
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeFeatureId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function assertRepoConfinedPath(repoRoot: string, targetPath: string): void {
  const relative = path.relative(repoRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside repo root: ${targetPath}`);
  }
}
