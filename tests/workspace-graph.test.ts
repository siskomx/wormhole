import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeWorkspaceGraph } from "../src/workspace-graph.js";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

describe("workspace graph", () => {
  it("detects npm workspaces and local dependency edges", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-ws-npm-"));
    try {
      mkdirSync(path.join(repoRoot, "packages", "api"), { recursive: true });
      mkdirSync(path.join(repoRoot, "packages", "core"), { recursive: true });
      writeJson(path.join(repoRoot, "package.json"), { private: true, workspaces: ["packages/*"] });
      writeJson(path.join(repoRoot, "packages", "api", "package.json"), {
        name: "@acme/api",
        dependencies: { "@acme/core": "workspace:*" },
      });
      writeJson(path.join(repoRoot, "packages", "core", "package.json"), { name: "@acme/core" });

      const graph = analyzeWorkspaceGraph({ repoRoot });

      expect(graph.summary).toMatchObject({ repoCount: 1, packageCount: 2, edgeCount: 1, monorepo: true });
      expect(graph.packages.map((pkg) => pkg.name)).toEqual(["@acme/api", "@acme/core"]);
      expect(graph.edges).toContainEqual(
        expect.objectContaining({ fromPackage: "@acme/api", toPackage: "@acme/core" }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("detects pnpm and Cargo workspace members", () => {
    const pnpmRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-ws-pnpm-"));
    const cargoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-ws-cargo-"));
    try {
      mkdirSync(path.join(pnpmRoot, "apps", "web"), { recursive: true });
      writeFileSync(path.join(pnpmRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
      writeJson(path.join(pnpmRoot, "apps", "web", "package.json"), { name: "web" });
      mkdirSync(path.join(cargoRoot, "crates", "api"), { recursive: true });
      writeFileSync(path.join(cargoRoot, "Cargo.toml"), '[workspace]\nmembers = ["crates/api"]\n');
      writeFileSync(path.join(cargoRoot, "crates", "api", "Cargo.toml"), '[package]\nname = "api"\nversion = "0.1.0"\n');

      const graph = analyzeWorkspaceGraph({ repoRoot: pnpmRoot, additionalRepoRoots: [cargoRoot] });

      expect(graph.summary).toMatchObject({ repoCount: 2, crossRepo: true });
      expect(graph.repos.map((repo) => repo.packageManager)).toEqual(["pnpm", "cargo"]);
      expect(graph.packages.map((pkg) => pkg.name)).toEqual(["api", "web"]);
    } finally {
      rmSync(pnpmRoot, { recursive: true, force: true });
      rmSync(cargoRoot, { recursive: true, force: true });
    }
  });
});
