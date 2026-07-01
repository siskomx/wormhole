import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { refreshDurableRepoIndex } from "../src/durable-index-store.js";
import { refreshGraphNodeSemanticIndex } from "../src/graph-node-semantic.js";
import { hybridRepoSearch } from "../src/hybrid-repo-search.js";
import { buildRepoIndex } from "../src/repo-index.js";

describe("hybrid repo search", () => {
  it("ranks exact symbol matches above generic content hits", () => {
    const repoRoot = createSearchFixture();

    try {
      refreshDurableRepoIndex({ repoRoot });
      const result = hybridRepoSearch({ repoRoot, query: "loadCustomer", limit: 5 });

      expect(result.results[0]).toEqual(
        expect.objectContaining({
          kind: "symbol",
          path: "src/customer.ts",
          sources: expect.arrayContaining(["sqlite"]),
        }),
      );
      expect(result.results[0]?.evidence.join("\n")).toContain("sqlite");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("adds graph-node semantic source evidence when available", () => {
    const repoRoot = createSearchFixture();

    try {
      refreshDurableRepoIndex({ repoRoot });
      const index = buildRepoIndex({ repoRoot });
      refreshGraphNodeSemanticIndex({ repoRoot, index });

      const result = hybridRepoSearch({ repoRoot, query: "billing workflow", limit: 5 });

      expect(result.results.some((entry) => entry.sources.includes("semantic"))).toBe(true);
      expect(result.results.flatMap((entry) => entry.evidence).join("\n")).toContain("semantic:deterministic-token-overlap");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("adds relation-neighbor results for changed files", () => {
    const repoRoot = createSearchFixture();

    try {
      refreshDurableRepoIndex({ repoRoot });
      const result = hybridRepoSearch({
        repoRoot,
        query: "customer",
        changedFiles: ["src/customer.ts"],
        limit: 10,
      });

      const route = result.results.find((entry) => entry.path === "src/customer-route.ts");
      expect(route?.sources).toEqual(expect.arrayContaining(["relation", "graph_distance"]));
      expect(route?.evidence.join("\n")).toContain("relation:");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("warns about missing semantic index but still returns lexical results", () => {
    const repoRoot = createSearchFixture();

    try {
      refreshDurableRepoIndex({ repoRoot });
      const result = hybridRepoSearch({ repoRoot, query: "loadCustomer", limit: 5 });

      expect(result.warnings.join("\n")).toContain("Graph-node semantic index is missing");
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0]?.sources).toEqual(expect.arrayContaining(["lexical", "sqlite"]));
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

function createSearchFixture(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-hybrid-search-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "src", "customer.ts"),
    ["export function loadCustomer() {", "  return 'customer record';", "}", ""].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "customer-route.ts"),
    ["import { loadCustomer } from './customer';", "export function customerRoute() {", "  return loadCustomer();", "}", ""].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "notes.ts"),
    "export const notes = 'generic customer billing workflow notes';\n",
  );
  return repoRoot;
}
