import { type ImpactAnalysisResult } from "./impact-analysis.js";
import {
  analyzeChangeImpact,
  parseUnifiedDiff,
  type DiffHunk,
} from "./change-impact.js";
import { type RepoIndex, type RepoIndexSymbol } from "./repo-index.js";

export type TestImpactV2Result = Omit<ImpactAnalysisResult, "likelyTests"> & {
  hunks: DiffHunk[];
  changedSymbols: RepoIndexSymbol[];
  likelyTests: Array<{
    path: string;
    confidence: number;
    reason: string;
  }>;
};

export function analyzeTestImpactV2(input: {
  repoRoot: string;
  changedFiles: string[];
  diffText?: string;
  index?: RepoIndex;
}): TestImpactV2Result {
  const impact = analyzeChangeImpact(input);
  const hunks = parseUnifiedDiff(input.diffText ?? "", input.changedFiles);

  return {
    changedFiles: impact.changedFiles,
    impactedFiles: impact.impactedFiles.map((file) => file.path),
    likelyTests: impact.impactedTests.map((test) => ({
      path: test.path,
      confidence: test.confidence,
      reason: test.reason,
    })),
    riskLevel: impact.riskLevel,
    reasons: impact.warnings.length > 0
      ? impact.warnings
      : [
          ...impact.impactedFiles.map((file) => file.reason),
          ...impact.impactedTests.map((test) => test.reason),
        ],
    hunks,
    changedSymbols: impact.changedSymbols,
  };
}
