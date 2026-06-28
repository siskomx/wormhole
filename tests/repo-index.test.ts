import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRepoIndex,
  explainRepoIndex,
  findRepoIndexPath,
  getRepoGraphReport,
  normalizeRepoIndexBuildOptions,
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
      expect(summary.indexHealth).toEqual(
        expect.objectContaining({
          schemaVersion: 1,
          source: "repo_index",
          status: "unknown",
          truncated: false,
          recommendedAction: "refresh_index",
        }),
      );
      expect(index.symbols.map((symbol) => symbol.name)).toEqual(
        expect.arrayContaining(["startServer", "HttpServer", "connectDatabase"]),
      );
      expect(index.edges).toContainEqual(
        expect.objectContaining({
          from: "src/server.ts",
          to: "src/db.ts",
          kind: "imports",
          provenance: "extracted",
          confidence: 1,
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
      expect(result.indexHealth.status).toBe("unknown");
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
      expect(explanation.indexHealth.source).toBe("repo_index");
      expect(explanation.outboundEdges).toContainEqual(
        expect.objectContaining({
          to: "src/db.ts",
          kind: "imports",
        }),
      );
      expect(dependencyPath.found).toBe(true);
      expect(dependencyPath.path).toEqual(["src/server.ts", "src/db.ts"]);
      expect(dependencyPath.indexHealth.source).toBe("repo_index");
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

  it("keeps default index caps unchanged and applies the opt-in large-repo preset", () => {
    const defaults = normalizeRepoIndexBuildOptions({ repoRoot: "/repo" });
    const large = normalizeRepoIndexBuildOptions({
      repoRoot: "/repo",
      preset: "large_repo",
    });
    const overridden = normalizeRepoIndexBuildOptions({
      repoRoot: "/repo",
      preset: "large_repo",
      maxFiles: 123,
      maxFileBytes: 456,
      maxTotalBytes: 789,
    });

    expect(defaults).toEqual(
      expect.objectContaining({
        preset: "default",
        maxFiles: 1_000,
        maxFileBytes: 512 * 1024,
        maxTotalBytes: 10 * 1024 * 1024,
      }),
    );
    expect(large).toEqual(
      expect.objectContaining({
        preset: "large_repo",
        maxFiles: 50_000,
        maxFileBytes: 1024 * 1024,
        maxTotalBytes: 512 * 1024 * 1024,
      }),
    );
    expect(overridden).toEqual(
      expect.objectContaining({
        preset: "large_repo",
        maxFiles: 123,
        maxFileBytes: 456,
        maxTotalBytes: 789,
      }),
    );
  });

  it("records the selected build preset on constructed indexes", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-index-preset-"));
    const fileCount = 3;
    for (let index = 0; index < fileCount; index += 1) {
      writeFileSync(
        path.join(repoRoot, `module-${String(index).padStart(4, "0")}.ts`),
        `export const module${index} = ${index};\n`,
      );
    }

    try {
      const defaultIndex = buildRepoIndex({ repoRoot });
      const largeIndex = buildRepoIndex({ repoRoot, preset: "large_repo" });

      expect(defaultIndex.files).toHaveLength(fileCount);
      expect(defaultIndex.truncated).toBe(false);
      expect(defaultIndex.buildOptions.preset).toBe("default");
      expect(largeIndex.files).toHaveLength(fileCount);
      expect(largeIndex.truncated).toBe(false);
      expect(largeIndex.buildOptions.preset).toBe("large_repo");
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
      expect(summary.indexHealth).toEqual(
        expect.objectContaining({
          status: "degraded",
          recommendedAction: "inspect_index_limits",
          skippedFileCount: 2,
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("indexes large symbol batches without spread-argument overflows", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-index-large-"));
    const symbolCount = 1_250;
    const content = Array.from(
      { length: symbolCount },
      (_, index) => `export const largeSymbol${index} = ${index};`,
    ).join("\n");
    writeFileSync(path.join(repoRoot, "large.ts"), `${content}\n`);

    try {
      const index = buildRepoIndex({
        repoRoot,
        maxFileBytes: 1_000_000,
        maxTotalBytes: 1_000_000,
      });

      expect(index.symbols).toHaveLength(symbolCount);
      expect(index.edges.filter((edge) => edge.kind === "defines")).toHaveLength(symbolCount);
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
          provenance: "extracted",
        }),
      );
      expect(index.edges).toContainEqual(
        expect.objectContaining({
          from: "src/server.ts",
          to: expect.stringContaining("src/db.ts#connectDatabase"),
          kind: "references",
          provenance: "inferred",
          confidence: 0.7,
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("indexes Python symbols, relative imports, and call edges", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-index-python-"));
    mkdirSync(path.join(repoRoot, "pkg"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "pkg", "app.py"),
      [
        "from .helpers import load_data",
        "",
        "class Worker:",
        "    pass",
        "",
        "def run_job():",
        "    return load_data()",
      ].join("\n"),
    );
    writeFileSync(
      path.join(repoRoot, "pkg", "helpers.py"),
      [
        "def load_data():",
        "    return 'data'",
      ].join("\n"),
    );

    try {
      const index = buildRepoIndex({ repoRoot });

      expect(index.files.map((file) => [file.path, file.language])).toContainEqual([
        "pkg/app.py",
        "python",
      ]);
      expect(index.symbols.map((symbol) => symbol.name)).toEqual(
        expect.arrayContaining(["Worker", "run_job", "load_data"]),
      );
      expect(index.edges).toContainEqual(
        expect.objectContaining({
          from: "pkg/app.py",
          to: "pkg/helpers.py",
          kind: "imports",
        }),
      );
      expect(index.edges).toContainEqual(
        expect.objectContaining({
          from: expect.stringContaining("pkg/app.py#run_job"),
          to: expect.stringContaining("pkg/helpers.py#load_data"),
          kind: "calls",
          label: "load_data",
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("indexes Rust and C# source files with basic symbols and local edges", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-index-rust-csharp-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "Services"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "Cargo.toml"),
      ["[package]", 'name = "agent-browser"', 'version = "0.1.0"', ""].join("\n"),
    );
    writeFileSync(
      path.join(repoRoot, "src", "lib.rs"),
      [
        "mod router;",
        "pub struct DesktopAgent;",
        "pub fn agent_query() {",
        "    route_query();",
        "}",
      ].join("\n"),
    );
    writeFileSync(path.join(repoRoot, "src", "router.rs"), "pub fn route_query() {}\n");
    writeFileSync(
      path.join(repoRoot, "Services", "PlaybackService.cs"),
      [
        "namespace Jellyfin.Services;",
        "public interface ISessionManager {}",
        "public sealed class PlaybackService",
        "{",
        "    public void StartPlayback() {}",
        "}",
      ].join("\n"),
    );

    try {
      const index = buildRepoIndex({ repoRoot });
      const summary = summarizeRepoIndex(index);

      expect(index.files.map((file) => [file.path, file.language])).toEqual(
        expect.arrayContaining([
          ["src/lib.rs", "rust"],
          ["src/router.rs", "rust"],
          ["Services/PlaybackService.cs", "csharp"],
          ["Cargo.toml", "toml"],
        ]),
      );
      expect(index.symbols.map((symbol) => symbol.name)).toEqual(
        expect.arrayContaining([
          "DesktopAgent",
          "agent_query",
          "route_query",
          "ISessionManager",
          "PlaybackService",
          "StartPlayback",
        ]),
      );
      expect(index.edges).toContainEqual(
        expect.objectContaining({
          from: "src/lib.rs",
          to: "src/router.rs",
          kind: "imports",
        }),
      );
      expect(summary.indexHealth.languageCoverage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ language: "rust", indexedFileCount: 2, totalFileCount: 2 }),
          expect.objectContaining({ language: "csharp", indexedFileCount: 1, totalFileCount: 1 }),
        ]),
      );
      expect(summary.indexHealth.status).not.toBe("degraded");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("marks health degraded when supported dominant language files are excluded from the index", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-index-language-gap-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "Cargo.toml"), "[package]\nname = \"gap\"\nversion = \"0.1.0\"\n");
    writeFileSync(path.join(repoRoot, "src", "lib.rs"), "pub fn missing_from_index() {}\n");
    writeFileSync(path.join(repoRoot, "README.md"), "# Gap\n");

    try {
      const index = buildRepoIndex({ repoRoot, include: ["README.md"] });
      const summary = summarizeRepoIndex(index);

      expect(summary.indexHealth.status).toBe("degraded");
      expect(summary.indexHealth.languageCoverage).toContainEqual(
        expect.objectContaining({
          language: "rust",
          totalFileCount: 1,
          indexedFileCount: 0,
          status: "blocker",
        }),
      );
      expect(summary.indexHealth.reasons.join("\n")).toContain("Language coverage missing for Rust");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("generates a graph report from the native index", () => {
    const repoRoot = createFixtureRepo();

    try {
      const index = buildRepoIndex({ repoRoot });
      const report = getRepoGraphReport(index);

      expect(report.summary).toContain("3 files");
      expect(report.indexHealth.source).toBe("repo_index");
      expect(report.edgeCountsByProvenance.extracted).toBeGreaterThan(0);
      expect(report.markdown).toContain("## Native Repo Graph Report");
      expect(report.topFiles[0]).toEqual(
        expect.objectContaining({
          path: expect.any(String),
          edgeCount: expect.any(Number),
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
