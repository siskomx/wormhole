import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRepoIndex,
  explainRepoIndex,
  findRepoIndexPath,
  queryRepoIndex,
  summarizeRepoIndex,
} from "../src/repo-index.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-index-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "src", "server.ts"),
    [
      'import { connectDatabase } from "./db";',
      "",
      "export function startServer() {",
      "  return connectDatabase('primary');",
      "}",
      "",
      "export class HttpServer {}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "db.ts"),
    [
      "export function connectDatabase(name: string) {",
      "  return `database pool ${name}`;",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "README.md"),
    ["# Fixture Service", "", "The API uses a database pool."].join("\n"),
  );
  return repoRoot;
}

describe("repo index", () => {
  it("builds a deterministic file, symbol, and edge graph", () => {
    const repoRoot = createFixtureRepo();

    try {
      const index = buildRepoIndex({ repoRoot });
      const summary = summarizeRepoIndex(index);

      expect(summary.fileCount).toBe(3);
      expect(summary.symbolCount).toBeGreaterThanOrEqual(4);
      expect(summary.edgeCount).toBeGreaterThanOrEqual(1);
      expect(index.symbols.map((symbol) => symbol.name)).toEqual(
        expect.arrayContaining(["startServer", "HttpServer", "connectDatabase"]),
      );
      expect(index.edges).toContainEqual(
        expect.objectContaining({
          from: "src/server.ts",
          to: "src/db.ts",
          kind: "imports",
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("queries source and documentation snippets", () => {
    const repoRoot = createFixtureRepo();

    try {
      const index = buildRepoIndex({ repoRoot });
      const result = queryRepoIndex(index, {
        query: "database pool",
        limit: 5,
      });

      expect(result.results[0]).toEqual(
        expect.objectContaining({
          path: expect.stringMatching(/^(README\.md|src\/db\.ts)$/),
        }),
      );
      expect(result.results.map((entry) => entry.excerpt).join("\n")).toContain("database pool");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("explains symbols and follows graph paths", () => {
    const repoRoot = createFixtureRepo();

    try {
      const index = buildRepoIndex({ repoRoot });
      const explanation = explainRepoIndex(index, { target: "startServer" });
      const dependencyPath = findRepoIndexPath(index, {
        from: "src/server.ts",
        to: "src/db.ts",
      });

      expect(explanation.resolved).toEqual(
        expect.objectContaining({
          name: "startServer",
          path: "src/server.ts",
        }),
      );
      expect(explanation.outboundEdges).toContainEqual(
        expect.objectContaining({
          to: "src/db.ts",
          kind: "imports",
        }),
      );
      expect(dependencyPath.found).toBe(true);
      expect(dependencyPath.path).toEqual(["src/server.ts", "src/db.ts"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
