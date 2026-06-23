import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadBenchmarkSuite } from "../src/benchmarks.js";
import { runBenchmarkComparison } from "../src/benchmark-runner.js";

function requireTemplate(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required. Use placeholders {fixtureId}, {repoPath}, and {taskPrompt}.`,
    );
  }
  return value;
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function renderTemplate(
  template: string,
  input: { fixtureId: string; repoPath: string; taskPrompt: string },
): string {
  return template
    .replaceAll("{fixtureId}", quote(input.fixtureId))
    .replaceAll("{repoPath}", quote(input.repoPath))
    .replaceAll("{taskPrompt}", quote(input.taskPrompt));
}

const suite = loadBenchmarkSuite();
const unaidedTemplate = requireTemplate("WORMHOLE_UNAIDED_COMMAND");
const wormholeTemplate = requireTemplate("WORMHOLE_PLANNER_COMMAND");

const result = await runBenchmarkComparison({
  fixtures: suite.fixtures,
  runUnaided: async (fixture) => ({
    fixtureId: fixture.id,
    plan: execSync(
      renderTemplate(unaidedTemplate, {
        fixtureId: fixture.id,
        repoPath: fixture.absoluteRepoPath,
        taskPrompt: fixture.taskPrompt,
      }),
      { encoding: "utf8", cwd: fixture.absoluteRepoPath },
    ),
  }),
  runWormhole: async (fixture) => ({
    fixtureId: fixture.id,
    plan: execSync(
      renderTemplate(wormholeTemplate, {
        fixtureId: fixture.id,
        repoPath: fixture.absoluteRepoPath,
        taskPrompt: fixture.taskPrompt,
      }),
      { encoding: "utf8", cwd: fixture.absoluteRepoPath },
    ),
  }),
});

const outputDir = path.resolve(".wormhole", "benchmarks");
mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `comparison-${new Date().toISOString().replaceAll(":", "-")}.json`);
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(outputPath);
