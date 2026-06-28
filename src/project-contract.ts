import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  detectLanguageProfile,
  type LanguageCoverage,
  type RepoLanguageProfile,
} from "./language-profile.js";

export type ProjectPackageManager = "npm" | "pnpm" | "yarn" | "bun" | "cargo" | "dotnet" | "unknown";

export type ProjectScript = {
  name: string;
  command: string;
};

export type ProjectDependency = {
  name: string;
  version: string;
  manager: ProjectPackageManager;
  dev: boolean;
};

export type ProjectEnvVar = {
  name: string;
  source: string;
};

export type ProjectContract = {
  repoRoot: string;
  packageManager: ProjectPackageManager;
  scripts: ProjectScript[];
  dependencies: ProjectDependency[];
  lockfiles: string[];
  languages: LanguageCoverage[];
  frameworks: string[];
  languageProfile: RepoLanguageProfile;
  envVars: ProjectEnvVar[];
  ports: number[];
};

export type DetectProjectContractInput = {
  repoRoot: string;
};

const LOCKFILE_MANAGERS: Array<{ file: string; manager: ProjectPackageManager }> = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "package-lock.json", manager: "npm" },
  { file: "bun.lock", manager: "bun" },
  { file: "bun.lockb", manager: "bun" },
];

const ENV_FILES = [
  ".env.example",
  ".env.local.example",
  ".env.template",
  ".env.sample",
  ".env",
];

const PORT_HINT_FILES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "Dockerfile",
];

export function detectProjectContract(input: DetectProjectContractInput): ProjectContract {
  const repoRoot = path.resolve(input.repoRoot);
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    throw new Error(`Repo root does not exist: ${input.repoRoot}`);
  }

  const packageJson = readJsonFile(path.join(repoRoot, "package.json"));
  const languageProfile = detectLanguageProfile({ repoRoot });
  const packageManager = detectPackageManager(repoRoot, packageJson);
  const lockfiles = readLockfiles(repoRoot, packageManager);
  const scripts = readProjectScripts(packageJson, packageManager);
  const dependencies = readPackageDependencies(packageJson, packageManager);
  const envVars = readEnvVars(repoRoot);
  const ports = readPortHints(repoRoot, envVars);

  return {
    repoRoot,
    packageManager,
    scripts,
    dependencies,
    lockfiles,
    languages: languageProfile.languages,
    frameworks: languageProfile.frameworks,
    languageProfile,
    envVars,
    ports,
  };
}

function readJsonFile(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function detectPackageManager(
  repoRoot: string,
  packageJson: Record<string, unknown> | undefined,
): ProjectPackageManager {
  for (const lockfile of LOCKFILE_MANAGERS) {
    if (existsSync(path.join(repoRoot, lockfile.file))) {
      return lockfile.manager;
    }
  }
  const packageManager = typeof packageJson?.packageManager === "string" ? packageJson.packageManager : "";
  if (packageManager.startsWith("pnpm@")) {
    return "pnpm";
  }
  if (packageManager.startsWith("yarn@")) {
    return "yarn";
  }
  if (packageManager.startsWith("bun@")) {
    return "bun";
  }
  if (packageManager.startsWith("npm@")) {
    return "npm";
  }
  if (
    existsSync(path.join(repoRoot, "Cargo.toml")) ||
    findFilesByExtension(repoRoot, ".toml").some((file) => path.basename(file) === "Cargo.toml")
  ) {
    return "cargo";
  }
  if (
    findFilesByExtension(repoRoot, ".sln").length > 0 ||
    findFilesByExtension(repoRoot, ".csproj").length > 0
  ) {
    return "dotnet";
  }
  return "unknown";
}

function readLockfiles(repoRoot: string, packageManager: ProjectPackageManager): string[] {
  const nodeLockfiles = LOCKFILE_MANAGERS.map((lockfile) => lockfile.file).filter((file) =>
    existsSync(path.join(repoRoot, file)),
  );
  if (packageManager === "cargo") {
    return existsSync(path.join(repoRoot, "Cargo.lock")) ? ["Cargo.lock"] : [];
  }
  if (packageManager === "dotnet") {
    return [...findFilesByExtension(repoRoot, ".sln"), ...findFilesByExtension(repoRoot, ".csproj")];
  }
  return nodeLockfiles;
}

function readProjectScripts(
  packageJson: Record<string, unknown> | undefined,
  packageManager: ProjectPackageManager,
): ProjectScript[] {
  const scripts = readPackageScripts(packageJson);
  if (packageManager === "cargo") {
    return uniqueScripts([
      ...scripts,
      { name: "build", command: "cargo build" },
      { name: "test", command: "cargo test" },
    ]);
  }
  if (packageManager === "dotnet") {
    return uniqueScripts([
      ...scripts,
      { name: "build", command: "dotnet build" },
      { name: "test", command: "dotnet test" },
    ]);
  }
  return scripts;
}

function readPackageScripts(packageJson: Record<string, unknown> | undefined): ProjectScript[] {
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, command]) => ({ name, command }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function uniqueScripts(scripts: ProjectScript[]): ProjectScript[] {
  const byName = new Map<string, ProjectScript>();
  for (const script of scripts) {
    if (!byName.has(script.name)) {
      byName.set(script.name, script);
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function readPackageDependencies(
  packageJson: Record<string, unknown> | undefined,
  manager: ProjectPackageManager,
): ProjectDependency[] {
  const dependencies = [
    ...readDependencyBlock(packageJson?.dependencies, manager, false),
    ...readDependencyBlock(packageJson?.devDependencies, manager, true),
  ];
  return dependencies.sort((left, right) => left.name.localeCompare(right.name));
}

function readDependencyBlock(
  block: unknown,
  manager: ProjectPackageManager,
  dev: boolean,
): ProjectDependency[] {
  if (!isRecord(block)) {
    return [];
  }
  return Object.entries(block)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, version]) => ({ name, version, manager, dev }));
}

function readEnvVars(repoRoot: string): ProjectEnvVar[] {
  const vars = new Map<string, ProjectEnvVar>();
  for (const envFile of ENV_FILES) {
    const filePath = path.join(repoRoot, envFile);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      continue;
    }
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
      if (!match?.[1]) {
        continue;
      }
      vars.set(match[1], { name: match[1], source: envFile });
    }
  }
  return [...vars.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function readPortHints(repoRoot: string, envVars: ProjectEnvVar[]): number[] {
  const ports = new Set<number>();
  for (const envVar of envVars) {
    if (!/PORT$/i.test(envVar.name)) {
      continue;
    }
    const envFile = path.join(repoRoot, envVar.source);
    const content = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
    const match = content.match(new RegExp(`^\\s*(?:export\\s+)?${escapeRegex(envVar.name)}\\s*=\\s*(\\d+)`, "m"));
    if (match?.[1]) {
      addPort(ports, Number(match[1]));
    }
  }

  for (const file of PORT_HINT_FILES) {
    const filePath = path.join(repoRoot, file);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      continue;
    }
    const content = readFileSync(filePath, "utf8");
    for (const match of content.matchAll(/(?:^|[^\d])([1-9]\d{1,4})\s*:\s*([1-9]\d{1,4})(?!\d)/g)) {
      addPort(ports, Number(match[1]));
      addPort(ports, Number(match[2]));
    }
    for (const match of content.matchAll(/\bEXPOSE\s+([1-9]\d{1,4})\b/gi)) {
      addPort(ports, Number(match[1]));
    }
  }

  return [...ports].sort((left, right) => left - right);
}

function addPort(ports: Set<number>, value: number): void {
  if (Number.isInteger(value) && value > 0 && value <= 65_535) {
    ports.add(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function listProjectFiles(repoRoot: string): string[] {
  return readdirSync(path.resolve(repoRoot)).sort((left, right) => left.localeCompare(right));
}

function findFilesByExtension(repoRoot: string, extension: string): string[] {
  const root = path.resolve(repoRoot);
  const files: string[] = [];
  const excludedDirectories = new Set([
    ".git",
    ".next",
    ".turbo",
    ".wormhole",
    "bin",
    "build",
    "coverage",
    "dist",
    "graphify-out",
    "node_modules",
    "obj",
    "out",
    "target",
  ]);

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) {
          visit(absolutePath);
        }
        continue;
      }
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === extension) {
        files.push(path.relative(root, absolutePath).replace(/\\/g, "/"));
      }
    }
  }

  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}
