import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type TestQualityDecision = "pass" | "warn";

export type TestQualityFindingKind =
  | "missing_tests"
  | "skipped_test"
  | "assertion_free_test"
  | "snapshot_only_test";

export type TestQualityFinding = {
  kind: TestQualityFindingKind;
  severity: "warning";
  path?: string;
  message: string;
};

export type TestQualityReviewResult = {
  repoRoot: string;
  decision: TestQualityDecision;
  changedFiles: string[];
  testFiles: string[];
  findings: TestQualityFinding[];
};

export type TestQualityReviewInput = {
  repoRoot: string;
  changedFiles: string[];
};

const ASSERTION_PATTERN = /\b(expect|assert|toBe|toEqual|toContain|toThrow|resolves|rejects)\b/;
const SNAPSHOT_PATTERN = /\b(toMatchSnapshot|toMatchInlineSnapshot)\b/;
const NON_SNAPSHOT_ASSERTION_PATTERN = /\b(toBe|toEqual|toContain|toThrow|resolves|rejects|assert)\b/;

export function reviewTestQuality(input: TestQualityReviewInput): TestQualityReviewResult {
  const repoRoot = path.resolve(input.repoRoot);
  const changedFiles = uniqueSorted(input.changedFiles.map(toRepoPath));
  const testFiles = changedFiles.filter(isTestPath);
  const sourceFiles = changedFiles.filter((file) => !isTestPath(file) && isSourcePath(file));
  const findings: TestQualityFinding[] = [];

  if (sourceFiles.length > 0 && testFiles.length === 0) {
    findings.push({
      kind: "missing_tests",
      severity: "warning",
      message: `Source files changed without changed tests: ${sourceFiles.join(", ")}`,
    });
  }

  for (const testFile of testFiles) {
    const absolutePath = path.join(repoRoot, testFile);
    const content = existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
    if (/\b(?:it|test|describe)\.skip\s*\(/.test(content)) {
      findings.push({
        kind: "skipped_test",
        severity: "warning",
        path: testFile,
        message: `${testFile} contains skipped tests.`,
      });
    }
    if (!ASSERTION_PATTERN.test(content)) {
      findings.push({
        kind: "assertion_free_test",
        severity: "warning",
        path: testFile,
        message: `${testFile} does not contain a recognizable assertion.`,
      });
    }
    if (SNAPSHOT_PATTERN.test(content) && !NON_SNAPSHOT_ASSERTION_PATTERN.test(content.replace(SNAPSHOT_PATTERN, ""))) {
      findings.push({
        kind: "snapshot_only_test",
        severity: "warning",
        path: testFile,
        message: `${testFile} only uses snapshot assertions.`,
      });
    }
  }

  return {
    repoRoot,
    decision: findings.length > 0 ? "warn" : "pass",
    changedFiles,
    testFiles,
    findings: findings.sort((left, right) =>
      (left.path ?? "").localeCompare(right.path ?? "") || left.kind.localeCompare(right.kind),
    ),
  };
}

function isTestPath(repoPath: string): boolean {
  const basename = path.posix.basename(repoPath).toLowerCase();
  return (
    repoPath.includes("__tests__/") ||
    repoPath.startsWith("tests/") ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(basename) ||
    /(_test\.go|test\.java|test\.py)$/.test(basename)
  );
}

function isSourcePath(repoPath: string): boolean {
  return /\.(ts|tsx|js|jsx|py|rs|cs|go|java)$/.test(repoPath.toLowerCase());
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
