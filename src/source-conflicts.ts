import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ProjectContract } from "./project-contract.js";
import { summarizeRepoIndex, type RepoIndex, type RepoIndexFile, type RepoIndexSummary } from "./repo-index.js";
import { classifySourceProvenance, type SourceConflict, type SourceProvenance } from "./source-authority.js";

export type SourceConflictAnalysis = {
  repoRoot: string;
  indexFingerprint: string;
  indexSummary: RepoIndexSummary;
  conflicts: SourceConflict[];
};

export type AnalyzeSourceConflictsInput = {
  repoRoot: string;
  index: RepoIndex;
  contract?: ProjectContract;
};

type ConflictDraft = {
  subject: string;
  authoritative: SourceProvenance[];
  conflicting: SourceProvenance[];
  severity: SourceConflict["severity"];
  resolution: SourceConflict["resolution"];
  message: string;
};

export function analyzeSourceConflicts(input: AnalyzeSourceConflictsInput): SourceConflictAnalysis {
  const repoRoot = path.resolve(input.repoRoot);
  const knownFiles = new Set(input.index.files.map((file) => file.path));
  const docs = input.index.files.filter(isDocFile);
  const scripts = new Set(input.contract?.scripts.map((script) => script.name) ?? []);
  const dependencies = new Set(input.contract?.dependencies.map((dependency) => dependency.name) ?? []);
  const dbTables = new Set(input.index.files.flatMap((file) => detectDbTables(file.content)));
  const conflicts = uniqueConflicts([
    ...docs.flatMap((doc) => analyzeDocLinks(doc, knownFiles)),
    ...docs.flatMap((doc) => analyzeDocScriptMentions(doc, scripts)),
    ...docs.flatMap((doc) => analyzeDocDependencyMentions(doc, dependencies)),
    ...docs.flatMap((doc) => analyzeDocTableMentions(doc, dbTables)),
    ...analyzeGeneratedArtifactFingerprints(repoRoot, input.index.fingerprint),
  ]);

  return {
    repoRoot,
    indexFingerprint: input.index.fingerprint,
    indexSummary: summarizeRepoIndex(input.index),
    conflicts,
  };
}

function analyzeDocLinks(doc: RepoIndexFile, knownFiles: Set<string>): SourceConflict[] {
  const conflicts: ConflictDraft[] = [];
  for (const match of doc.content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const href = firstMarkdownHrefToken(match[1] ?? "");
    if (!href || isExternalLink(href)) {
      continue;
    }
    const target = normalizeRepoLink(doc.path, href);
    if (!target || knownFiles.has(target)) {
      continue;
    }
    conflicts.push({
      subject: `${doc.path} -> ${target}`,
      authoritative: [repoIndexEvidence("Repo index file list")],
      conflicting: [docEvidence(doc.path, lineForOffset(doc.content, match.index ?? 0))],
      severity: "warning",
      resolution: "needs_validation",
      message: `${doc.path} links to ${target}, but the current repo index does not contain that file.`,
    });
  }
  return conflicts.map(toConflict);
}

function firstMarkdownHrefToken(value: string): string {
  return value.trim().split(/\s+/, 1)[0] ?? "";
}

function analyzeDocScriptMentions(doc: RepoIndexFile, scripts: Set<string>): SourceConflict[] {
  if (scripts.size === 0) {
    return [];
  }
  const conflicts: ConflictDraft[] = [];
  for (const match of doc.content.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+run\s+([A-Za-z0-9:_-]+)\b/g)) {
    const script = match[1];
    if (!script || scripts.has(script)) {
      continue;
    }
    conflicts.push({
      subject: `script:${script}`,
      authoritative: [packageEvidence("Current package scripts")],
      conflicting: [docEvidence(doc.path, lineForOffset(doc.content, match.index ?? 0))],
      severity: "warning",
      resolution: "trust_authoritative",
      message: `${doc.path} mentions package script "${script}", but package.json does not define it.`,
    });
  }
  return conflicts.map(toConflict);
}

function analyzeDocDependencyMentions(doc: RepoIndexFile, dependencies: Set<string>): SourceConflict[] {
  if (dependencies.size === 0) {
    return [];
  }
  return claimLines(doc, /(?:^|\b)dependencies?\s*:/i)
    .flatMap((line) => packageTokens(line.text).map((dependency) => ({ dependency, line: line.line })))
    .filter(({ dependency }) => !dependencies.has(dependency))
    .map(({ dependency, line }) =>
      toConflict({
        subject: `dependency:${dependency}`,
        authoritative: [packageEvidence("Current package dependencies")],
        conflicting: [docEvidence(doc.path, line)],
        severity: "warning",
        resolution: "trust_authoritative",
        message: `${doc.path} mentions dependency "${dependency}", but package.json does not define it.`,
      }),
    );
}

function analyzeDocTableMentions(doc: RepoIndexFile, dbTables: Set<string>): SourceConflict[] {
  if (dbTables.size === 0) {
    return [];
  }
  return claimLines(doc, /(?:^|\b)(?:db\s+)?tables?\s*:/i)
    .flatMap((line) => tableTokens(line.text).map((table) => ({ table, line: line.line })))
    .filter(({ table }) => !dbTables.has(table))
    .map(({ table, line }) =>
      toConflict({
        subject: `table:${table}`,
        authoritative: [migrationEvidence("Current migration/schema table facts")],
        conflicting: [docEvidence(doc.path, line)],
        severity: "warning",
        resolution: "trust_authoritative",
        message: `${doc.path} mentions table "${table}", but current migrations/schema facts do not define it.`,
      }),
    );
}

function analyzeGeneratedArtifactFingerprints(repoRoot: string, currentIndexFingerprint: string): SourceConflict[] {
  return listGeneratedJsonArtifacts(repoRoot)
    .flatMap((repoPath) => {
      const absolutePath = path.join(repoRoot, repoPath);
      const artifact = safeReadJson(absolutePath);
      const fingerprint = stringField(artifact, "indexFingerprint") ?? stringField(artifact, "repoIndexFingerprint");
      if (!fingerprint || fingerprint === currentIndexFingerprint) {
        return [];
      }
      return [
        toConflict({
          subject: `${repoPath}#indexFingerprint`,
          authoritative: [
            classifySourceProvenance({
              sourcePath: "repo-index",
              authority: "derived_code_fact",
              freshness: "current",
              reason: "Current repo index fingerprint.",
            }),
          ],
          conflicting: [
            classifySourceProvenance({
              sourcePath: repoPath,
              authority: "generated_note",
              freshness: "stale",
              reason: `${repoPath} stores index fingerprint ${fingerprint}, which differs from current ${currentIndexFingerprint}.`,
            }),
          ],
          severity: "warning",
          resolution: "needs_validation",
          message: `${repoPath} was generated from stale index fingerprint ${fingerprint}.`,
        }),
      ];
    });
}

function toConflict(input: ConflictDraft): SourceConflict {
  return {
    subject: input.subject,
    authoritative: input.authoritative,
    conflicting: input.conflicting,
    severity: input.severity,
    resolution: input.resolution,
    message: input.message,
  };
}

function uniqueConflicts(conflicts: SourceConflict[]): SourceConflict[] {
  const byKey = new Map<string, SourceConflict>();
  for (const conflict of conflicts) {
    const key = `${conflict.subject}\0${conflict.message}`;
    if (!byKey.has(key)) {
      byKey.set(key, conflict);
    }
  }
  return [...byKey.values()].sort((left, right) => left.subject.localeCompare(right.subject));
}

function claimLines(doc: RepoIndexFile, marker: RegExp): Array<{ line: number; text: string }> {
  return doc.content
    .split("\n")
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => marker.test(text));
}

function packageTokens(text: string): string[] {
  return tokensAfterColon(text)
    .filter((token) => /^[a-z0-9@][a-z0-9._/-]*$/i.test(token))
    .filter((token) => !new Set(["dependency", "dependencies", "devdependencies"]).has(token.toLowerCase()));
}

function tableTokens(text: string): string[] {
  return tokensAfterColon(text)
    .map((token) => token.toLowerCase())
    .filter((token) => /^[a-z][a-z0-9_]*$/.test(token))
    .filter((token) => !new Set(["table", "tables", "db"]).has(token));
}

function tokensAfterColon(text: string): string[] {
  const value = text.split(":", 2)[1] ?? "";
  return value
    .split(/[\s,;]+/)
    .map((token) => token.replace(/^[`'"([]+|[`'".)\]]+$/g, "").trim())
    .filter(Boolean);
}

function detectDbTables(content: string): string[] {
  const tables = new Set<string>();
  for (const match of content.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:"?[\w]+"?)\.)?["`]?([a-zA-Z0-9_]+)["`]?/gi)) {
    if (match[1]) {
      tables.add(match[1].toLowerCase());
    }
  }
  return [...tables];
}

function listGeneratedJsonArtifacts(repoRoot: string): string[] {
  const root = path.join(repoRoot, ".wormhole");
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0 && files.length < 200) {
    const directory = queue.shift();
    if (!directory) {
      break;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(toRepoPath(path.relative(repoRoot, absolutePath)));
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function safeReadJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function packageEvidence(reason: string): SourceProvenance {
  return classifySourceProvenance({
    sourcePath: "package.json",
    authority: "current_config",
    freshness: "current",
    reason,
  });
}

function migrationEvidence(reason: string): SourceProvenance {
  return classifySourceProvenance({
    sourcePath: "migrations",
    authority: "current_migration",
    freshness: "current",
    reason,
  });
}

function repoIndexEvidence(reason: string): SourceProvenance {
  return classifySourceProvenance({
    sourcePath: "repo-index",
    authority: "derived_code_fact",
    freshness: "current",
    reason,
  });
}

function docEvidence(sourcePath: string, lineStart: number): SourceProvenance {
  return classifySourceProvenance({
    sourcePath,
    lineStart,
    lineEnd: lineStart,
  });
}

function isDocFile(file: RepoIndexFile): boolean {
  const lower = file.path.toLowerCase();
  return file.language === "markdown" || lower.startsWith("docs/") || /\.(?:html|mdx|txt)$/.test(lower);
}

function isExternalLink(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#");
}

function normalizeRepoLink(sourcePath: string, href: string): string | undefined {
  const clean = href.split(/[?#]/, 1)[0]?.trim();
  if (!clean) {
    return undefined;
  }
  const normalized = clean.startsWith("/")
    ? path.posix.normalize(clean.replace(/^\/+/, ""))
    : path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), clean));
  if (normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return undefined;
  }
  return normalized;
}

function lineForOffset(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
