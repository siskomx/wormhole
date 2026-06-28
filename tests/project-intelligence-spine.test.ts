import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import {
  analyzeBlastRadius,
  createArchitectureMap,
  discoverEntrypointFlows,
  generateProjectContextPack,
} from "../src/project-intelligence.js";
import { createToolHandlers } from "../src/tools.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-project-intel-"));
  mkdirSync(path.join(repoRoot, ".github"), { recursive: true });
  mkdirSync(path.join(repoRoot, "src", "api"), { recursive: true });
  mkdirSync(path.join(repoRoot, "src", "services"), { recursive: true });
  mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        scripts: {
          start: "node dist/server.js",
          worker: "node dist/worker.js",
          test: "vitest run tests",
        },
        dependencies: { express: "^5.0.0" },
        devDependencies: { vitest: "^4.0.0", typescript: "^6.0.0" },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(path.join(repoRoot, ".github", "CODEOWNERS"), "src/services/ @backend\nsrc/api/ @api\n");
  writeFileSync(
    path.join(repoRoot, "src", "services", "user-service.ts"),
    [
      "export type User = { id: string; name: string };",
      "export function loadUser(id: string): User {",
      "  return { id, name: 'Ada' };",
      "}",
      "export function formatUser(user: User): string {",
      "  return `${user.name}:${user.id}`;",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "api", "users.ts"),
    [
      "import { loadUser, formatUser } from '../services/user-service';",
      "export function registerUserRoutes(app: { get(path: string, handler: unknown): void }) {",
      "  app.get('/users/:id', () => formatUser(loadUser('42')));",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "cli.ts"),
    [
      "#!/usr/bin/env node",
      "import { loadUser } from './services/user-service';",
      "export function main() {",
      "  console.log(loadUser('cli').name);",
      "}",
      "main();",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "worker.ts"),
    [
      "import { loadUser } from './services/user-service';",
      "export async function runWorker() {",
      "  return loadUser('worker');",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "tests", "user-service.test.ts"),
    [
      "import { loadUser, formatUser } from '../src/services/user-service';",
      "test('formats users', () => {",
      "  expect(formatUser(loadUser('7'))).toBe('Ada:7');",
      "});",
    ].join("\n"),
  );
  return repoRoot;
}

describe("native project intelligence spine", () => {
  it("creates an architecture map with modules, ownership, dependencies, and evidence", () => {
    const repoRoot = createFixtureRepo();
    try {
      const map = createArchitectureMap({ repoRoot });

      expect(map.indexHealth.source).toBe("repo_index");
      expect(map.summary.moduleCount).toBeGreaterThanOrEqual(3);
      expect(map.modules.map((module) => module.rootPath)).toContain("src/services");
      expect(map.modules.find((module) => module.rootPath === "src/services")?.owners).toContain("@backend");
      expect(map.modules.find((module) => module.rootPath === "src/api")?.dependencies).toContain("src/services");
      expect(map.modules.flatMap((module) => module.evidence).some((evidence) => evidence.sourcePath === ".github/CODEOWNERS")).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("discovers API, CLI, worker, and script entrypoints with downstream files", () => {
    const repoRoot = createFixtureRepo();
    try {
      const flows = discoverEntrypointFlows({ repoRoot });

      expect(flows.entrypoints.map((entrypoint) => entrypoint.kind)).toEqual(
        expect.arrayContaining(["api", "cli", "worker", "script"]),
      );
      expect(flows.entrypoints.find((entrypoint) => entrypoint.path === "src/api/users.ts")?.downstreamFiles).toContain(
        "src/services/user-service.ts",
      );
      expect(flows.entrypoints.find((entrypoint) => entrypoint.name === "worker")?.command).toBe("node dist/worker.js");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("analyzes blast radius from changed files and symbols", () => {
    const repoRoot = createFixtureRepo();
    try {
      const radius = analyzeBlastRadius({
        repoRoot,
        changedFiles: ["src/services/user-service.ts"],
        diffText:
          "@@ -2,3 +2,3 @@\n-export function loadUser(id: string): User {\n+export function loadUser(id: string): User {\n",
      });

      expect(radius.indexHealth.source).toBe("repo_index");
      expect(radius.changedSymbols.map((symbol) => symbol.name)).toContain("loadUser");
      expect(radius.impactedFiles.map((file) => file.path)).toEqual(
        expect.arrayContaining(["src/api/users.ts", "src/cli.ts", "src/worker.ts", "tests/user-service.test.ts"]),
      );
      expect(radius.impactedEntrypoints.map((entrypoint) => entrypoint.path)).toEqual(
        expect.arrayContaining(["src/api/users.ts", "src/cli.ts", "src/worker.ts"]),
      );
      expect(radius.verification.likelyTests.map((test) => test.path)).toContain("tests/user-service.test.ts");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("generates a task-scoped context pack from the native project model", () => {
    const repoRoot = createFixtureRepo();
    try {
      const pack = generateProjectContextPack({
        repoRoot,
        objective: "Change user loading behavior",
        query: "load user API tests",
        changedFiles: ["src/services/user-service.ts"],
        maxChars: 4_000,
      });

      expect(pack.indexHealth.source).toBe("repo_index");
      expect(pack.sources).toEqual(
        expect.arrayContaining([
          "src/services/user-service.ts",
          "src/api/users.ts",
          "tests/user-service.test.ts",
        ]),
      );
      expect(pack.rendered).toContain("Architecture Modules");
      expect(pack.rendered).toContain("Blast Radius");
      expect(pack.stats.renderedChars).toBeLessThanOrEqual(4_000);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("renders degraded index health in task context packs", () => {
    const repoRoot = createFixtureRepo();
    try {
      const pack = generateProjectContextPack({
        repoRoot,
        objective: "Change user loading behavior",
        query: "load user API tests",
        maxChars: 4_000,
        indexOptions: {
          maxFiles: 1,
        },
      });

      expect(pack.indexHealth.status).toBe("degraded");
      expect(pack.rendered).toContain("Index Health");
      expect(pack.rendered).toContain("degraded");
      expect(pack.rendered).toContain("inspect_index_limits");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("prefers current code over equally matching docs in context source selection", () => {
    const repoRoot = createFixtureRepo();
    try {
      mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
      mkdirSync(path.join(repoRoot, "src", "current"), { recursive: true });
      for (let index = 0; index < 6; index += 1) {
        writeFileSync(
          path.join(repoRoot, "docs", `accounting-${index}.md`),
          "ledger close period reconciliation\n",
        );
      }
      writeFileSync(
        path.join(repoRoot, "src", "current", "state.ts"),
        "export function closeLedgerPeriod() { return 'ledger close period reconciliation'; }\n",
      );

      const pack = generateProjectContextPack({
        repoRoot,
        objective: "Plan ledger close period work",
        query: "ledger close period reconciliation",
        maxChars: 4_000,
      });

      expect(pack.sources).toContain("src/current/state.ts");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("exposes the native project intelligence spine through tool handlers", () => {
    const repoRoot = createFixtureRepo();
    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });

      expect(tools.architectureMap({ repoRoot }).indexHealth.source).toBe("repo_index");
      expect(tools.entrypointFlowDiscover({ repoRoot }).entrypoints.length).toBeGreaterThan(0);
      expect(tools.blastRadiusAnalyze({ repoRoot, changedFiles: ["src/services/user-service.ts"] }).impactedFiles.length).toBeGreaterThan(0);
      expect(
        tools.contextPackGenerate({
          repoRoot,
          objective: "Change user loading behavior",
          query: "load user",
          changedFiles: ["src/services/user-service.ts"],
          maxChars: 2_000,
        }).rendered,
      ).toContain("Context Pack");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
