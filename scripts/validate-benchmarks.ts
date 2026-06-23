import { hashFixtureDirectory, loadBenchmarkSuite } from "../src/benchmarks.js";

const suite = loadBenchmarkSuite();
let valid = true;

for (const fixture of suite.fixtures) {
  const actualHash = hashFixtureDirectory(fixture.absoluteRepoPath);
  if (actualHash !== fixture.fixtureHash) {
    valid = false;
    console.error(`${fixture.id}: expected ${fixture.fixtureHash}, got ${actualHash}`);
  } else {
    console.log(`${fixture.id}: ${actualHash}`);
  }
}

if (!valid) {
  process.exitCode = 1;
}
