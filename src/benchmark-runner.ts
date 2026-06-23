import type { BenchmarkFixture } from "./benchmarks.js";

export type PlannerRun = {
  fixtureId: string;
  plan: string;
};

export type BenchmarkRunner = (fixture: BenchmarkFixture) => Promise<PlannerRun>;

export type BenchmarkComparisonInput = {
  fixtures: BenchmarkFixture[];
  runUnaided: BenchmarkRunner;
  runWormhole: BenchmarkRunner;
};

export type BenchmarkRunRecord = PlannerRun & {
  runner: "unaided" | "wormhole";
};

export type ReviewPlan = {
  label: "Plan A" | "Plan B";
  content: string;
};

export type ReviewPair = {
  fixtureId: string;
  plans: ReviewPlan[];
};

export type BenchmarkComparison = {
  runs: BenchmarkRunRecord[];
  reviewPairs: ReviewPair[];
};

function anonymizePlan(plan: string): string {
  return plan.replace(/wormhole/gi, "Agent").replace(/unaided/gi, "Agent");
}

export async function runBenchmarkComparison(
  input: BenchmarkComparisonInput,
): Promise<BenchmarkComparison> {
  const runs: BenchmarkRunRecord[] = [];
  const reviewPairs: ReviewPair[] = [];

  for (const fixture of input.fixtures) {
    const unaided = await input.runUnaided(fixture);
    const wormhole = await input.runWormhole(fixture);
    runs.push({ ...unaided, runner: "unaided" });
    runs.push({ ...wormhole, runner: "wormhole" });

    const unaidedFirst = fixture.id.length % 2 === 0;
    reviewPairs.push({
      fixtureId: fixture.id,
      plans: unaidedFirst
        ? [
            { label: "Plan A", content: anonymizePlan(unaided.plan) },
            { label: "Plan B", content: anonymizePlan(wormhole.plan) },
          ]
        : [
            { label: "Plan A", content: anonymizePlan(wormhole.plan) },
            { label: "Plan B", content: anonymizePlan(unaided.plan) },
          ],
    });
  }

  return { runs, reviewPairs };
}
