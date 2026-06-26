import { analyzeImpact, type ImpactAnalysisResult } from "./impact-analysis.js";
import { buildRepoIndex, type RepoIndex, type RepoIndexSymbol } from "./repo-index.js";

export type DiffHunk = {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
};

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
  const index = input.index ?? buildRepoIndex({ repoRoot: input.repoRoot });
  const base = analyzeImpact({ repoRoot: input.repoRoot, changedFiles: input.changedFiles, index });
  const hunks = parseUnifiedDiff(input.diffText ?? "", input.changedFiles);
  const changedSymbols = index.symbols.filter((symbol) => {
    if (!input.changedFiles.includes(symbol.path)) {
      return false;
    }
    const fileHunks = hunks.filter((hunk) => hunk.file === symbol.path);
    if (fileHunks.length === 0) {
      return true;
    }
    return fileHunks.some(
      (hunk) => symbol.line >= hunk.newStart && symbol.line <= hunk.newStart + Math.max(1, hunk.newLines) - 1,
    );
  });
  const changedSymbolNames = new Set(changedSymbols.map((symbol) => symbol.name));
  const likelyTests = index.files
    .filter((file) => isTestPath(file.path))
    .map((file) => {
      const matchingSymbol = [...changedSymbolNames].find((symbolName) => file.content.includes(symbolName));
      const matchingFile = input.changedFiles.find((changedFile) =>
        file.content.includes(changedFile.replace(/\.[^.]+$/, "").split("/").pop() ?? changedFile),
      );
      if (matchingSymbol) {
        return {
          path: file.path,
          confidence: 0.9,
          reason: `Test references changed symbol ${matchingSymbol}.`,
        };
      }
      if (matchingFile) {
        return {
          path: file.path,
          confidence: 0.75,
          reason: `Test references changed file ${matchingFile}.`,
        };
      }
      return undefined;
    })
    .filter((candidate): candidate is { path: string; confidence: number; reason: string } => Boolean(candidate))
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      return left.path.localeCompare(right.path);
    });

  return {
    ...base,
    likelyTests,
    hunks,
    changedSymbols,
  };
}

function parseUnifiedDiff(diffText: string, changedFiles: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentFile = changedFiles[0] ?? "";
  for (const line of diffText.split(/\r?\n/)) {
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (fileMatch?.[2]) {
      currentFile = fileMatch[2];
      continue;
    }
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      hunks.push({
        file: currentFile,
        oldStart: Number(hunkMatch[1]),
        oldLines: Number(hunkMatch[2] ?? 1),
        newStart: Number(hunkMatch[3]),
        newLines: Number(hunkMatch[4] ?? 1),
      });
    }
  }
  return hunks;
}

function isTestPath(filePath: string): boolean {
  return /(^|\/)(tests?|__tests__)\/|[._-](test|spec)\.[A-Za-z0-9]+$/.test(filePath);
}
