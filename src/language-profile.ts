import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { detectFrameworkProfile } from "./framework-profile.js";

export type LanguageSupportLevel = "supported" | "partial" | "unsupported";
export type LanguageCoverageStatus = "ok" | "warning" | "blocker";

export type LanguageCoverage = {
  language: string;
  displayName: string;
  supportLevel: LanguageSupportLevel;
  totalFileCount: number;
  indexedFileCount: number;
  coverage: number;
  status: LanguageCoverageStatus;
  reasons: string[];
  manifestFiles?: string[];
  sampleFiles?: string[];
};

export type LanguageProfileHealth = {
  status: "ok" | "warning" | "blocker";
  reasons: string[];
};

export type RepoLanguageProfile = {
  repoRoot: string;
  languages: LanguageCoverage[];
  frameworks: string[];
  health: LanguageProfileHealth;
};

export type DetectLanguageProfileInput = {
  repoRoot: string;
  indexedFiles?: string[];
};

export const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".cjs": "javascript",
  ".cs": "csharp",
  ".csproj": "xml",
  ".css": "css",
  ".html": "html",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  ".md": "markdown",
  ".mdx": "markdown",
  ".mjs": "javascript",
  ".props": "xml",
  ".ps1": "powershell",
  ".py": "python",
  ".rs": "rust",
  ".sh": "shell",
  ".sln": "dotnet-solution",
  ".sql": "sql",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".txt": "text",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export const INDEXABLE_TEXT_EXTENSIONS = Object.keys(LANGUAGE_BY_EXTENSION).sort((left, right) =>
  left.localeCompare(right),
);

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
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

const PROFILE_SOURCE_LANGUAGES = new Set([
  "csharp",
  "javascript",
  "python",
  "rust",
  "typescript",
]);

const SUPPORTED_LANGUAGES = new Set(["csharp", "javascript", "python", "rust", "typescript"]);
const PARTIAL_LANGUAGES = new Set([
  "css",
  "dotnet-solution",
  "html",
  "json",
  "markdown",
  "powershell",
  "shell",
  "sql",
  "text",
  "toml",
  "xml",
  "yaml",
]);

export function detectLanguageProfile(input: DetectLanguageProfileInput): RepoLanguageProfile {
  const repoRoot = path.resolve(input.repoRoot);
  const repoFiles = existsSync(repoRoot) && statSync(repoRoot).isDirectory() ? listProfileFiles(repoRoot) : [];
  const indexedFiles = input.indexedFiles?.map(toRepoPath);
  const indexedCounts = new Map<string, number>();
  if (indexedFiles) {
    for (const file of indexedFiles) {
      const language = languageForPath(file);
      indexedCounts.set(language, (indexedCounts.get(language) ?? 0) + 1);
    }
  }

  const filesByLanguage = new Map<string, string[]>();
  for (const file of repoFiles) {
    const language = profileLanguageForPath(file);
    if (!language) {
      continue;
    }
    filesByLanguage.set(language, [...(filesByLanguage.get(language) ?? []), file]);
  }

  const manifestFiles = repoFiles.filter(isManifestPath);
  const languages = [...filesByLanguage.entries()]
    .map(([language, files]): LanguageCoverage => {
      const totalFileCount = files.length;
      const indexedFileCount = indexedFiles ? indexedCounts.get(language) ?? 0 : totalFileCount;
      const coverage = totalFileCount === 0 ? 1 : indexedFileCount / totalFileCount;
      const supportLevel = supportLevelFor(language);
      const reasons = coverageReasons({
        displayName: languageDisplayName(language),
        supportLevel,
        totalFileCount,
        indexedFileCount,
        coverage,
      });
      return {
        language,
        displayName: languageDisplayName(language),
        supportLevel,
        totalFileCount,
        indexedFileCount,
        coverage,
        status: coverageStatusFor(supportLevel, coverage),
        reasons,
        manifestFiles: manifestFilesForLanguage(language, manifestFiles),
        sampleFiles: files.slice(0, 8),
      };
    })
    .sort((left, right) => {
      if (right.totalFileCount !== left.totalFileCount) {
        return right.totalFileCount - left.totalFileCount;
      }
      return left.language.localeCompare(right.language);
    });

  const reasons = uniqueSorted(languages.flatMap((language) => language.reasons));
  return {
    repoRoot,
    languages,
    frameworks: detectFrameworks(repoRoot, repoFiles),
    health: {
      status: healthStatusFor(languages),
      reasons,
    },
  };
}

export function languageForPath(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? "unknown";
}

export function languageDisplayName(language: string): string {
  switch (language) {
    case "csharp":
      return "C#";
    case "dotnet-solution":
      return ".NET solution";
    case "javascript":
      return "JavaScript";
    case "json":
      return "JSON";
    case "powershell":
      return "PowerShell";
    case "python":
      return "Python";
    case "rust":
      return "Rust";
    case "typescript":
      return "TypeScript";
    case "xml":
      return "XML";
    case "yaml":
      return "YAML";
    default:
      return language.charAt(0).toUpperCase() + language.slice(1);
  }
}

export function isSupportedTextPath(relativePath: string): boolean {
  return languageForPath(relativePath) !== "unknown";
}

function listProfileFiles(repoRoot: string): string[] {
  const files: string[] = [];

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toRepoPath(path.relative(repoRoot, absolutePath));
      if (entry.isDirectory()) {
        if (DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !isSupportedTextPath(relativePath) || isGeneratedSourcePath(relativePath)) {
        continue;
      }
      files.push(relativePath);
    }
  }

  visit(repoRoot);
  return files;
}

function profileLanguageForPath(relativePath: string): string | undefined {
  const language = languageForPath(relativePath);
  return PROFILE_SOURCE_LANGUAGES.has(language) ? language : undefined;
}

function supportLevelFor(language: string): LanguageSupportLevel {
  if (SUPPORTED_LANGUAGES.has(language)) {
    return "supported";
  }
  if (PARTIAL_LANGUAGES.has(language)) {
    return "partial";
  }
  return "unsupported";
}

function coverageStatusFor(supportLevel: LanguageSupportLevel, coverage: number): LanguageCoverageStatus {
  if (supportLevel !== "supported") {
    return "ok";
  }
  if (coverage === 0) {
    return "blocker";
  }
  if (coverage < 1) {
    return "warning";
  }
  return "ok";
}

function coverageReasons(input: {
  displayName: string;
  supportLevel: LanguageSupportLevel;
  totalFileCount: number;
  indexedFileCount: number;
  coverage: number;
}): string[] {
  if (input.supportLevel !== "supported" || input.coverage >= 1) {
    return [];
  }
  if (input.indexedFileCount === 0) {
    return [
      `Language coverage missing for ${input.displayName}: ${input.totalFileCount} files detected, 0 indexed.`,
    ];
  }
  return [
    `Language coverage partial for ${input.displayName}: ${input.indexedFileCount}/${input.totalFileCount} files indexed.`,
  ];
}

function healthStatusFor(languages: LanguageCoverage[]): LanguageProfileHealth["status"] {
  if (languages.some((language) => language.status === "blocker")) {
    return "blocker";
  }
  if (languages.some((language) => language.status === "warning")) {
    return "warning";
  }
  return "ok";
}

function detectFrameworks(repoRoot: string, repoFiles: string[]): string[] {
  return detectFrameworkProfile({ repoRoot, repoFiles }).frameworks
    .map((framework) => framework.id)
    .sort((left, right) => left.localeCompare(right));
}

function manifestFilesForLanguage(language: string, manifestFiles: string[]): string[] {
  if (language === "rust") {
    return manifestFiles.filter((file) => path.basename(file) === "Cargo.toml");
  }
  if (language === "csharp") {
    return manifestFiles.filter((file) => file.endsWith(".sln") || file.endsWith(".csproj"));
  }
  if (language === "typescript" || language === "javascript") {
    return manifestFiles.filter((file) => path.basename(file) === "package.json");
  }
  return [];
}

function isManifestPath(relativePath: string): boolean {
  const basename = path.basename(relativePath);
  return (
    basename === "Cargo.toml" ||
    basename === "package.json" ||
    basename === "tauri.conf.json" ||
    relativePath.endsWith(".csproj") ||
    relativePath.endsWith(".sln")
  );
}

function isGeneratedSourcePath(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase();
  return (
    normalized.endsWith(".g.cs") ||
    normalized.endsWith(".designer.cs") ||
    normalized.endsWith(".generated.cs")
  );
}

function safeRead(repoRoot: string, relativePath: string): string {
  try {
    return readFileSync(path.join(repoRoot, relativePath), "utf8");
  } catch {
    return "";
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toRepoPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "");
}
