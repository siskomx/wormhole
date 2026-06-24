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

  it("preserves underscores in code symbols", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-index-underscore-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "users.ts"),
      [
        "export function load_user_profile() {",
        "  return 'ok';",
        "}",
      ].join("\n"),
    );

    try {
      const index = buildRepoIndex({ repoRoot });
      const explanation = explainRepoIndex(index, { target: "load_user_profile" });

      expect(index.symbols.map((symbol) => symbol.name)).toContain("load_user_profile");
      expect(explanation.resolved?.name).toBe("load_user_profile");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("treats include and exclude filters as path patterns instead of substrings", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-index-filter-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "latest.ts"), "export const latest = true;\n");
    writeFileSync(path.join(repoRoot, "src", "test.ts"), "export const test = true;\n");
    writeFileSync(path.join(repoRoot, "notes.txt"), "outside src\n");

    try {
      const index = buildRepoIndex({
        repoRoot,
        include: ["src"],
        exclude: ["test"],
      });

      expect(index.files.map((file) => file.path)).toEqual(["src/latest.ts"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("marks the index incomplete when files are skipped for size", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-index-skip-"));
    writeFileSync(path.join(repoRoot, "small.ts"), "export const small = true;\n");
    writeFileSync(path.join(repoRoot, "large.ts"), "export const large = 'too large';\n");

    try {
      const index = buildRepoIndex({
        repoRoot,
        maxFileBytes: 10,
      });
      const summary = summarizeRepoIndex(index);

      expect(summary.truncated).toBe(true);
      expect(summary.skippedFiles).toContain("large.ts");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("indexes markdown links and code references as graph edges", () => {
    const repoRoot = createFixtureRepo();

    try {
      writeFileSync(
        path.join(repoRoot, "README.md"),
        ["# Fixture Service", "", "See [database module](src/db.ts)."].join("\n"),
      );
      const index = buildRepoIndex({ repoRoot });

      expect(index.edges).toContainEqual(
        expect.objectContaining({
          from: "README.md",
          to: "src/db.ts",
          kind: "links",
        }),
      );
      expect(index.edges).toContainEqual(
        expect.objectContaining({
          from: "src/server.ts",
          to: expect.stringContaining("src/db.ts#connectDatabase"),
          kind: "references",
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
