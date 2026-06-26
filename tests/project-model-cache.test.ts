import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import {
  createProjectModelCache,
  type ProjectModelCache,
} from "../src/project-intelligence.js";
import { buildRepoIndex, type RepoIndexBuildOptions } from "../src/repo-index.js";
import { createToolHandlers } from "../src/tools.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-project-model-cache-"));
  mkdirSync(path.join(repoRoot, "src", "api"), { recursive: true });
  mkdirSync(path.join(repoRoot, "src", "services"), { recursive: true });
  mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        scripts: {
          build: "tsc -p tsconfig.json",
          test: "vitest run tests",
        },
        dependencies: { express: "^5.0.0" },
        devDependencies: { typescript: "^6.0.0", vitest: "^4.0.0" },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), "{}\n");
  writeFileSync(path.join(repoRoot, "tsconfig.json"), "{}\n");
  writeFileSync(
    path.join(repoRoot, "src", "services", "user-service.ts"),
    [
      "export type User = { id: string; name: string };",
      "export function loadUser(id: string): User {",
      "  return { id, name: 'Ada' };",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "api", "users.ts"),
    [
      "import { loadUser } from '../services/user-service';",
      "export function registerUserRoutes(app: { get(path: string, handler: unknown): void }) {",
      "  app.get('/users/:id', () => loadUser('42'));",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "tests", "user-service.test.ts"),
    [
      "import { loadUser } from '../src/services/user-service';",
      "test('loads users', () => {",
      "  expect(loadUser('7').name).toBe('Ada');",
      "});",
    ].join("\n"),
  );
  return repoRoot;
}

function countingCache(counter: { builds: number }): ProjectModelCache {
  return createProjectModelCache({
    freshnessTtlMs: 60_000,
    indexBuilder(options: RepoIndexBuildOptions) {
      counter.builds += 1;
      return buildRepoIndex(options);
    },
  });
}

describe("project model cache", () => {
  it("reuses one project model across agent context preparation", () => {
    const repoRoot = createFixtureRepo();
    const counter = { builds: 0 };
    const projectModelCache = countingCache(counter);
    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
        projectModelCache,
      });

      const prepared = tools.agentContextPrepare({
        repoRoot,
        objective: "Change user loading behavior",
        query: "load user API tests",
        changedFiles: ["src/services/user-service.ts"],
        maxChars: 2_000,
      });

      expect(prepared.contextPack.rendered).toContain("Context Pack");
      expect(counter.builds).toBe(1);
      expect(projectModelCache.stats()).toEqual(
        expect.objectContaining({
          entries: 1,
          hits: expect.any(Number),
          misses: 1,
        }),
      );
      expect(projectModelCache.stats().hits).toBeGreaterThan(0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reuses the cached index for focused verification planning", () => {
    const repoRoot = createFixtureRepo();
    const counter = { builds: 0 };
    const projectModelCache = countingCache(counter);
    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
        projectModelCache,
      });

      tools.projectIntelligenceSnapshot({
        repoRoot,
        objective: "Change user loading behavior",
        changedFiles: ["src/services/user-service.ts"],
      });
      const buildsAfterSnapshot = counter.builds;
      const plan = tools.testPlanSelect({
        repoRoot,
        changedFiles: ["src/services/user-service.ts"],
        tier: "focused",
      });

      expect(plan.commands.map((command) => command.name)).toEqual(
        expect.arrayContaining(["test", "build"]),
      );
      expect(counter.builds).toBe(buildsAfterSnapshot);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
