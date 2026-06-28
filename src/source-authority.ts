export type SourceAuthority =
  | "current_code"
  | "current_test"
  | "current_migration"
  | "current_config"
  | "derived_code_fact"
  | "verified_doc"
  | "supporting_doc"
  | "generated_note"
  | "unknown";

export type FreshnessStatus = "current" | "stale" | "unknown";

export type SourceProvenance = {
  authority: SourceAuthority;
  freshness: FreshnessStatus;
  authorityScore: number;
  sourcePath: string;
  sourceHash?: string;
  lineStart?: number;
  lineEnd?: number;
  indexFingerprint?: string;
  derivedFrom?: string[];
  validatedAgainst?: string[];
  reason: string;
};

export type SourceConflict = {
  subject: string;
  authoritative: SourceProvenance[];
  conflicting: SourceProvenance[];
  severity: "blocking" | "warning" | "info";
  resolution: "trust_authoritative" | "needs_validation" | "doc_only";
  message: string;
};

export type SourceProvenanceInput = {
  sourcePath: string;
  sourceHash?: string;
  lineStart?: number;
  lineEnd?: number;
  indexFingerprint?: string;
  derivedFrom?: string[];
  validatedAgainst?: string[];
  authority?: SourceAuthority;
  freshness?: FreshnessStatus;
  reason?: string;
};

const AUTHORITY_SCORE: Record<SourceAuthority, number> = {
  current_code: 1,
  current_test: 0.95,
  current_migration: 0.95,
  current_config: 0.9,
  derived_code_fact: 0.88,
  verified_doc: 0.7,
  supporting_doc: 0.35,
  generated_note: 0.2,
  unknown: 0.25,
};

const AUTHORITATIVE_AUTHORITIES = new Set<SourceAuthority>([
  "current_code",
  "current_test",
  "current_migration",
  "current_config",
  "derived_code_fact",
]);

export function classifySourceProvenance(input: SourceProvenanceInput): SourceProvenance {
  const sourcePath = toRepoPath(input.sourcePath);
  const authority = input.authority ?? inferAuthority(sourcePath, input.validatedAgainst ?? []);
  const freshness = input.freshness ?? inferFreshness(authority);
  return {
    authority,
    freshness,
    authorityScore: AUTHORITY_SCORE[authority],
    sourcePath,
    ...(input.sourceHash ? { sourceHash: input.sourceHash } : {}),
    ...(input.lineStart !== undefined ? { lineStart: input.lineStart } : {}),
    ...(input.lineEnd !== undefined ? { lineEnd: input.lineEnd } : {}),
    ...(input.indexFingerprint ? { indexFingerprint: input.indexFingerprint } : {}),
    ...(input.derivedFrom && input.derivedFrom.length > 0 ? { derivedFrom: [...input.derivedFrom] } : {}),
    ...(input.validatedAgainst && input.validatedAgainst.length > 0 ? { validatedAgainst: [...input.validatedAgainst] } : {}),
    reason: input.reason ?? reasonForAuthority(authority, sourcePath),
  };
}

export function isAuthoritativeSource(source: SourceProvenance): boolean {
  return AUTHORITATIVE_AUTHORITIES.has(source.authority);
}

export function compareSourceProvenance(left: SourceProvenance, right: SourceProvenance): number {
  if (right.authorityScore !== left.authorityScore) {
    return right.authorityScore - left.authorityScore;
  }
  return left.sourcePath.localeCompare(right.sourcePath);
}

function inferAuthority(sourcePath: string, validatedAgainst: string[]): SourceAuthority {
  const lower = sourcePath.toLowerCase();
  if (validatedAgainst.length > 0 && isDocLikePath(lower)) {
    return "verified_doc";
  }
  if (isGeneratedNotePath(lower)) {
    return "generated_note";
  }
  if (isDocLikePath(lower)) {
    return "supporting_doc";
  }
  if (isTestPath(lower)) {
    return "current_test";
  }
  if (lower.startsWith("migrations/") || lower.endsWith(".sql")) {
    return "current_migration";
  }
  if (isConfigPath(lower)) {
    return "current_config";
  }
  if (isCodePath(lower)) {
    return "current_code";
  }
  return "unknown";
}

function inferFreshness(authority: SourceAuthority): FreshnessStatus {
  if (authority === "supporting_doc" || authority === "generated_note" || authority === "unknown") {
    return "unknown";
  }
  return "current";
}

function reasonForAuthority(authority: SourceAuthority, sourcePath: string): string {
  if (authority === "supporting_doc") {
    return `${sourcePath} is documentation and is supporting context unless validated against current code.`;
  }
  if (authority === "generated_note") {
    return `${sourcePath} is generated or agent-local output and must not override current repo facts.`;
  }
  if (authority === "verified_doc") {
    return `${sourcePath} is documentation linked to current repo evidence.`;
  }
  if (authority === "derived_code_fact") {
    return `${sourcePath} is generated from current repo index evidence.`;
  }
  if (authority === "unknown") {
    return `${sourcePath} has no recognized source authority.`;
  }
  return `${sourcePath} is current repo evidence.`;
}

function isGeneratedNotePath(lowerPath: string): boolean {
  return (
    lowerPath.startsWith(".wormhole/") ||
    lowerPath.startsWith(".agents/") ||
    lowerPath.startsWith(".claude/") ||
    lowerPath.startsWith(".codex/") ||
    lowerPath.startsWith(".cursor/") ||
    lowerPath.includes("/agent") && /\.(md|mdx|txt|html)$/.test(lowerPath)
  );
}

function isDocLikePath(lowerPath: string): boolean {
  return (
    lowerPath.startsWith("docs/") ||
    lowerPath.endsWith(".md") ||
    lowerPath.endsWith(".mdx") ||
    lowerPath.endsWith(".html") ||
    lowerPath.endsWith(".txt")
  );
}

function isTestPath(lowerPath: string): boolean {
  return /(^|\/)(tests?|__tests__|e2e)(\/|$)/.test(lowerPath) || /[._-](test|spec)\.[a-z0-9]+$/.test(lowerPath);
}

function isConfigPath(lowerPath: string): boolean {
  const basename = lowerPath.split("/").pop() ?? lowerPath;
  return (
    basename === "package.json" ||
    basename === "tsconfig.json" ||
    basename === "jsconfig.json" ||
    basename === "vite.config.ts" ||
    basename === "vitest.config.ts" ||
    basename === "webpack.config.js" ||
    basename === "dockerfile" ||
    basename.endsWith(".config.ts") ||
    basename.endsWith(".config.js") ||
    basename.endsWith(".config.mjs") ||
    basename.endsWith(".config.cjs") ||
    basename.endsWith(".yml") ||
    basename.endsWith(".yaml")
  );
}

function isCodePath(lowerPath: string): boolean {
  return /\.(?:cjs|cs|cts|js|jsx|mjs|mts|py|ts|tsx)$/.test(lowerPath);
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
