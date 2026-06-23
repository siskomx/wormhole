import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type BenchmarkFixture = {
  id: string;
  title: string;
  category: string;
  repoSource: string;
  fixtureHash: string;
  taskPrompt: string;
  allowedPaths: string[];
  expectedPlanningConcerns: string[];
  rubricFile: string;
  fixtureFile: string;
  absoluteRepoPath: string;
  absoluteRubricPath: string;
};

export type RubricDimension = {
  id: string;
  name: string;
  description: string;
  scale: number[];
};

export type BenchmarkRubric = {
  version: string;
  dimensions: RubricDimension[];
};

export type BenchmarkSuite = {
  root: string;
  rubric: BenchmarkRubric;
  fixtures: BenchmarkFixture[];
};

type RawBenchmarkFixture = Omit<
  BenchmarkFixture,
  "fixtureFile" | "absoluteRepoPath" | "absoluteRubricPath"
>;

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function listFiles(root: string): string[] {
  const entries = readdirSync(root).sort();
  const files: string[] = [];

  for (const entry of entries) {
    if (entry === ".git" || entry === "node_modules") {
      continue;
    }
    const entryPath = path.join(root, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      files.push(...listFiles(entryPath));
    } else if (stat.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function readCanonicalTextFixture(filePath: string): string {
  return readFileSync(filePath, "utf8").replaceAll("\r\n", "\n");
}

export function hashFixtureDirectory(repoPath: string): string {
  const absoluteRepoPath = path.resolve(repoPath);
  const hash = createHash("sha256");

  for (const filePath of listFiles(absoluteRepoPath)) {
    const relativePath = path.relative(absoluteRepoPath, filePath).replaceAll("\\", "/");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readCanonicalTextFixture(filePath), "utf8");
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}

export function loadBenchmarkSuite(root: string = path.resolve(process.cwd(), "benchmarks")): BenchmarkSuite {
  const absoluteRoot = path.resolve(root);
  const projectRoot = path.dirname(absoluteRoot);
  const rubricPath = path.join(absoluteRoot, "rubric.json");
  const fixturesRoot = path.join(absoluteRoot, "fixtures");

  if (!existsSync(rubricPath)) {
    throw new Error(`Benchmark rubric not found: ${rubricPath}`);
  }
  if (!existsSync(fixturesRoot)) {
    throw new Error(`Benchmark fixtures directory not found: ${fixturesRoot}`);
  }

  const rubric = readJsonFile<BenchmarkRubric>(rubricPath);
  const fixtureFiles = readdirSync(fixturesRoot)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();
  const fixtures = fixtureFiles.map((fileName) => {
    const fixtureFile = path.join(fixturesRoot, fileName);
    const raw = readJsonFile<RawBenchmarkFixture>(fixtureFile);
    return {
      ...raw,
      fixtureFile,
      absoluteRepoPath: path.resolve(projectRoot, raw.repoSource),
      absoluteRubricPath: path.resolve(projectRoot, raw.rubricFile),
    };
  });

  return {
    root: absoluteRoot,
    rubric,
    fixtures,
  };
}
