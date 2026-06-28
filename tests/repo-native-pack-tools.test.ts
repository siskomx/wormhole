import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel, createToolHandlers } from "../src/index.js";

describe("repo native pack tools", () => {
  it("builds repo native packs and feature slices through tool handlers", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-native-tools-"));
    try {
      mkdirSync(path.join(repoRoot, "src", "features", "tickets"), { recursive: true });
      writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "vitest run tests" } }));
      writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
      writeFileSync(path.join(repoRoot, "src", "features", "tickets", "TicketView.tsx"), "export function TicketView() { return null; }\n");

      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const pack = tools.repoNativePackBuild({ repoRoot, objective: "Fix tickets", query: "tickets" });
      const slice = tools.featureSliceQuery({ repoRoot, query: "tickets" });

      expect(pack.schemaVersion).toBe("repo-native-pack.v0");
      expect(slice.slices.map((item) => item.featureId)).toContain("tickets");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
