import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type LanguageServerConfig = {
  language: "typescript" | "python" | "csharp";
  command: string;
  args: string[];
  transport: "stdio";
  workspaceRoot: string;
  reason: string;
};

export type LspProbeResult = {
  repoRoot: string;
  status: "configured" | "not_configured";
  servers: LanguageServerConfig[];
  notes: string[];
};

export type LspProtocolLocation = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

export type NormalizedLspLocation = {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
};

export function detectLanguageServerConfigs(input: { repoRoot: string }): LanguageServerConfig[] {
  const repoRoot = path.resolve(input.repoRoot);
  const configs: LanguageServerConfig[] = [];
  if (hasTypeScriptProject(repoRoot)) {
    configs.push({
      language: "typescript",
      command: "typescript-language-server",
      args: ["--stdio"],
      transport: "stdio",
      workspaceRoot: repoRoot,
      reason: "Detected TypeScript project files or dependencies.",
    });
  }
  if (hasPythonProject(repoRoot)) {
    configs.push({
      language: "python",
      command: "pyright-langserver",
      args: ["--stdio"],
      transport: "stdio",
      workspaceRoot: repoRoot,
      reason: "Detected Python project files.",
    });
  }
  if (hasCSharpProject(repoRoot)) {
    configs.push({
      language: "csharp",
      command: "csharp-ls",
      args: [],
      transport: "stdio",
      workspaceRoot: repoRoot,
      reason: "Detected .NET solution or C# project files.",
    });
  }
  return configs;
}

export function lspProbe(input: { repoRoot: string }): LspProbeResult {
  const repoRoot = path.resolve(input.repoRoot);
  const servers = detectLanguageServerConfigs({ repoRoot });
  return {
    repoRoot,
    status: servers.length > 0 ? "configured" : "not_configured",
    servers,
    notes: [
      "No long-lived language server process was started.",
      "This probe reports safe startup config and normalized protocol shapes only.",
    ],
  };
}

export function normalizeLspLocation(location: LspProtocolLocation): NormalizedLspLocation {
  return {
    file: filePathFromUri(location.uri),
    line: location.range.start.line + 1,
    column: location.range.start.character + 1,
    endLine: location.range.end.line + 1,
    endColumn: location.range.end.character + 1,
  };
}

function hasTypeScriptProject(repoRoot: string): boolean {
  if (
    existsSync(path.join(repoRoot, "tsconfig.json")) ||
    existsSync(path.join(repoRoot, "jsconfig.json"))
  ) {
    return true;
  }
  const packageJsonPath = path.join(repoRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(packageJson.dependencies?.typescript ?? packageJson.devDependencies?.typescript);
  } catch {
    return false;
  }
}

function hasPythonProject(repoRoot: string): boolean {
  return [
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "setup.cfg",
    "Pipfile",
  ].some((file) => existsSync(path.join(repoRoot, file)));
}

function hasCSharpProject(repoRoot: string): boolean {
  return hasFileMatching(repoRoot, (fileName) => /\.(?:sln|csproj)$/i.test(fileName));
}

function hasFileMatching(
  directory: string,
  predicate: (fileName: string) => boolean,
  depth = 0,
): boolean {
  if (depth > 5) {
    return false;
  }
  let entries: Array<{
    name: string | Buffer;
    isFile(): boolean;
    isDirectory(): boolean;
  }>;
  try {
    entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const entryName = String(entry.name);
    if (entry.isFile() && predicate(entryName)) {
      return true;
    }
    if (!entry.isDirectory() || shouldSkipDirectory(entryName)) {
      continue;
    }
    if (hasFileMatching(path.join(directory, entryName), predicate, depth + 1)) {
      return true;
    }
  }
  return false;
}

function shouldSkipDirectory(name: string): boolean {
  return new Set([".git", ".wormhole", "node_modules", "dist", "build", "bin", "obj"]).has(name);
}

function filePathFromUri(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }
  const url = new URL(uri);
  const decoded = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:\//.test(decoded)) {
    return decoded.slice(1).replace(/\//g, path.sep);
  }
  return decoded;
}
