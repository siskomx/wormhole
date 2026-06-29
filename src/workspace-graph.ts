import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { detectProjectContract, type ProjectPackageManager } from "./project-contract.js";

export type WorkspacePackage = {
  name: string;
  repoRoot: string;
  path: string;
  manager: ProjectPackageManager;
  private: boolean;
  dependencies: string[];
};

export type WorkspaceRepo = {
  repoRoot: string;
  packageManager: ProjectPackageManager;
  workspaceFiles: string[];
  packageCount: number;
  warnings: string[];
};

export type WorkspaceEdge = {
  fromPackage: string;
  toPackage: string;
  dependencyName: string;
};

export type WorkspaceGraph = {
  repos: WorkspaceRepo[];
  packages: WorkspacePackage[];
  edges: WorkspaceEdge[];
  summary: {
    repoCount: number;
    packageCount: number;
    edgeCount: number;
    monorepo: boolean;
    crossRepo: boolean;
  };
};

type PackageJson = {
  name?: string;
  private?: boolean;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export function analyzeWorkspaceGraph(input: { repoRoot: string; additionalRepoRoots?: string[] }): WorkspaceGraph {
  const repoRoots = [input.repoRoot, ...(input.additionalRepoRoots ?? [])].map((root) => path.resolve(root));
  const repos: WorkspaceRepo[] = [];
  const packages: WorkspacePackage[] = [];
  for (const repoRoot of repoRoots) {
    const result = analyzeOneRepo(repoRoot);
    repos.push(result.repo);
    packages.push(...result.packages);
  }
  const packageNames = new Set(packages.map((pkg) => pkg.name));
  const edges = packages
    .flatMap((pkg) =>
      pkg.dependencies
        .filter((dependency) => packageNames.has(dependency))
        .map((dependency): WorkspaceEdge => ({
          fromPackage: pkg.name,
          toPackage: dependency,
          dependencyName: dependency,
        })),
    )
    .sort((left, right) => left.fromPackage.localeCompare(right.fromPackage) || left.toPackage.localeCompare(right.toPackage));
  return {
    repos,
    packages: packages.sort((left, right) => left.name.localeCompare(right.name)),
    edges,
    summary: {
      repoCount: repos.length,
      packageCount: packages.length,
      edgeCount: edges.length,
      monorepo: packages.length > repos.length || repos.some((repo) => repo.workspaceFiles.length > 0),
      crossRepo: repos.length > 1,
    },
  };
}

function analyzeOneRepo(repoRoot: string): { repo: WorkspaceRepo; packages: WorkspacePackage[] } {
  const warnings: string[] = [];
  const rootPackage = readPackageJson(path.join(repoRoot, "package.json"));
  const workspaceFiles: string[] = [];
  const patterns: string[] = [];
  if (rootPackage?.workspaces) {
    workspaceFiles.push("package.json");
    patterns.push(...workspacePatterns(rootPackage.workspaces));
  }
  const pnpmPath = path.join(repoRoot, "pnpm-workspace.yaml");
  if (existsSync(pnpmPath)) {
    workspaceFiles.push("pnpm-workspace.yaml");
    patterns.push(...pnpmWorkspacePatterns(readFileSync(pnpmPath, "utf8")));
  }
  const cargoPath = path.join(repoRoot, "Cargo.toml");
  if (existsSync(cargoPath)) {
    const cargoMembers = cargoWorkspaceMembers(readFileSync(cargoPath, "utf8"));
    if (cargoMembers.length > 0) {
      workspaceFiles.push("Cargo.toml");
      patterns.push(...cargoMembers);
    }
  }
  const manager = inferWorkspaceManager(repoRoot);
  const packageDirs = patterns.length > 0 ? expandPatterns(repoRoot, patterns) : rootPackage?.name ? [repoRoot] : [];
  const packages = packageDirs.flatMap((packageDir) => readWorkspacePackage(repoRoot, packageDir, manager, warnings));
  return {
    repo: {
      repoRoot,
      packageManager: manager,
      workspaceFiles: [...new Set(workspaceFiles)].sort(),
      packageCount: packages.length,
      warnings,
    },
    packages,
  };
}

function inferWorkspaceManager(repoRoot: string): ProjectPackageManager {
  if (existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))) {
    return "pnpm";
  }
  if (existsSync(path.join(repoRoot, "Cargo.toml")) && cargoWorkspaceMembers(readFileSync(path.join(repoRoot, "Cargo.toml"), "utf8")).length > 0) {
    return "cargo";
  }
  if (existsSync(path.join(repoRoot, "package.json"))) {
    const contract = detectProjectContract({ repoRoot });
    return contract.packageManager === "unknown" ? "npm" : contract.packageManager;
  }
  return detectProjectContract({ repoRoot }).packageManager;
}

function readWorkspacePackage(
  repoRoot: string,
  packageDir: string,
  manager: ProjectPackageManager,
  warnings: string[],
): WorkspacePackage[] {
  const packageJson = readPackageJson(path.join(packageDir, "package.json"));
  if (packageJson?.name) {
    return [
      {
        name: packageJson.name,
        repoRoot,
        path: toRepoPath(path.relative(repoRoot, packageDir) || "."),
        manager,
        private: Boolean(packageJson.private),
        dependencies: dependencyNames(packageJson),
      },
    ];
  }
  const cargoPath = path.join(packageDir, "Cargo.toml");
  if (existsSync(cargoPath)) {
    const cargo = readFileSync(cargoPath, "utf8");
    const name = cargo.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    if (name) {
      return [
        {
          name,
          repoRoot,
          path: toRepoPath(path.relative(repoRoot, packageDir) || "."),
          manager: "cargo",
          private: false,
          dependencies: cargoDependencyNames(cargo),
        },
      ];
    }
  }
  warnings.push(`No package metadata found in ${toRepoPath(path.relative(repoRoot, packageDir) || ".")}.`);
  return [];
}

function readPackageJson(filePath: string): PackageJson | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

function workspacePatterns(workspaces: PackageJson["workspaces"]): string[] {
  if (Array.isArray(workspaces)) {
    return workspaces;
  }
  if (workspaces && Array.isArray(workspaces.packages)) {
    return workspaces.packages;
  }
  return [];
}

function pnpmWorkspacePatterns(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+['"]?([^'"]+)['"]?\s*$/)?.[1])
    .filter((value): value is string => Boolean(value));
}

function cargoWorkspaceMembers(content: string): string[] {
  const match = content.match(/members\s*=\s*\[([^\]]*)\]/m);
  if (!match?.[1]) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]).filter(Boolean);
}

function expandPatterns(repoRoot: string, patterns: string[]): string[] {
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    const normalized = toRepoPath(pattern).replace(/\/+$/, "");
    if (!normalized.includes("*")) {
      const absolute = path.join(repoRoot, normalized);
      if (existsSync(absolute) && statSync(absolute).isDirectory()) {
        dirs.add(absolute);
      }
      continue;
    }
    const [prefix] = normalized.split("*", 1);
    const base = path.join(repoRoot, prefix.replace(/\/+$/, ""));
    if (!existsSync(base) || !statSync(base).isDirectory()) {
      continue;
    }
    for (const entry of readdirSync(base)) {
      const candidate = path.join(base, entry);
      if (statSync(candidate).isDirectory()) {
        dirs.add(candidate);
      }
    }
  }
  return [...dirs].sort((left, right) => left.localeCompare(right));
}

function dependencyNames(pkg: PackageJson): string[] {
  return uniqueSorted([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
}

function cargoDependencyNames(content: string): string[] {
  const dependenciesBlock = content.split(/^\s*\[dependencies\]\s*$/m)[1]?.split(/^\s*\[/m)[0] ?? "";
  return dependenciesBlock
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Za-z0-9_-]+)\s*=/)?.[1])
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
