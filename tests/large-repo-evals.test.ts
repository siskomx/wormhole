import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { refreshDurableRepoIndex } from "../src/durable-index-store.js";
import { analyzeChangeImpact } from "../src/change-impact.js";
import { hybridRepoSearch } from "../src/hybrid-repo-search.js";
import { scoreLargeRepoIntelligence } from "../src/large-repo-evals.js";
import { planWorkflow } from "../src/workflow-planner.js";
import { queryRepoRelations } from "../src/relation-query.js";

describe("large repo intelligence evals", () => {
  it("scores deterministic relation, impact, search, test, and workflow metrics", () => {
    const perfect = scoreLargeRepoIntelligence({
      fixtureId: "unit-perfect",
      expectedFiles: ["src/a.ts"],
      expectedTests: ["src/a.test.ts"],
      expectedRelations: ["file:src/b.ts->imports->file:src/a.ts"],
      expectedWorkflowTools: ["repo_relation_query", "gate_request"],
      relationResults: ["file:src/b.ts->imports->file:src/a.ts"],
      impactResults: ["src/a.ts", "src/a.test.ts"],
      searchResults: ["src/a.ts"],
      plannedTools: ["repo_relation_query", "gate_request"],
    });
    const missingTest = scoreLargeRepoIntelligence({
      fixtureId: "unit-missing-test",
      expectedTests: ["src/a.test.ts"],
      impactResults: [],
    });
    const rankThree = scoreLargeRepoIntelligence({
      fixtureId: "unit-rank-three",
      expectedFiles: ["src/a.ts"],
      searchResults: ["src/x.ts", "src/y.ts", "src/a.ts"],
    });

    expect(perfect.passed).toBe(true);
    expect(perfect.metrics).toMatchObject({
      relation_query_precision: 1,
      impact_recall: 1,
      test_selection_recall: 1,
      search_mrr: 1,
      workflow_completeness: 1,
    });
    expect(missingTest.metrics.test_selection_recall).toBe(0);
    expect(rankThree.metrics.search_mrr).toBeCloseTo(0.3333, 4);
  });

  it("scores real relation, impact, search, and planner fixture output", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-large-repo-eval-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "a.ts"), "export function loadA() { return 'a'; }\n");
    writeFileSync(
      path.join(repoRoot, "src", "b.ts"),
      "import { loadA } from './a'; export function loadB() { return loadA(); }\n",
    );
    writeFileSync(
      path.join(repoRoot, "tests", "a.test.ts"),
      "import { loadA } from '../src/a'; test('loadA', () => expect(loadA()).toBe('a'));\n",
    );

    try {
      refreshDurableRepoIndex({ repoRoot });
      const relations = queryRepoRelations({
        repoRoot,
        from: "src/b.ts",
        kinds: ["imports"],
        direction: "outbound",
      });
      const relationResults = relations.edges.map((edge) => `${edge.from}->${edge.kind}->${edge.to}`);
      const impact = analyzeChangeImpact({
        repoRoot,
        changedFiles: ["src/a.ts"],
      });
      const search = hybridRepoSearch({
        repoRoot,
        query: "loadB",
        changedFiles: ["src/a.ts"],
        limit: 5,
      });
      const workflow = planWorkflow({
        repoRoot,
        objective: "Find where loadA callers and tests are connected",
        intent: "large_repo_query",
      });
      const score = scoreLargeRepoIntelligence({
        fixtureId: "large-repo-fixture",
        expectedFiles: ["src/b.ts"],
        expectedTests: ["tests/a.test.ts"],
        expectedRelations: ["file:src/b.ts->imports->file:src/a.ts"],
        expectedWorkflowTools: ["repo_intelligence_search", "repo_relation_query", "context_pack_generate", "gate_request"],
        relationResults,
        impactResults: [
          ...impact.impactedFiles.map((file) => file.path),
          ...impact.impactedTests.map((file) => file.path),
        ],
        searchResults: search.results.map((result) => result.path),
        plannedTools: workflow.stages.flatMap((stage) => stage.toolCalls.map((call) => call.toolName)),
      });

      expect(score.metrics.relation_query_precision).toBe(1);
      expect(score.metrics.impact_recall).toBe(1);
      expect(score.metrics.test_selection_recall).toBe(1);
      expect(score.metrics.search_mrr).toBeGreaterThanOrEqual(0.8);
      expect(score.metrics.workflow_completeness).toBe(1);
      expect(score.passed).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
