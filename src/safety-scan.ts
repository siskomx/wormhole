import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type SecretSeverity = "medium" | "high";
export type OperationRiskLevel = "low" | "medium" | "high";

export type SecretFinding = {
  kind: "secret";
  source: string;
  line: number;
  column: number;
  secretType: string;
  severity: SecretSeverity;
  redacted: string;
};

export type RepoSecretScanResult = {
  repoRoot: string;
  scannedFiles: number;
  findings: SecretFinding[];
};

export type OperationRiskReview = {
  riskLevel: OperationRiskLevel;
  requiresExplicitApproval: boolean;
  reasons: string[];
};

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".wormhole",
  "coverage",
  "dist",
  "node_modules",
]);

const TEXT_EXTENSIONS = new Set([
  ".env",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const SECRET_PATTERNS: Array<{
  secretType: string;
  severity: SecretSeverity;
  regex: RegExp;
}> = [
  {
    secretType: "openai-api-key",
    severity: "high",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    secretType: "github-token",
    severity: "high",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g,
  },
  {
    secretType: "aws-access-key",
    severity: "high",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    secretType: "private-key",
    severity: "high",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    secretType: "credential-assignment",
    severity: "medium",
    regex: /\b(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*["']?([A-Za-z0-9_./+=-]{12,})["']?/gi,
  },
];

export function scanTextForSecrets(input: {
  source: string;
  text: string;
}): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  const lineStarts = createLineStarts(input.text);
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of input.text.matchAll(pattern.regex)) {
      const value = match[1] && pattern.secretType === "credential-assignment" ? match[1] : match[0];
      if (!value || isPlaceholderSecret(value)) {
        continue;
      }
      const position = positionForOffset(lineStarts, match.index ?? 0);
      const seenKey = `${position.line}:${value}`;
      if (seen.has(seenKey)) {
        continue;
      }
      seen.add(seenKey);
      findings.push({
        kind: "secret",
        source: input.source,
        line: position.line,
        column: position.column,
        secretType: pattern.secretType,
        severity: pattern.severity,
        redacted: redact(value),
      });
    }
  }
  return findings.sort((left, right) => {
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    return left.column - right.column;
  });
}

export function scanRepoForSecrets(input: {
  repoRoot: string;
  maxFiles?: number;
  maxFileBytes?: number;
}): RepoSecretScanResult {
  const repoRoot = path.resolve(input.repoRoot);
  const maxFiles = input.maxFiles ?? 500;
  const maxFileBytes = input.maxFileBytes ?? 256 * 1024;
  const files = listScannableFiles(repoRoot).slice(0, maxFiles);
  const findings: SecretFinding[] = [];
  let scannedFiles = 0;

  for (const relativePath of files) {
    const absolutePath = path.join(repoRoot, relativePath);
    const stat = statSync(absolutePath);
    if (stat.size > maxFileBytes) {
      continue;
    }
    scannedFiles += 1;
    findings.push(
      ...scanTextForSecrets({
        source: relativePath,
        text: readFileSync(absolutePath, "utf8"),
      }),
    );
  }

  return { repoRoot, scannedFiles, findings };
}

export function reviewOperationRisk(input: {
  command: string;
  args?: string[];
}): OperationRiskReview {
  const command = input.command.toLowerCase();
  const args = input.args ?? [];
  const joined = [command, ...args].join(" ").toLowerCase();
  const reasons: string[] = [];

  if (command === "git" && args[0] === "push" && args.some((arg) => arg === "--force" || arg === "-f")) {
    reasons.push("Force-pushing can overwrite remote history.");
  }
  if (command === "git" && args[0] === "reset" && args.includes("--hard")) {
    reasons.push("Hard reset can discard local work.");
  }
  if ((command === "rm" || command === "del" || command === "remove-item") && /(-rf|-r|\/s|recursive)/i.test(joined)) {
    reasons.push("Recursive deletion can remove broad filesystem state.");
  }
  if (/curl\s+.+\|\s*(sh|bash|pwsh|powershell)/.test(joined)) {
    reasons.push("Piping remote code into a shell is high risk.");
  }

  if (reasons.length > 0) {
    return { riskLevel: "high", requiresExplicitApproval: true, reasons };
  }
  if (command === "npm" && ["install", "publish"].includes(args[0] ?? "")) {
    return {
      riskLevel: "medium",
      requiresExplicitApproval: false,
      reasons: ["Package manager operation can modify dependencies or publish artifacts."],
    };
  }
  return {
    riskLevel: "low",
    requiresExplicitApproval: false,
    reasons: ["Operation does not match known destructive patterns."],
  };
}

function listScannableFiles(repoRoot: string): string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toRepoPath(path.relative(repoRoot, absolutePath));
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          visit(absolutePath);
        }
        continue;
      }
      if (entry.isFile() && isTextPath(relativePath)) {
        files.push(relativePath);
      }
    }
  }
  visit(repoRoot);
  return files;
}

function isTextPath(filePath: string): boolean {
  const basename = path.basename(filePath);
  if (basename.startsWith(".env")) {
    return true;
  }
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function createLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function positionForOffset(lineStarts: number[], offset: number): { line: number; column: number } {
  let lineIndex = 0;
  for (let index = 0; index < lineStarts.length; index += 1) {
    if ((lineStarts[index] ?? 0) <= offset) {
      lineIndex = index;
    } else {
      break;
    }
  }
  return {
    line: lineIndex + 1,
    column: offset - (lineStarts[lineIndex] ?? 0) + 1,
  };
}

function redact(value: string): string {
  if (value.length <= 8) {
    return "...";
  }
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

function isPlaceholderSecret(value: string): boolean {
  return /^(example|changeme|placeholder|your_|xxx)/i.test(value);
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/");
}
