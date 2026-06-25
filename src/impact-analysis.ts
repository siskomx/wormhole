import { buildRepoIndex } from "./repo-index.js";

export type ImpactRiskLevel = "low" | "medium" | "high";

export type ImpactAnalysisInput = {
  repoRoot: string;
  changedFiles: string[];
};

export type ImpactAnalysisResult = {
  changedFiles: string[];
  impactedFiles: string[];
  likelyTests: string[];
  riskLevel: ImpactRiskLevel;
  reasons: string[];
};

export function analyzeImpact(input: ImpactAnalysisInput): ImpactAnalysisResult {
  const changedFiles = [...new Set(input.changedFiles.map(toRepoPath))].sort();
  const changedSet = new Set(changedFiles);
  const index = buildRepoIndex({ repoRoot: input.repoRoot });
  const impacted = new Set<string>();
  const reasons: string[] = [];

  for (const edge of index.edges) {
    if (changedSet.has(edge.to) && edge.from !== edge.to) {
      const file = fileForNode(edge.from);
      if (file && !changedSet.has(file)) {
        impacted.add(file);
      }
    }
    const changedSymbol = index.symbols.find((symbol) => changedSet.has(symbol.path) && symbol.id === edge.to);
    if (changedSymbol) {
      const file = fileForNode(edge.from);
      if (file && !changedSet.has(file)) {
        impacted.add(file);
      }
    }
  }

  if (impacted.size > 0) {
    reasons.push("Changed file has inbound dependents.");
  }

  const likelyTests = index.files
    .filter((file) => isTestPath(file.path) && testMentionsChangedFile(file.content, changedFiles))
    .map((file) => file.path)
    .sort();

  if (likelyTests.length > 0) {
    reasons.push("Likely tests import or mention changed files.");
  } else {
    reasons.push("No directly matching tests were found.");
  }

  const impactedFiles = [...impacted].sort();
  return {
    changedFiles,
    impactedFiles,
    likelyTests,
    riskLevel: riskLevelFor(impactedFiles, likelyTests),
    reasons,
  };
}

function riskLevelFor(impactedFiles: string[], likelyTests: string[]): ImpactRiskLevel {
  if (likelyTests.length === 0 || impactedFiles.length > 5) {
    return "high";
  }
  if (impactedFiles.length > 0) {
    return "medium";
  }
  return "low";
}

function testMentionsChangedFile(content: string, changedFiles: string[]): boolean {
  const lower = content.toLowerCase();
  return changedFiles.some((changedFile) => {
    const normalized = changedFile.toLowerCase();
    const withoutExtension = normalized.replace(/\.[^.]+$/, "");
    const basename = withoutExtension.split("/").pop() ?? withoutExtension;
    return lower.includes(normalized) || lower.includes(withoutExtension) || lower.includes(basename);
  });
}

function isTestPath(filePath: string): boolean {
  return /(^|\/)(tests?|__tests__)\/|[._-](test|spec)\.[A-Za-z0-9]+$/.test(filePath);
}

function fileForNode(nodeId: string): string | undefined {
  if (nodeId.startsWith("external:")) {
    return undefined;
  }
  return nodeId.split("#", 1)[0] ?? nodeId;
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
