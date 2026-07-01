import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { detectProjectContract, type ProjectContract } from "./project-contract.js";
import {
  buildRepoIndex,
  createRepoIndexCacheKey,
  createRepoIndexHealth,
  isRepoIndexFresh,
  type RepoIndex,
  type RepoIndexBuildOptions,
  type RepoIndexEdge,
  type RepoIndexSymbol,
} from "./repo-index.js";
import type { IndexHealthSnapshot } from "./index-health.js";
import { classifySourceProvenance } from "./source-authority.js";
import { analyzeChangeImpact } from "./change-impact.js";
import { analyzeTestImpactV2, type TestImpactV2Result } from "./test-impact-v2.js";

export type ProjectObservationKind =
  | "source"
  | "repo_index"
  | "project_contract"
  | "codeowners"
  | "derived";

export type ProjectObservationEvidence = {
  sourceType: ProjectObservationKind;
  sourcePath?: string;
  lineStart?: number;
  lineEnd?: number;
  summary: string;
  confidence: number;
};

export type ArchitectureModule = {
  moduleId: string;
  name: string;
  rootPath: string;
  fileCount: number;
  symbolCount: number;
  entrypointCount: number;
  testCount: number;
  owners: string[];
  dependencies: string[];
  dependents: string[];
  evidence: ProjectObservationEvidence[];
};

export type ArchitectureMap = {
  repoRoot: string;
  generatedAt: string;
  fingerprint: string;
  indexHealth: IndexHealthSnapshot;
  summary: {
    moduleCount: number;
    fileCount: number;
    symbolCount: number;
    entrypointCount: number;
  };
  modules: ArchitectureModule[];
};

export type EntrypointKind = "api" | "cli" | "worker" | "script";

export type EntrypointFlow = {
  entrypointId: string;
  kind: EntrypointKind;
  name: string;
  path: string;
  command?: string;
  symbol?: string;
  downstreamFiles: string[];
  moduleRoot: string;
  evidence: ProjectObservationEvidence[];
};

export type EntrypointFlowDiscovery = {
  repoRoot: string;
  generatedAt: string;
  fingerprint: string;
  entrypoints: EntrypointFlow[];
};

export type BlastRadiusFile = {
  path: string;
  moduleRoot: string;
  reasons: string[];
  confidence: number;
  relationPath?: string[];
};

export type BlastRadiusAnalysis = {
  repoRoot: string;
  generatedAt: string;
  fingerprint: string;
  indexHealth: IndexHealthSnapshot;
  changedFiles: string[];
  changedSymbols: RepoIndexSymbol[];
  impactedFiles: BlastRadiusFile[];
  impactedModules: string[];
  impactedEntrypoints: EntrypointFlow[];
  verification: {
    likelyTests: TestImpactV2Result["likelyTests"];
    riskLevel: TestImpactV2Result["riskLevel"];
    reasons: string[];
  };
  evidence: ProjectObservationEvidence[];
};

export type ProjectContextPack = {
  packId: string;
  repoRoot: string;
  objective: string;
  query: string;
  indexHealth: IndexHealthSnapshot;
  sources: string[];
  rendered: string;
  stats: {
    sourceCount: number;
    charBudget: number;
    renderedChars: number;
    omittedSourceCount: number;
  };
};

export type ProjectModel = {
  repoRoot: string;
  index: RepoIndex;
  contract: ProjectContract;
  ownership: OwnershipRule[];
};

type OwnershipRule = {
  pattern: string;
  owners: string[];
  sourcePath: string;
  line: number;
};

export type ProjectModelCacheStats = {
  entries: number;
  derivedEntries: number;
  hits: number;
  misses: number;
  refreshes: number;
  stale: number;
  derivedHits: number;
  derivedMisses: number;
};

export type ProjectModelDerivedCacheInput<T> = {
  repoRoot: string;
  kind: string;
  keyParts?: readonly string[];
  indexOptions?: Omit<RepoIndexBuildOptions, "repoRoot">;
  create: (model: ProjectModel) => T;
};

export type ProjectModelCache = {
  get(input: {
    repoRoot: string;
    indexOptions?: Omit<RepoIndexBuildOptions, "repoRoot">;
  }): ProjectModel;
  getDerived<T>(input: ProjectModelDerivedCacheInput<T>): T;
  delete(repoRoot: string): void;
  clear(): void;
  stats(): ProjectModelCacheStats;
};

export type ProjectModelCacheOptions = {
  maxEntries?: number;
  maxDerivedEntries?: number;
  freshnessTtlMs?: number;
  indexBuilder?: (options: RepoIndexBuildOptions) => RepoIndex;
};

export type ProjectModelCacheInput = {
  projectModelCache?: ProjectModelCache;
  indexOptions?: Omit<RepoIndexBuildOptions, "repoRoot">;
  preferredSources?: string[];
};

export function createProjectModelCache(options: ProjectModelCacheOptions = {}): ProjectModelCache {
  const maxEntries = options.maxEntries ?? 8;
  const maxDerivedEntries = options.maxDerivedEntries ?? maxEntries * 12;
  const freshnessTtlMs = options.freshnessTtlMs ?? 30_000;
  const indexBuilder = options.indexBuilder ?? buildRepoIndex;
  const entries = new Map<string, { model: ProjectModel; lastFreshCheckMs: number }>();
  const derivedEntries = new Map<string, { repoRoot: string; value: unknown }>();
  const stats: Omit<ProjectModelCacheStats, "entries" | "derivedEntries"> = {
    hits: 0,
    misses: 0,
    refreshes: 0,
    stale: 0,
    derivedHits: 0,
    derivedMisses: 0,
  };

  function evictOldestModel(): void {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      entries.delete(oldestKey);
    }
  }

  function evictOldestDerived(): void {
    while (derivedEntries.size > maxDerivedEntries) {
      const oldestKey = derivedEntries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      derivedEntries.delete(oldestKey);
    }
  }

  function deleteDerivedForRepo(repoRoot: string): void {
    for (const [key, entry] of derivedEntries) {
      if (entry.repoRoot === repoRoot) {
        derivedEntries.delete(key);
      }
    }
  }

  function get(input: {
    repoRoot: string;
    indexOptions?: Omit<RepoIndexBuildOptions, "repoRoot">;
  }): ProjectModel {
    const repoRoot = path.resolve(input.repoRoot);
    const indexOptions = { ...(input.indexOptions ?? {}), repoRoot };
    const cacheKey = createRepoIndexCacheKey(indexOptions);
    const now = Date.now();
    const existing = entries.get(cacheKey);
    if (existing) {
      const shouldCheckFreshness =
        freshnessTtlMs <= 0 || now - existing.lastFreshCheckMs >= freshnessTtlMs;
      if (!shouldCheckFreshness || isRepoIndexFresh(existing.model.index)) {
        existing.lastFreshCheckMs = shouldCheckFreshness ? now : existing.lastFreshCheckMs;
        stats.hits += 1;
        return existing.model;
      }
      stats.stale += 1;
      entries.delete(cacheKey);
      deleteDerivedForRepo(repoRoot);
    }

    stats.misses += 1;
    stats.refreshes += 1;
    const model = createProjectModel(repoRoot, input.indexOptions, indexBuilder);
    entries.set(cacheKey, { model, lastFreshCheckMs: now });
    evictOldestModel();
    return model;
  }

  return {
    get,
    getDerived<T>(input: ProjectModelDerivedCacheInput<T>): T {
      const model = get({
        repoRoot: input.repoRoot,
        indexOptions: input.indexOptions,
      });
      const cacheKey = JSON.stringify({
        repoRoot: model.repoRoot,
        fingerprint: model.index.fingerprint,
        kind: input.kind,
        keyParts: input.keyParts ?? [],
      });
      const existing = derivedEntries.get(cacheKey);
      if (existing) {
        stats.derivedHits += 1;
        return existing.value as T;
      }

      stats.derivedMisses += 1;
      const value = input.create(model);
      derivedEntries.set(cacheKey, { repoRoot: model.repoRoot, value });
      evictOldestDerived();
      return value;
    },
    delete(repoRootInput) {
      const repoRoot = path.resolve(repoRootInput);
      for (const [key, entry] of entries) {
        if (entry.model.repoRoot === repoRoot) {
          entries.delete(key);
        }
      }
      deleteDerivedForRepo(repoRoot);
    },
    clear() {
      entries.clear();
      derivedEntries.clear();
    },
    stats() {
      return { entries: entries.size, derivedEntries: derivedEntries.size, ...stats };
    },
  };
}

export function createArchitectureMap(input: { repoRoot: string } & ProjectModelCacheInput): ArchitectureMap {
  if (input.projectModelCache) {
    return input.projectModelCache.getDerived({
      repoRoot: input.repoRoot,
      indexOptions: input.indexOptions,
      kind: "architecture_map",
      create: createArchitectureMapFromModel,
    });
  }
  return createArchitectureMapFromModel(getProjectModel(input));
}

function createArchitectureMapFromModel(model: ProjectModel): ArchitectureMap {
  const entrypoints = discoverEntrypointFlowsFromModel(model).entrypoints;
  const entrypointCounts = countEntrypointsByModule(entrypoints);
  const modules = new Map<string, ArchitectureModule>();

  for (const file of model.index.files) {
    const rootPath = moduleRootFor(file.path);
    const existing = modules.get(rootPath) ?? {
      moduleId: `module:${rootPath}`,
      name: rootPath,
      rootPath,
      fileCount: 0,
      symbolCount: 0,
      entrypointCount: 0,
      testCount: 0,
      owners: ownersForPath(model.ownership, file.path),
      dependencies: [],
      dependents: [],
      evidence: [],
    };
    existing.fileCount += 1;
    existing.symbolCount += file.symbols.length;
    existing.testCount += isTestPath(file.path) ? 1 : 0;
    existing.entrypointCount = entrypointCounts.get(rootPath) ?? existing.entrypointCount;
    existing.owners = uniqueSorted([...existing.owners, ...ownersForPath(model.ownership, file.path)]);
    existing.evidence.push({
      sourceType: "source",
      sourcePath: file.path,
      lineStart: 1,
      lineEnd: Math.max(1, file.lineCount),
      summary: `Module ${rootPath} includes ${file.path}.`,
      confidence: 1,
    });
    modules.set(rootPath, existing);
  }

  for (const edge of model.index.edges) {
    const fromPath = fileForNode(edge.from);
    const toPath = fileForNode(edge.to);
    if (!fromPath || !toPath || fromPath === toPath) {
      continue;
    }
    const fromRoot = moduleRootFor(fromPath);
    const toRoot = moduleRootFor(toPath);
    if (fromRoot === toRoot) {
      continue;
    }
    const fromModule = modules.get(fromRoot);
    const toModule = modules.get(toRoot);
    if (!fromModule || !toModule) {
      continue;
    }
    fromModule.dependencies = uniqueSorted([...fromModule.dependencies, toRoot]);
    toModule.dependents = uniqueSorted([...toModule.dependents, fromRoot]);
  }

  for (const module of modules.values()) {
    const ownershipEvidence = ownershipEvidenceForModule(model.ownership, module.rootPath);
    module.evidence = [
      ...ownershipEvidence,
      ...module.evidence.slice(0, 5),
      {
        sourceType: "repo_index",
        summary: `Repo index found ${module.fileCount} files and ${module.symbolCount} symbols in ${module.rootPath}.`,
        confidence: 0.9,
      },
    ];
  }

  const sortedModules = [...modules.values()].sort((left, right) =>
    left.rootPath.localeCompare(right.rootPath),
  );
  return {
    repoRoot: model.repoRoot,
    generatedAt: new Date().toISOString(),
    fingerprint: model.index.fingerprint,
    indexHealth: createRepoIndexHealth(model.index),
    summary: {
      moduleCount: sortedModules.length,
      fileCount: model.index.files.length,
      symbolCount: model.index.symbols.length,
      entrypointCount: entrypoints.length,
    },
    modules: sortedModules,
  };
}

export function discoverEntrypointFlows(input: { repoRoot: string } & ProjectModelCacheInput): EntrypointFlowDiscovery {
  if (input.projectModelCache) {
    return input.projectModelCache.getDerived({
      repoRoot: input.repoRoot,
      indexOptions: input.indexOptions,
      kind: "entrypoint_flows",
      create: discoverEntrypointFlowsFromModel,
    });
  }
  return discoverEntrypointFlowsFromModel(getProjectModel(input));
}

export function analyzeBlastRadius(input: {
  repoRoot: string;
  changedFiles: string[];
  diffText?: string;
} & ProjectModelCacheInput): BlastRadiusAnalysis {
  const changedFiles = uniqueSorted(input.changedFiles.map(toRepoPath));
  if (input.projectModelCache) {
    return input.projectModelCache.getDerived({
      repoRoot: input.repoRoot,
      indexOptions: input.indexOptions,
      kind: "blast_radius",
      keyParts: [
        ...changedFiles,
        input.diffText ? `diff:${hashParts([input.diffText])}` : "diff:",
      ],
      create: (model) =>
        analyzeBlastRadiusFromModel(model, {
          changedFiles,
          diffText: input.diffText,
          projectModelCache: input.projectModelCache,
          indexOptions: input.indexOptions,
        }),
    });
  }
  return analyzeBlastRadiusFromModel(getProjectModel(input), {
    changedFiles,
    diffText: input.diffText,
  });
}

function analyzeBlastRadiusFromModel(
  model: ProjectModel,
  input: {
    changedFiles: string[];
    diffText?: string;
  } & ProjectModelCacheInput,
): BlastRadiusAnalysis {
  const changedFiles = uniqueSorted(input.changedFiles.map(toRepoPath));
  const changedSet = new Set(changedFiles);
  const changedNodeIds = new Set<string>(changedFiles);
  const impact = analyzeTestImpactV2({
    repoRoot: model.repoRoot,
    changedFiles,
    diffText: input.diffText,
    index: model.index,
  });
  const relationImpact = analyzeChangeImpact({
    repoRoot: model.repoRoot,
    changedFiles,
    diffText: input.diffText,
    index: model.index,
  });
  for (const symbol of impact.changedSymbols) {
    changedNodeIds.add(symbol.id);
  }

  const impacted = new Map<string, BlastRadiusFile>();
  for (const edge of model.index.edges) {
    const fromPath = fileForNode(edge.from);
    const toPath = fileForNode(edge.to);
    if (!fromPath || !toPath || changedSet.has(fromPath)) {
      continue;
    }
    if (!changedSet.has(toPath) && !changedNodeIds.has(edge.to)) {
      continue;
    }
    addImpactedFile(impacted, fromPath, reasonForEdge(edge), edge.confidence);
  }

  for (const test of impact.likelyTests) {
    addImpactedFile(impacted, test.path, test.reason, test.confidence);
  }

  for (const file of relationImpact.impactedFiles) {
    addImpactedFile(impacted, file.path, file.reason, file.confidence, file.relationPath);
  }

  for (const test of relationImpact.impactedTests) {
    addImpactedFile(impacted, test.path, test.reason, test.confidence, test.relationPath);
  }

  const entrypoints = input.projectModelCache
    ? discoverEntrypointFlows({
        repoRoot: model.repoRoot,
        projectModelCache: input.projectModelCache,
        indexOptions: input.indexOptions,
      }).entrypoints
    : discoverEntrypointFlowsFromModel(model).entrypoints;
  const impactedEntrypoints = entrypoints.filter(
    (entrypoint) =>
      changedSet.has(entrypoint.path) ||
      impacted.has(entrypoint.path) ||
      entrypoint.downstreamFiles.some((file) => changedSet.has(file)),
  );
  for (const entrypoint of impactedEntrypoints) {
    if (!changedSet.has(entrypoint.path)) {
      addImpactedFile(
        impacted,
        entrypoint.path,
        `Entrypoint ${entrypoint.name} depends on changed code.`,
        0.85,
      );
    }
  }

  const impactedFiles = [...impacted.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  return {
    repoRoot: model.repoRoot,
    generatedAt: new Date().toISOString(),
    fingerprint: model.index.fingerprint,
    indexHealth: createRepoIndexHealth(model.index),
    changedFiles,
    changedSymbols: impact.changedSymbols,
    impactedFiles,
    impactedModules: uniqueSorted(impactedFiles.map((file) => file.moduleRoot)),
    impactedEntrypoints,
    verification: {
      likelyTests: impact.likelyTests,
      riskLevel: relationImpact.riskLevel,
      reasons: uniqueSorted([...impact.reasons, ...relationImpact.warnings]),
    },
    evidence: [
      {
        sourceType: "repo_index",
        summary: "Blast radius was derived from repo index inbound references, imports, and call edges.",
        confidence: 0.85,
      },
      ...changedFiles.map((changedFile) => ({
        sourceType: "source" as const,
        sourcePath: changedFile,
        summary: `Changed file ${changedFile}.`,
        confidence: 1,
      })),
    ],
  };
}

export function generateProjectContextPack(input: {
  repoRoot: string;
  objective: string;
  query: string;
  changedFiles?: string[];
  maxChars: number;
} & ProjectModelCacheInput): ProjectContextPack {
  const changedFiles = uniqueSorted((input.changedFiles ?? []).map(toRepoPath));
  const preferredSources = uniqueSorted((input.preferredSources ?? []).map(toRepoPath));
  if (input.projectModelCache) {
    return input.projectModelCache.getDerived({
      repoRoot: input.repoRoot,
      indexOptions: input.indexOptions,
      kind: "context_pack",
      keyParts: [
        input.objective,
        input.query,
        String(input.maxChars),
        JSON.stringify(input.indexOptions ?? {}),
        ...changedFiles,
        ...preferredSources.map((source) => `preferred:${source}`),
      ],
      create: (model) =>
        generateProjectContextPackFromModel(
          model,
          {
            objective: input.objective,
            query: input.query,
            changedFiles,
            preferredSources,
            maxChars: input.maxChars,
          },
          input.projectModelCache,
          input.indexOptions,
        ),
    });
  }
  return generateProjectContextPackFromModel(getProjectModel(input), {
    objective: input.objective,
    query: input.query,
    changedFiles,
    preferredSources,
    maxChars: input.maxChars,
  });
}

function generateProjectContextPackFromModel(
  model: ProjectModel,
  input: {
    objective: string;
    query: string;
    changedFiles: string[];
    preferredSources: string[];
    maxChars: number;
  },
  projectModelCache?: ProjectModelCache,
  indexOptions?: Omit<RepoIndexBuildOptions, "repoRoot">,
): ProjectContextPack {
  const architecture = projectModelCache
    ? createArchitectureMap({ repoRoot: model.repoRoot, projectModelCache, indexOptions })
    : createArchitectureMapFromModel(model);
  const entrypoints = projectModelCache
    ? discoverEntrypointFlows({ repoRoot: model.repoRoot, projectModelCache, indexOptions })
    : discoverEntrypointFlowsFromModel(model);
  const blast =
    input.changedFiles.length > 0
      ? projectModelCache
        ? analyzeBlastRadius({
            repoRoot: model.repoRoot,
            changedFiles: input.changedFiles,
            projectModelCache,
            indexOptions,
          })
        : analyzeBlastRadiusFromModel(model, {
            changedFiles: input.changedFiles,
          })
      : undefined;
  const sources = selectContextSources(model, input.query, input.changedFiles, input.preferredSources, blast);
  const rendered = clampToBudget(
    renderProjectContextPack({
      objective: input.objective,
      query: input.query,
      indexHealth: createRepoIndexHealth(model.index),
      architecture,
      entrypoints,
      blast,
      files: sources.map((source) => ({
        path: source,
        content: readRepoFile(model.repoRoot, source),
      })),
    }),
    input.maxChars,
  );
  return {
    packId: `project-context:${hashParts([
      model.index.fingerprint,
      input.objective,
      input.query,
      String(input.maxChars),
      ...sources,
    ])}`,
    repoRoot: model.repoRoot,
    objective: input.objective,
    query: input.query,
    indexHealth: createRepoIndexHealth(model.index),
    sources,
    rendered,
    stats: {
      sourceCount: sources.length,
      charBudget: input.maxChars,
      renderedChars: rendered.length,
      omittedSourceCount: Math.max(0, model.index.files.length - sources.length),
    },
  };
}

function getProjectModel(input: { repoRoot: string } & ProjectModelCacheInput): ProjectModel {
  if (input.projectModelCache) {
    return input.projectModelCache.get({
      repoRoot: input.repoRoot,
      indexOptions: input.indexOptions,
    });
  }
  return createProjectModel(input.repoRoot, input.indexOptions);
}

function createProjectModel(
  repoRootInput: string,
  indexOptions?: Omit<RepoIndexBuildOptions, "repoRoot">,
  indexBuilder: (options: RepoIndexBuildOptions) => RepoIndex = buildRepoIndex,
): ProjectModel {
  const repoRoot = path.resolve(repoRootInput);
  const index = indexBuilder({ ...(indexOptions ?? {}), repoRoot });
  return {
    repoRoot,
    index,
    contract: detectProjectContract({ repoRoot }),
    ownership: readOwnershipRules(repoRoot),
  };
}

function discoverEntrypointFlowsFromModel(model: ProjectModel): EntrypointFlowDiscovery {
  const entrypoints: EntrypointFlow[] = [];
  const fileAdjacency = fileAdjacencyFor(model.index);
  for (const script of model.contract.scripts) {
    if (isEntrypointScript(script.name, script.command)) {
      entrypoints.push({
        entrypointId: `entrypoint:script:${script.name}`,
        kind: "script",
        name: script.name,
        path: "package.json",
        command: script.command,
        downstreamFiles: downstreamFilesForScript(model.index, script),
        moduleRoot: ".",
        evidence: [
          {
            sourceType: "project_contract",
            sourcePath: "package.json",
            summary: `Package script ${script.name} runs "${script.command}".`,
            confidence: 1,
          },
        ],
      });
    }
  }

  for (const file of model.index.files) {
    const kind = entrypointKindForFile(file.path, file.content);
    if (!kind) {
      continue;
    }
    const symbol = primarySymbolForEntrypoint(file.symbols, kind);
    entrypoints.push({
      entrypointId: `entrypoint:${kind}:${file.path}`,
      kind,
      name: symbol?.name ?? path.basename(file.path).replace(/\.[^.]+$/, ""),
      path: file.path,
      symbol: symbol?.name,
      downstreamFiles: downstreamFilesFor(fileAdjacency, file.path),
      moduleRoot: moduleRootFor(file.path),
      evidence: [
        {
          sourceType: "source",
          sourcePath: file.path,
          lineStart: symbol?.line ?? 1,
          lineEnd: symbol?.line ?? 1,
          summary: `${kind} entrypoint detected in ${file.path}.`,
          confidence: kind === "api" ? 0.85 : 0.8,
        },
      ],
    });
  }

  return {
    repoRoot: model.repoRoot,
    generatedAt: new Date().toISOString(),
    fingerprint: model.index.fingerprint,
    entrypoints: entrypoints.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind.localeCompare(right.kind);
      }
      return left.path.localeCompare(right.path);
    }),
  };
}

function readOwnershipRules(repoRoot: string): OwnershipRule[] {
  const candidates = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"];
  const rules: OwnershipRule[] = [];
  for (const sourcePath of candidates) {
    const absolutePath = path.join(repoRoot, sourcePath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const clean = lines[index]?.replace(/\s+#.*$/, "").trim();
      if (!clean || clean.startsWith("#")) {
        continue;
      }
      const [pattern, ...owners] = clean.split(/\s+/);
      if (!pattern || owners.length === 0) {
        continue;
      }
      rules.push({ pattern, owners, sourcePath, line: index + 1 });
    }
  }
  return rules;
}

function ownersForPath(rules: OwnershipRule[], repoPath: string): string[] {
  return uniqueSorted(
    rules
      .filter((rule) => codeownersPatternMatches(rule.pattern, repoPath))
      .flatMap((rule) => rule.owners),
  );
}

function ownershipEvidenceForModule(
  rules: OwnershipRule[],
  moduleRoot: string,
): ProjectObservationEvidence[] {
  return rules
    .filter((rule) => codeownersPatternMatches(rule.pattern, `${moduleRoot}/index.ts`))
    .map((rule) => ({
      sourceType: "codeowners" as const,
      sourcePath: rule.sourcePath,
      lineStart: rule.line,
      lineEnd: rule.line,
      summary: `${rule.pattern} is owned by ${rule.owners.join(", ")}.`,
      confidence: 1,
    }));
}

function codeownersPatternMatches(patternInput: string, repoPath: string): boolean {
  const pattern = patternInput.replace(/^\//, "").replace(/\*+$/, "");
  if (!pattern) {
    return false;
  }
  if (pattern.endsWith("/")) {
    return repoPath.startsWith(pattern);
  }
  return repoPath === pattern || repoPath.startsWith(`${pattern}/`);
}

function countEntrypointsByModule(entrypoints: EntrypointFlow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entrypoint of entrypoints) {
    counts.set(entrypoint.moduleRoot, (counts.get(entrypoint.moduleRoot) ?? 0) + 1);
  }
  return counts;
}

function entrypointKindForFile(repoPath: string, content: string): EntrypointKind | undefined {
  const normalized = repoPath.toLowerCase();
  if (
    /(^|\/)(api|routes|controllers)\//.test(normalized) ||
    /\b(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/.test(content) ||
    /\bregister[A-Za-z0-9_]*Routes\s*\(/.test(content)
  ) {
    return "api";
  }
  if (
    normalized.endsWith("/cli.ts") ||
    normalized.endsWith("/cli.js") ||
    normalized.includes("/commands/") ||
    content.startsWith("#!/usr/bin/env node")
  ) {
    return "cli";
  }
  if (
    /(^|\/)(worker|workers|jobs|queues|cron)(\/|\.|-)/.test(normalized) ||
    /\b(worker|queue|job|cron)\b/i.test(path.basename(repoPath)) ||
    /\b(runWorker|processJob|consumeQueue)\s*\(/.test(content)
  ) {
    return "worker";
  }
  return undefined;
}

function isEntrypointScript(name: string, command: string): boolean {
  return /^(start|dev|serve|worker|job|queue|cli|build|test)$/.test(name) || /\b(node|tsx|vite|vitest)\b/.test(command);
}

function primarySymbolForEntrypoint(
  symbols: RepoIndexSymbol[],
  kind: EntrypointKind,
): RepoIndexSymbol | undefined {
  const candidates = {
    api: /route|handler|server|register/i,
    cli: /main|cli|command/i,
    worker: /worker|job|queue|run/i,
    script: /.*/,
  } satisfies Record<EntrypointKind, RegExp>;
  return symbols.find((symbol) => candidates[kind].test(symbol.name)) ?? symbols[0];
}

function downstreamFilesForScript(
  index: RepoIndex,
  script: ProjectContract["scripts"][number],
): string[] {
  const tokens = script.command
    .split(/[^A-Za-z0-9_./-]+/)
    .map((token) => token.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"));
  return uniqueSorted(
    index.files
      .filter((file) => tokens.some((token) => token === file.path || token.endsWith(file.path)))
      .map((file) => file.path),
  );
}

function fileAdjacencyFor(index: RepoIndex): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of index.edges) {
    const fromPath = fileForNode(edge.from);
    const toPath = fileForNode(edge.to);
    if (!fromPath || !toPath || fromPath === toPath) {
      continue;
    }
    const targets = adjacency.get(fromPath) ?? new Set<string>();
    targets.add(toPath);
    adjacency.set(fromPath, targets);
  }
  return adjacency;
}

function downstreamFilesFor(adjacency: Map<string, Set<string>>, repoPath: string): string[] {
  const seen = new Set<string>();
  const queue = [...(adjacency.get(repoPath) ?? [])].map((file) => ({ file, depth: 1 }));
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current || seen.has(current.file) || current.depth > 3) {
      continue;
    }
    seen.add(current.file);
    for (const next of adjacency.get(current.file) ?? []) {
      queue.push({ file: next, depth: current.depth + 1 });
    }
  }
  return uniqueSorted([...seen]);
}

function addImpactedFile(
  impacted: Map<string, BlastRadiusFile>,
  repoPath: string,
  reason: string,
  confidence: number,
  relationPath?: string[],
): void {
  const existing = impacted.get(repoPath) ?? {
    path: repoPath,
    moduleRoot: moduleRootFor(repoPath),
    reasons: [],
    confidence: 0,
  };
  existing.reasons = uniqueSorted([...existing.reasons, reason]);
  existing.confidence = Math.max(existing.confidence, confidence);
  if (relationPath && relationPath.length > 0) {
    existing.relationPath = uniqueSorted([...(existing.relationPath ?? []), ...relationPath]);
  }
  impacted.set(repoPath, existing);
}

function reasonForEdge(edge: RepoIndexEdge): string {
  if (edge.kind === "imports") {
    return `Imports changed file via ${edge.label ?? "local import"}.`;
  }
  if (edge.kind === "calls") {
    return `Calls changed symbol ${edge.label ?? edge.to}.`;
  }
  if (edge.kind === "references") {
    return `References changed symbol ${edge.label ?? edge.to}.`;
  }
  return `Related through ${edge.kind} edge.`;
}

function selectContextSources(
  model: ProjectModel,
  query: string,
  changedFiles: string[],
  preferredSources: string[],
  blast: BlastRadiusAnalysis | undefined,
): string[] {
  const selected = new Set<string>();
  const ordered: string[] = [];
  function add(source: string): void {
    const normalized = toRepoPath(source);
    if (selected.has(normalized)) {
      return;
    }
    selected.add(normalized);
    ordered.push(normalized);
  }
  for (const source of changedFiles) {
    add(source);
  }
  const changedSet = new Set(changedFiles.map(toRepoPath));
  for (const edge of model.index.edges) {
    const fromPath = fileForNode(edge.from);
    const toPath = fileForNode(edge.to);
    if (!fromPath || !toPath || !changedSet.has(fromPath) || fromPath === toPath) {
      continue;
    }
    if (edge.kind === "imports" || edge.kind === "calls" || edge.kind === "references") {
      add(toPath);
    }
  }
  for (const source of preferredSources) {
    add(source);
  }
  for (const file of blast?.impactedFiles ?? []) {
    add(file.path);
  }
  for (const test of blast?.verification.likelyTests ?? []) {
    add(test.path);
  }
  const queryTokens = tokenize(query);
  const scored = model.index.files
    .map((file) => {
      const authority = classifySourceProvenance({ sourcePath: file.path });
      return {
        path: file.path,
        authorityScore: authority.authorityScore,
        score: queryTokens.reduce(
        (score, token) =>
          score +
          (file.path.toLowerCase().includes(token) ? 2 : 0) +
          (file.content.toLowerCase().includes(token) ? 1 : 0),
        0,
        ),
      };
    })
    .filter((file) => file.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.authorityScore !== left.authorityScore) {
        return right.authorityScore - left.authorityScore;
      }
      return left.path.localeCompare(right.path);
    })
    .slice(0, 6);
  for (const file of scored) {
    add(file.path);
  }
  const knownFiles = new Set(model.index.files.map((file) => file.path));
  return ordered.filter((source) => knownFiles.has(source)).slice(0, 10);
}

function renderProjectContextPack(input: {
  objective: string;
  query: string;
  indexHealth: IndexHealthSnapshot;
  architecture: ArchitectureMap;
  entrypoints: EntrypointFlowDiscovery;
  blast?: BlastRadiusAnalysis;
  files: Array<{ path: string; content: string }>;
}): string {
  const moduleLines = input.architecture.modules
    .slice(0, 12)
    .map(
      (module) =>
        `- ${module.rootPath}: files=${module.fileCount}, symbols=${module.symbolCount}, owners=${module.owners.join(", ") || "none"}, depends=${module.dependencies.join(", ") || "none"}`,
    );
  const entrypointLines = input.entrypoints.entrypoints
    .slice(0, 12)
    .map(
      (entrypoint) =>
        `- ${entrypoint.kind} ${entrypoint.name} (${entrypoint.path}) -> ${entrypoint.downstreamFiles.join(", ") || "none"}`,
    );
  const blastLines = input.blast
    ? input.blast.impactedFiles.map(
        (file) => `- ${file.path}: ${file.reasons.join("; ")} confidence=${file.confidence.toFixed(2)}`,
      )
    : ["- No changed files supplied."];
  const fileLines = input.files.flatMap((file) => [
    `## File: ${file.path}`,
    fencedSnippet(file.content),
  ]);
  const healthLines = [
    "## Index Health",
    `- status: ${input.indexHealth.status}`,
    `- action: ${input.indexHealth.recommendedAction}`,
    `- truncated: ${input.indexHealth.truncated}`,
    `- skipped files: ${input.indexHealth.skippedFileCount}`,
    ...languageCoverageLines(input.indexHealth),
  ];
  return [
    "# Context Pack",
    "",
    `Objective: ${input.objective}`,
    `Query: ${input.query}`,
    "",
    ...healthLines,
    "",
    "## Architecture Modules",
    ...moduleLines,
    "",
    "## Entrypoints",
    ...entrypointLines,
    "",
    "## Blast Radius",
    ...blastLines,
    "",
    "## Relevant Files",
    ...fileLines,
    "",
  ].join("\n");
}

function languageCoverageLines(indexHealth: IndexHealthSnapshot): string[] {
  if ((indexHealth.languageCoverage ?? []).length === 0) {
    return [];
  }
  return [
    "- language coverage:",
    ...(indexHealth.languageCoverage ?? []).map(
      (coverage) =>
        `  - ${coverage.displayName}: ${coverage.indexedFileCount}/${coverage.totalFileCount} indexed (${coverage.status})`,
    ),
  ];
}

function fencedSnippet(content: string): string {
  const snippet = content.length > 900 ? `${content.slice(0, 897).trimEnd()}...` : content;
  return ["```", snippet, "```"].join("\n");
}

function clampToBudget(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 80) {
    return value.slice(0, Math.max(0, maxChars));
  }
  return `${value.slice(0, maxChars - 34).trimEnd()}\n\n[truncated to fit context budget]`;
}

function readRepoFile(repoRoot: string, repoPath: string): string {
  const absolutePath = path.join(repoRoot, repoPath);
  if (!existsSync(absolutePath)) {
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function moduleRootFor(repoPath: string): string {
  const normalized = toRepoPath(repoPath);
  const segments = normalized.split("/");
  if (segments.length === 1) {
    return ".";
  }
  if (segments[0] === "src") {
    return segments.length > 2 ? `src/${segments[1]}` : "src";
  }
  return segments[0] ?? ".";
}

function isTestPath(repoPath: string): boolean {
  return /(^|\/)(tests?|__tests__)\/|[._-](test|spec)\.[A-Za-z0-9]+$/.test(repoPath);
}

function fileForNode(nodeId: string): string | undefined {
  if (nodeId.startsWith("external:")) {
    return undefined;
  }
  return nodeId.split("#", 1)[0] ?? nodeId;
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9_$]+/i).filter(Boolean);
}

function hashParts(parts: string[]): string {
  let hash = 0;
  for (const char of parts.join("\n")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
