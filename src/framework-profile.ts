import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type FrameworkSignal = {
  id: string;
  confidence: number;
  evidence: string[];
};

export type FrameworkProfile = {
  frameworks: FrameworkSignal[];
};

export type DetectFrameworkProfileInput = {
  repoRoot: string;
  repoFiles: string[];
};

type MutableFrameworkSignal = {
  id: string;
  confidence: number;
  evidence: Set<string>;
};

const NODE_DEPENDENCY_FRAMEWORKS: Record<string, string> = {
  "@nestjs/core": "nestjs",
  "@remix-run/react": "remix",
  "@sveltejs/kit": "sveltekit",
  "express": "express",
  "fastify": "fastify",
  "next": "nextjs",
  "react": "react",
  "vite": "vite",
};

const PYTHON_DEPENDENCY_FRAMEWORKS: Record<string, string> = {
  "django": "django",
  "fastapi": "fastapi",
  "flask": "flask",
};

export function detectFrameworkProfile(input: DetectFrameworkProfileInput): FrameworkProfile {
  const repoRoot = path.resolve(input.repoRoot);
  const repoFiles = input.repoFiles.map(toRepoPath);
  const frameworks = new Map<string, MutableFrameworkSignal>();

  function add(id: string, confidence: number, evidence: string): void {
    const existing = frameworks.get(id);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.evidence.add(evidence);
      return;
    }
    frameworks.set(id, { id, confidence, evidence: new Set([evidence]) });
  }

  const cargoFiles = repoFiles.filter((file) => path.basename(file) === "Cargo.toml");
  if (cargoFiles.length > 0) {
    add("cargo", 1, cargoFiles[0] ?? "Cargo.toml");
  }

  const dotnetFiles = repoFiles.filter((file) => file.endsWith(".sln") || file.endsWith(".csproj"));
  if (dotnetFiles.length > 0) {
    add("dotnet", 1, dotnetFiles[0] ?? "*.csproj");
  }

  if (repoFiles.some((file) => path.basename(file) === "tauri.conf.json")) {
    add("tauri", 1, "tauri.conf.json");
  }

  for (const cargoFile of cargoFiles) {
    if (safeRead(repoRoot, cargoFile).toLowerCase().includes("tauri")) {
      add("tauri", 0.95, cargoFile);
    }
  }

  for (const projectFile of dotnetFiles.filter((file) => file.endsWith(".csproj"))) {
    const content = safeRead(repoRoot, projectFile);
    if (/Microsoft\.NET\.Sdk\.Web|AspNetCore/i.test(content)) {
      add("aspnetcore", 0.95, projectFile);
    }
  }

  for (const packageJson of repoFiles.filter((file) => path.basename(file) === "package.json")) {
    add("node", 0.7, packageJson);
    for (const dependency of Object.keys(packageDependencies(repoRoot, packageJson))) {
      const framework = NODE_DEPENDENCY_FRAMEWORKS[dependency];
      if (framework) {
        add(framework, 0.95, `${packageJson}: ${dependency}`);
      }
    }
  }

  for (const file of repoFiles.filter((repoPath) => isPythonDependencyManifest(repoPath))) {
    const content = safeRead(repoRoot, file).toLowerCase();
    add("python", 0.7, file);
    for (const [dependency, framework] of Object.entries(PYTHON_DEPENDENCY_FRAMEWORKS)) {
      if (new RegExp(`\\b${escapeRegex(dependency)}\\b`).test(content)) {
        add(framework, 0.9, `${file}: ${dependency}`);
      }
    }
  }

  return {
    frameworks: [...frameworks.values()]
      .map((signal) => ({
        id: signal.id,
        confidence: signal.confidence,
        evidence: [...signal.evidence].sort((left, right) => left.localeCompare(right)).slice(0, 8),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function packageDependencies(repoRoot: string, repoPath: string): Record<string, string> {
  try {
    const parsed = JSON.parse(safeRead(repoRoot, repoPath)) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    return {
      ...recordOfStrings(parsed["dependencies"]),
      ...recordOfStrings(parsed["devDependencies"]),
      ...recordOfStrings(parsed["peerDependencies"]),
    };
  } catch {
    return {};
  }
}

function recordOfStrings(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function isPythonDependencyManifest(repoPath: string): boolean {
  const basename = path.basename(repoPath).toLowerCase();
  return basename === "pyproject.toml" || basename === "requirements.txt" || basename === "pipfile";
}

function safeRead(repoRoot: string, relativePath: string): string {
  try {
    const filePath = path.join(repoRoot, relativePath);
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
