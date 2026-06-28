import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FeatureSideEffect } from "./feature-index.js";

export type DomainIndexFeatureConfig = {
  featureId: string;
  displayName: string;
  aliases: string[];
  roots: string[];
  portals: string[];
  tables: string[];
};

export type DomainIndexFileGroups = {
  routes: string[];
  hooks: string[];
  services: string[];
  migrations: string[];
  openapi: string[];
  conventions: string[];
  memory: string[];
};

export type DomainIndexVerificationGateConfig = {
  gateId: string;
  scriptNames: string[];
  whenFeatureTouches: FeatureSideEffect[];
};

export type DomainIndexManifest = {
  schemaVersion: "domain-index.v0";
  features: DomainIndexFeatureConfig[];
  fileGroups: DomainIndexFileGroups;
  verificationGates: DomainIndexVerificationGateConfig[];
};

export type DomainIndexManifestResult = {
  repoRoot: string;
  manifestPath: string;
  manifest?: DomainIndexManifest;
  warnings: string[];
};

const EMPTY_GROUPS: DomainIndexFileGroups = {
  routes: [],
  hooks: [],
  services: [],
  migrations: [],
  openapi: [],
  conventions: [],
  memory: [],
};

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

export function domainIndexManifestPath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), ".wormhole", "domain-index.json");
}

export function readDomainIndexManifest(input: { repoRoot: string }): DomainIndexManifestResult {
  const repoRoot = path.resolve(input.repoRoot);
  const manifestPath = domainIndexManifestPath(repoRoot);
  if (!existsSync(manifestPath)) {
    return { repoRoot, manifestPath, manifest: undefined, warnings: [] };
  }

  const warnings: string[] = [];
  const raw = parseJson(readFileSync(manifestPath, "utf8"), warnings);
  if (!isRecord(raw)) {
    return { repoRoot, manifestPath, manifest: undefined, warnings };
  }

  return {
    repoRoot,
    manifestPath,
    manifest: {
      schemaVersion: "domain-index.v0",
      features: readFeatures(raw.features, warnings),
      fileGroups: readFileGroups(raw.fileGroups, warnings),
      verificationGates: readVerificationGates(raw.verificationGates),
    },
    warnings,
  };
}

function parseJson(text: string, warnings: string[]): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    warnings.push(
      `Could not parse .wormhole/domain-index.json: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function readFeatures(value: unknown, warnings: string[]): DomainIndexFeatureConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((item) => {
      if (!isRecord(item) || typeof item.featureId !== "string") {
        return [];
      }
      const featureId = normalizeId(item.featureId);
      if (!featureId) {
        return [];
      }
      const roots = readPathArray(item.roots, warnings);
      return [
        {
          featureId,
          displayName:
            typeof item.displayName === "string" && item.displayName.trim()
              ? item.displayName.trim()
              : titleCase(featureId),
          aliases: uniqueSorted(readStringArray(item.aliases).map(normalizeId).filter(Boolean)),
          roots,
          portals: uniqueSorted(readStringArray(item.portals).map(normalizeId).filter(Boolean)),
          tables: uniqueSorted(
            readStringArray(item.tables)
              .map((table) => table.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""))
              .filter(Boolean),
          ),
        },
      ];
    })
    .sort((left, right) => left.featureId.localeCompare(right.featureId));
}

function readFileGroups(value: unknown, warnings: string[]): DomainIndexFileGroups {
  if (!isRecord(value)) {
    return { ...EMPTY_GROUPS };
  }
  return {
    routes: readPathArray(value.routes, warnings),
    hooks: readPathArray(value.hooks, warnings),
    services: readPathArray(value.services, warnings),
    migrations: readPathArray(value.migrations, warnings),
    openapi: readPathArray(value.openapi, warnings),
    conventions: readPathArray(value.conventions, warnings),
    memory: readPathArray(value.memory, warnings),
  };
}

function readVerificationGates(value: unknown): DomainIndexVerificationGateConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((item) => {
      if (!isRecord(item) || typeof item.gateId !== "string") {
        return [];
      }
      const gateId = normalizeId(item.gateId);
      if (!gateId) {
        return [];
      }
      return [
        {
          gateId,
          scriptNames: uniqueSorted(readStringArray(item.scriptNames)),
          whenFeatureTouches: uniqueSorted(
            readStringArray(item.whenFeatureTouches).filter((entry): entry is FeatureSideEffect =>
              VALID_SIDE_EFFECTS.has(entry as FeatureSideEffect),
            ),
          ),
        },
      ];
    })
    .sort((left, right) => left.gateId.localeCompare(right.gateId));
}

function readPathArray(value: unknown, warnings: string[]): string[] {
  return uniqueSorted(
    readStringArray(value).flatMap((entry) => {
      const normalized = toRepoPath(entry);
      if (!isSafeRepoPath(normalized)) {
        warnings.push(`Ignored unsafe domain-index path: ${entry}`);
        return [];
      }
      return [normalized];
    }),
  );
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function isSafeRepoPath(value: string): boolean {
  return Boolean(value) && !path.isAbsolute(value) && !value.split("/").includes("..");
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

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
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
