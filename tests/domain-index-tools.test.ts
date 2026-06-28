import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

function createRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-domain-tools-"));
  mkdirSync(path.join(repoRoot, ".wormhole"), { recursive: true });
  mkdirSync(path.join(repoRoot, "backend", "src", "modules", "tickets"), { recursive: true });
  mkdirSync(path.join(repoRoot, "migrations"), { recursive: true });
  writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(
    path.join(repoRoot, ".wormhole", "domain-index.json"),
    JSON.stringify({
      features: [{ featureId: "tickets", aliases: ["ticket"], roots: ["backend/src/modules/tickets"], tables: ["tickets"] }],
      fileGroups: {
        routes: ["backend/src/modules/*/*Routes.ts"],
        hooks: [],
        services: [],
        migrations: ["migrations/*.sql"],
        openapi: [],
        conventions: [],
        memory: [],
      },
    }),
  );
  writeFileSync(
    path.join(repoRoot, "backend", "src", "modules", "tickets", "TicketRoutes.ts"),
    "export function registerTicketRoutes(app) { app.get('/api/tickets', () => {}); }\n",
  );
  writeFileSync(path.join(repoRoot, "migrations", "001_tickets.sql"), "create table tickets(id text primary key);\n");
  return repoRoot;
}

describe("domain index tool handlers", () => {
  it("exposes refresh, status, slice, API, table, coverage, drift, and gate queries", () => {
    const repoRoot = createRepo();
    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });

      const refreshed = tools.domainIndexRefresh({ repoRoot });
      const status = tools.domainIndexStatus({ repoRoot });
      const slice = tools.domainSliceQuery({ repoRoot, feature: "ticket", requireFresh: true });
      const api = tools.domainApiQuery({ repoRoot, feature: "tickets", requireFresh: true });
      const table = tools.domainTableQuery({ repoRoot, table: "tickets", requireFresh: true });
      const coverage = tools.domainIndexCoverage({ repoRoot, requireFresh: true });
      const drift = tools.domainIndexDrift({ repoRoot });
      const gate = tools.domainVerificationGatePlan({ repoRoot, feature: "tickets", requireFresh: true });

      expect(refreshed.summary.featureCount).toBe(1);
      expect(status?.fresh).toBe(true);
      expect(slice.feature?.featureId).toBe("tickets");
      expect(api.endpoints.map((endpoint) => endpoint.pathTemplate)).toContain("/api/tickets");
      expect(table.table?.name).toBe("tickets");
      expect(coverage.gaps.map((gap) => gap.kind)).toContain("route-without-openapi");
      expect(drift.fresh).toBe(true);
      expect(gate.gates).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back to repo-native feature slices when a fresh domain index is required but missing", () => {
    const repoRoot = createRepo();
    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });

      const result = tools.domainSliceQuery({ repoRoot, feature: "tickets", requireFresh: true });

      expect(result.refused).toBe(true);
      expect(result.indexHealth.status).toBe("missing");
      expect("fallbackFeatureSlice" in result).toBe(true);
      if (!("fallbackFeatureSlice" in result)) {
        throw new Error("Expected domainSliceQuery to return fallbackFeatureSlice.");
      }
      expect(result.fallbackFeatureSlice.slices[0]?.featureId).toBe("tickets");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
