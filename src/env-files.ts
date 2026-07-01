import path from "node:path";

export type EnvFileKind = "template" | "sensitive";

export type EnvFileClassification = {
  kind: EnvFileKind;
  sensitive: boolean;
};

const TEMPLATE_ENV_SUFFIXES = [
  ".example",
  ".sample",
  ".template",
  ".dist",
  ".default",
  ".defaults",
];

export function classifyEnvFilePath(filePath: string): EnvFileClassification | undefined {
  const basename = path.posix.basename(toRepoPath(filePath)).toLowerCase();
  if (isTemplateEnvBasename(basename)) {
    return { kind: "template", sensitive: false };
  }
  if (!isEnvLikeBasename(basename)) {
    return undefined;
  }
  return { kind: "sensitive", sensitive: true };
}

export function isSensitiveEnvFilePath(filePath: string): boolean {
  return classifyEnvFilePath(filePath)?.kind === "sensitive";
}

export function isTemplateEnvFilePath(filePath: string): boolean {
  return classifyEnvFilePath(filePath)?.kind === "template";
}

export function envAssignmentNames(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
    if (match?.[1]) {
      names.add(match[1]);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function countEnvAssignments(text: string): number {
  return envAssignmentNames(text).length;
}

function isEnvLikeBasename(basename: string): boolean {
  return basename === ".env" || basename.startsWith(".env.") || basename.endsWith(".env");
}

function isTemplateEnvBasename(basename: string): boolean {
  if (basename === ".envrc.example") {
    return true;
  }
  for (const suffix of TEMPLATE_ENV_SUFFIXES) {
    if (!basename.endsWith(suffix)) {
      continue;
    }
    const templateSource = basename.slice(0, -suffix.length);
    if (isEnvLikeBasename(templateSource)) {
      return true;
    }
  }
  return false;
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/");
}
