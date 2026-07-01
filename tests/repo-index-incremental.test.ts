import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPO_INDEX_EXTRACTOR_VERSION,
  buildRepoIndex,
  createRepoIndexFingerprintFromEntries,
  type RepoIndex,
} from "../src/repo-index.js";
import { refreshRepoIndexIncremental } from "../src/repo-index-incremental.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-incremental-index-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "src", "a.ts"),
    [
      "export function loadA() {",
      "  return 'a';",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "b.ts"),
    [
      "import { loadA } from './a';",
      "",
      "export function loadB() {",
      "  return loadA();",
      "}",
    ].join("\n"),
  );
  return repoRoot;
}

function mutateIndex(index: RepoIndex, patch: Partial<RepoIndex>): RepoIndex {
  return {
    ...index,
    ...patch,
    buildOptions: { ...index.buildOptions, ...patch.buildOptions },
    files: [...(patch.files ?? index.files)],
    symbols: [...(patch.symbols ?? index.symbols)],
    edges: [...(patch.edges ?? index.edges)],
    skippedFiles: [...(patch.skippedFiles ?? index.skippedFiles)],
    ...(patch.fingerprintEntries
      ? { fingerprintEntries: [...patch.fingerprintEntries] }
      : index.fingerprintEntries
        ? { fingerprintEntries: [...index.fingerprintEntries] }
        : {}),
  };
}

describe("incremental repo index refresh", () => {
  it("reindexes only changed files and reuses unchanged file records", () => {
    const repoRoot = createFixtureRepo();

    try {
      const previousIndex = buildRepoIndex({ repoRoot });
      const previousB = previousIndex.files.find((file) => file.path === "src/b.ts");
      writeFileSync(
        path.join(repoRoot, "src", "a.ts"),
        [
          "export function loadA() {",
          "  return 'a2';",
          "}",
        ].join("\n"),
      );

      const result = refreshRepoIndexIncremental({
        repoRoot,
        changedFiles: ["src/a.ts"],
        previousIndex,
      });

      expect(result.refreshMode).toBe("incremental");
      expect(result.incremental).toBe(true);
      expect(result.fallbackReason).toBeUndefined();
      expect(result.previousFingerprint).toBe(previousIndex.fingerprint);
      expect(result.changedFiles).toEqual(["src/a.ts"]);
      expect(result.reindexedFiles).toEqual(["src/a.ts"]);
      expect(result.removedFiles).toEqual([]);
      expect(result.reusedFileCount).toBe(1);
      expect(result.index.files.find((file) => file.path === "src/b.ts")).toBe(previousB);
      expect(result.index.files.find((file) => file.path === "src/a.ts")?.content).toContain("a2");
      expect(result.index.edges).toContainEqual(
        expect.objectContaining({
          from: "src/b.ts",
          to: "src/a.ts",
          kind: "imports",
        }),
      );
      expect(result.factGraph.fingerprint).toBe(result.fingerprint);
      expect(result.factGraph.nodes).toContainEqual(
        expect.objectContaining({ id: "file:src/a.ts", path: "src/a.ts" }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("prunes stale outbound edges from changed files while preserving inbound file relations", () => {
    const repoRoot = createFixtureRepo();

    try {
      const previousIndex = buildRepoIndex({ repoRoot });
      writeFileSync(
        path.join(repoRoot, "src", "b.ts"),
        [
          "export function loadB() {",
          "  return 'b2';",
          "}",
        ].join("\n"),
      );

      const result = refreshRepoIndexIncremental({
        repoRoot,
        changedFiles: ["src/b.ts"],
        previousIndex,
      });

      expect(result.refreshMode).toBe("incremental");
      expect(result.index.edges).not.toContainEqual(
        expect.objectContaining({
          from: "src/b.ts",
          to: "src/a.ts",
          kind: "imports",
        }),
      );
      expect(result.index.edges).toContainEqual(
        expect.objectContaining({
          from: "src/b.ts",
          to: expect.stringContaining("src/b.ts#loadB"),
          kind: "defines",
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("adds changed files that were omitted from a truncated prior index", () => {
    const repoRoot = createFixtureRepo();

    try {
      const fullIndex = buildRepoIndex({ repoRoot });
      const bFile = fullIndex.files.find((file) => file.path === "src/b.ts");
      expect(bFile).toBeDefined();
      const fingerprintEntries = (fullIndex.fingerprintEntries ?? []).filter(
        (entry) => !entry.startsWith("indexed:src/b.ts:"),
      );
      const previousIndex = mutateIndex(fullIndex, {
        files: fullIndex.files.filter((file) => file.path !== "src/b.ts"),
        symbols: fullIndex.symbols.filter((symbol) => symbol.path !== "src/b.ts"),
        edges: fullIndex.edges.filter((edge) => !edge.from.includes("src/b.ts") && !edge.to.includes("src/b.ts")),
        truncated: true,
        skippedFiles: ["src/b.ts"],
        skipReasons: ["time_limit"],
        fingerprintEntries,
        fingerprint: createRepoIndexFingerprintFromEntries(fingerprintEntries),
      });
      writeFileSync(
        path.join(repoRoot, "src", "b.ts"),
        [
          "import { loadA } from './a';",
          "",
          "export function loadB() {",
          "  return `${loadA()} changed`;",
          "}",
        ].join("\n"),
      );

      const result = refreshRepoIndexIncremental({
        repoRoot,
        changedFiles: ["src/b.ts"],
        previousIndex,
      });

      expect(result.refreshMode).toBe("incremental");
      expect(result.reindexedFiles).toEqual(["src/b.ts"]);
      expect(result.index.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
      expect(result.index.files.find((file) => file.path === "src/b.ts")?.content).toContain("changed");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("removes deleted files and prunes their fact nodes and edges", () => {
    const repoRoot = createFixtureRepo();

    try {
      const previousIndex = buildRepoIndex({ repoRoot });
      unlinkSync(path.join(repoRoot, "src", "b.ts"));

      const result = refreshRepoIndexIncremental({
        repoRoot,
        changedFiles: ["src/b.ts"],
        previousIndex,
      });

      expect(result.refreshMode).toBe("incremental");
      expect(result.removedFiles).toEqual(["src/b.ts"]);
      expect(result.reindexedFiles).toEqual([]);
      expect(result.reusedFileCount).toBe(1);
      expect(result.index.files.map((file) => file.path)).toEqual(["src/a.ts"]);
      expect(result.index.symbols.map((symbol) => symbol.path)).not.toContain("src/b.ts");
      expect(result.index.edges.some((edge) => edge.from.includes("src/b.ts") || edge.to.includes("src/b.ts"))).toBe(false);
      expect(result.factGraph.nodes.map((node) => node.id)).not.toContain("file:src/b.ts");
      expect(
        result.factGraph.edges.some((edge) => edge.from.includes("src/b.ts") || edge.to.includes("src/b.ts")),
      ).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back when build options change", () => {
    const repoRoot = createFixtureRepo();

    try {
      const previousIndex = buildRepoIndex({ repoRoot });

      const result = refreshRepoIndexIncremental({
        repoRoot,
        changedFiles: ["src/a.ts"],
        previousIndex,
        buildOptions: { include: ["src/a.ts"] },
      });

      expect(result.refreshMode).toBe("full_rebuild");
      expect(result.incremental).toBe(false);
      expect(result.fallbackReason).toBe("build_options_changed");
      expect(result.index.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back when the extractor version changed", () => {
    const repoRoot = createFixtureRepo();

    try {
      const previousIndex = mutateIndex(buildRepoIndex({ repoRoot }), {
        extractorVersion: `${REPO_INDEX_EXTRACTOR_VERSION}-old`,
      });

      const result = refreshRepoIndexIncremental({
        repoRoot,
        changedFiles: ["src/a.ts"],
        previousIndex,
      });

      expect(result.refreshMode).toBe("full_rebuild");
      expect(result.incremental).toBe(false);
      expect(result.fallbackReason).toBe("extractor_version_changed");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back when the prior fingerprint does not match its entries", () => {
    const repoRoot = createFixtureRepo();

    try {
      const previousIndex = mutateIndex(buildRepoIndex({ repoRoot }), {
        fingerprint: "not-the-entry-hash",
      });

      const result = refreshRepoIndexIncremental({
        repoRoot,
        changedFiles: ["src/a.ts"],
        previousIndex,
      });

      expect(result.refreshMode).toBe("full_rebuild");
      expect(result.incremental).toBe(false);
      expect(result.fallbackReason).toBe("previous_index_stale");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
