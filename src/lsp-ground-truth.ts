import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type LanguageServerConfig = {
  language: "typescript" | "python";
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
