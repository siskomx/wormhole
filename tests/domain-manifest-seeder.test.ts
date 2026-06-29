import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

type DomainManifestToolHandlers = {
  domainManifestGenerate(input: { repoRoot: string }): {
    manifestPath: string;
    candidateHash: string;
    manifest: {
      features: Array<{
        featureId: string;
        aliases: string[];
        roots: string[];
        portals: string[];
        tables: string[];
      }>;
      fileGroups: { routes: string[]; services: string[]; migrations: string[]; conventions: string[] };
      verificationGates: Array<{ gateId: string; scriptNames: string[]; whenFeatureTouches: string[] }>;
    };
    warnings: string[];
  };
  domainManifestDiff(input: { repoRoot: string }): {
    baseHash: string;
    candidateHash: string;
    operations: Array<{ kind: string; featureId?: string; group?: string; current?: unknown; candidate?: unknown }>;
  };
  domainManifestStatus(input: { repoRoot: string }): {
    present: boolean;
    valid: boolean;
    pendingOperationCount: number;
    operationCounts: Record<string, number>;
  };
  domainManifestApply(input: { repoRoot: string; baseHash: string; refreshAfterApply?: boolean }): {
    manifestPath: string;
    backupPath?: string;
    appliedOperationCount: number;
    manifest: { features: Array<{ featureId: string }> };
  };
};

function domainManifestTools(tools: ReturnType<typeof createToolHandlers>): DomainManifestToolHandlers {
  return tools as ReturnType<typeof createToolHandlers> & DomainManifestToolHandlers;
}

function createFixtureRepo(options: { existingManifest?: boolean; includeCustomers?: boolean } = {}): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-domain-seeder-"));
  mkdirSync(path.join(repoRoot, ".wormhole"), { recursive: true });
  mkdirSync(path.join(repoRoot, "backend", "src", "modules", "tickets"), { recursive: true });
  mkdirSync(path.join(repoRoot, "migrations"), { recursive: true });
  mkdirSync(path.join(repoRoot, "docs", "conventions"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ scripts: { test: "vitest run", "lint:tenant": "eslint ." } }, null, 2),
  );
  writeFileSync(
    path.join(repoRoot, "backend", "src", "modules", "tickets", "TicketRoutes.ts"),
    "export function registerTicketRoutes(app) { app.get('/api/tickets', () => {}); app.post('/api/tickets', () => {}); }\n",
  );
  writeFileSync(
    path.join(repoRoot, "backend", "src", "modules", "tickets", "TicketService.ts"),
    "export class TicketService { async listTickets() { return []; } }\n",
  );
  writeFileSync(path.join(repoRoot, "migrations", "001_tickets.sql"), "create table tickets(id text primary key);\n");
  writeFileSync(path.join(repoRoot, "docs", "conventions", "tenant-isolation.md"), "# Tenant isolation\n");

  if (options.includeCustomers) {
    mkdirSync(path.join(repoRoot, "backend", "src", "modules", "customers"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "backend", "src", "modules", "customers", "CustomerRoutes.ts"),
      "export function registerCustomerRoutes(app) { app.get('/api/customers', () => {}); }\n",
    );
  }

  if (options.existingManifest) {
    writeFileSync(
      path.join(repoRoot, ".wormhole", "domain-index.json"),
      JSON.stringify(
        {
          schemaVersion: "domain-index.v0",
          features: [
            {
              featureId: "tickets",
              displayName: "Ticket Desk",
              aliases: ["ticket"],
              roots: ["backend/src/modules/tickets"],
              portals: ["admin"],
              tables: ["tickets"],
            },
          ],
          fileGroups: {
            routes: ["backend/src/modules/*/*Routes.ts"],
            hooks: [],
            services: [],
            migrations: ["migrations/*.sql"],
            openapi: [],
            conventions: ["docs/conventions/*.md"],
            memory: [],
          },
          verificationGates: [
            {
              gateId: "tenant-isolation",
              scriptNames: ["lint:tenant"],
              whenFeatureTouches: ["authz", "database_schema"],
            },
          ],
        },
        null,
        2,
      ),
    );
  }

  return repoRoot;
}

describe("domain manifest seeder lifecycle", () => {
  it("generates a domain manifest candidate from generic repo evidence", () => {
    const repoRoot = createFixtureRepo();
    try {
      const tools = domainManifestTools(createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] }));

      const result = tools.domainManifestGenerate({ repoRoot });

      const tickets = result.manifest.features.find((feature) => feature.featureId === "tickets");
      expect(result.manifestPath).toBe(path.join(repoRoot, ".wormhole", "domain-index.json"));
      expect(result.candidateHash).toMatch(/^[a-f0-9]{64}$/);
      expect(tickets?.roots).toContain("backend/src/modules/tickets");
      expect(tickets?.tables).toContain("tickets");
      expect(result.manifest.fileGroups.routes).toContain("backend/src/modules/*/*Routes.ts");
      expect(result.manifest.fileGroups.services).toContain("backend/src/modules/**/*Service.ts");
      expect(result.manifest.fileGroups.migrations).toContain("migrations/*.sql");
      expect(result.manifest.fileGroups.conventions).toContain("docs/conventions/*.md");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("preserves manual aliases, portals, and verification gates when regenerating", () => {
    const repoRoot = createFixtureRepo({ existingManifest: true, includeCustomers: true });
    try {
      const tools = domainManifestTools(createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] }));

      const result = tools.domainManifestGenerate({ repoRoot });

      const tickets = result.manifest.features.find((feature) => feature.featureId === "tickets");
      expect(tickets?.aliases).toEqual(["ticket"]);
      expect(tickets?.portals).toEqual(["admin"]);
      expect(result.manifest.features.map((feature) => feature.featureId)).toEqual(
        expect.arrayContaining(["customers", "tickets"]),
      );
      expect(result.manifest.verificationGates).toEqual([
        {
          gateId: "tenant-isolation",
          scriptNames: ["lint:tenant"],
          whenFeatureTouches: ["authz", "database_schema"],
        },
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("warns about stale manual features without deleting them from candidates", () => {
    const repoRoot = createFixtureRepo({ existingManifest: true });
    try {
      const manifestPath = path.join(repoRoot, ".wormhole", "domain-index.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        features: Array<Record<string, unknown>>;
      };
      manifest.features.push({
        featureId: "legacy",
        displayName: "Legacy",
        aliases: [],
        roots: ["backend/src/modules/legacy"],
        portals: [],
        tables: [],
      });
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      const tools = domainManifestTools(createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] }));

      const result = tools.domainManifestGenerate({ repoRoot });

      expect(result.manifest.features.map((feature) => feature.featureId)).toContain("legacy");
      expect(result.warnings).toContain("Preserved stale manual domain feature not observed in repo evidence: legacy");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports semantic diff operations and status counts", () => {
    const repoRoot = createFixtureRepo({ existingManifest: true, includeCustomers: true });
    try {
      const tools = domainManifestTools(createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] }));

      const diff = tools.domainManifestDiff({ repoRoot });
      const status = tools.domainManifestStatus({ repoRoot });

      expect(diff.baseHash).toMatch(/^[a-f0-9]{64}$/);
      expect(diff.candidateHash).toMatch(/^[a-f0-9]{64}$/);
      expect(diff.operations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "add-feature", featureId: "customers" })]));
      expect(diff.operations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "update-file-groups", group: "services" })]));
      expect(status.present).toBe(true);
      expect(status.valid).toBe(true);
      expect(status.pendingOperationCount).toBe(diff.operations.length);
      expect(status.operationCounts["add-feature"]).toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses stale manifest applies before writing files", () => {
    const repoRoot = createFixtureRepo({ existingManifest: true, includeCustomers: true });
    try {
      const tools = domainManifestTools(createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] }));
      const before = readFileSync(path.join(repoRoot, ".wormhole", "domain-index.json"), "utf8");

      expect(() => tools.domainManifestApply({ repoRoot, baseHash: "0".repeat(64) })).toThrow(/base hash is stale/i);

      expect(readFileSync(path.join(repoRoot, ".wormhole", "domain-index.json"), "utf8")).toBe(before);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("checks stale manifest hashes before requiring privileged write approval", () => {
    const repoRoot = createFixtureRepo({ existingManifest: true, includeCustomers: true });
    try {
      const tools = domainManifestTools(
        createToolHandlers(createInMemoryKernel(), {
          allowedRepoRoots: [repoRoot],
          privilegedActionPolicy: { mode: "strict" },
        }),
      );

      expect(() => tools.domainManifestApply({ repoRoot, baseHash: "0".repeat(64) })).toThrow(/base hash is stale/i);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("applies an approved candidate atomically with a backup", () => {
    const repoRoot = createFixtureRepo({ existingManifest: true, includeCustomers: true });
    try {
      const tools = domainManifestTools(createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] }));
      const diff = tools.domainManifestDiff({ repoRoot });

      const result = tools.domainManifestApply({ repoRoot, baseHash: diff.baseHash });

      const written = JSON.parse(readFileSync(path.join(repoRoot, ".wormhole", "domain-index.json"), "utf8")) as {
        features: Array<{ featureId: string }>;
      };
      expect(result.appliedOperationCount).toBe(diff.operations.length);
      expect(result.backupPath).toBeDefined();
      expect(existsSync(result.backupPath ?? "")).toBe(true);
      expect(result.manifest.features.map((feature) => feature.featureId)).toContain("customers");
      expect(written.features.map((feature) => feature.featureId)).toContain("customers");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
