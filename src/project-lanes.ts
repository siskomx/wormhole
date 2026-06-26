export const PROJECT_LANES = [
  "runtime",
  "tests",
  "fixtures",
  "benchmarks",
  "docs",
  "generated",
] as const;

export type ProjectLane = (typeof PROJECT_LANES)[number];

export type ProjectLaneSummary = Record<ProjectLane, number>;

export function classifyProjectLane(repoPathInput: string): ProjectLane {
  const repoPath = repoPathInput.replace(/\\/g, "/").replace(/^\.\//, "");
  const lower = repoPath.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;

  if (
    /(^|\/)(dist|build|coverage|generated|\.next|\.turbo|\.wormhole)(\/|$)/.test(lower) ||
    /[._-](generated|gen)\.[a-z0-9]+$/.test(basename)
  ) {
    return "generated";
  }
  if (
    /(^|\/)(benchmarks?|perf)(\/|$)/.test(lower) ||
    lower === "scripts/run-benchmarks.ts" ||
    lower === "scripts/validate-benchmarks.ts"
  ) {
    return "benchmarks";
  }
  if (/(^|\/)(__fixtures__|fixtures?|testdata)(\/|$)/.test(lower)) {
    return "fixtures";
  }
  if (/(^|\/)(tests?|__tests__)(\/|$)/.test(lower) || /[._-](test|spec)\.[a-z0-9]+$/.test(basename)) {
    return "tests";
  }
  if (/(^|\/)docs\//.test(lower) || basename === "readme.md" || /\.(md|mdx)$/.test(basename)) {
    return "docs";
  }
  return "runtime";
}

export function summarizeProjectLanes(repoPaths: string[]): ProjectLaneSummary {
  const summary = Object.fromEntries(PROJECT_LANES.map((lane) => [lane, 0])) as ProjectLaneSummary;
  for (const repoPath of repoPaths) {
    summary[classifyProjectLane(repoPath)] += 1;
  }
  return summary;
}

export function uniqueProjectLanes(repoPaths: string[]): ProjectLane[] {
  return PROJECT_LANES.filter((lane) => repoPaths.some((repoPath) => classifyProjectLane(repoPath) === lane));
}
