import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRepoNativePack,
  queryFeatureSlice,
} from "../src/repo-native-pack.js";

function createTicketRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-repo-native-"));
  mkdirSync(path.join(repoRoot, "src", "features", "tickets", "hooks"), { recursive: true });
  mkdirSync(path.join(repoRoot, "backend", "src", "modules", "tickets", "__tests__"), { recursive: true });
  mkdirSync(path.join(repoRoot, "backend", "src", "modules", "billing"), { recursive: true });
  mkdirSync(path.join(repoRoot, "migrations"), { recursive: true });
  mkdirSync(path.join(repoRoot, "docs", "conventions"), { recursive: true });
  mkdirSync(path.join(repoRoot, ".wormhole"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        scripts: {
          test: "vitest run tests",
          "lint:org-filter": "node scripts/lint-org-filter.js",
          "migrations:check": "node scripts/check-migrations.js",
        },
        dependencies: { typescript: "^6.0.0", vitest: "^4.0.0" },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(
    path.join(repoRoot, ".wormhole", "repo-pack.json"),
    JSON.stringify(
      {
        schemaVersion: "repo-pack.v0",
        conventions: ["docs/conventions/multi-tenant.md"],
        verificationGates: [
          {
            gateId: "tenant-isolation",
            scriptNames: ["lint:org-filter"],
            whenSideEffects: ["authz"],
          },
          {
            gateId: "migration-check",
            scriptNames: ["migrations:check"],
            whenSideEffects: ["database_schema"],
          },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(repoRoot, ".wormhole", "domain-index.json"),
    JSON.stringify(
      {
        schemaVersion: "domain-index.v0",
        features: [
          {
            featureId: "tickets",
            aliases: ["ticket"],
            roots: ["backend/src/modules/tickets", "src/features/tickets"],
            portals: ["internal", "client"],
            tables: ["ticket_messages"],
          },
        ],
        fileGroups: {
          routes: ["backend/src/modules/*/*Routes.ts"],
          hooks: ["src/features/*/hooks/use*.ts"],
          services: ["backend/src/modules/**/*Service.ts"],
          migrations: ["migrations/*.sql"],
          openapi: [],
          conventions: ["docs/conventions/*.md"],
          memory: [],
        },
        verificationGates: [
          {
            gateId: "tenant-isolation",
            scriptNames: ["lint:org-filter"],
            whenFeatureTouches: ["authz"],
          },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(repoRoot, "docs", "conventions", "multi-tenant.md"), "Use organization filters on tenant data.\n");
  writeFileSync(path.join(repoRoot, "src", "features", "tickets", "hooks", "useTickets.ts"), "export function useTickets() { return []; }\n");
  writeFileSync(
    path.join(repoRoot, "backend", "src", "modules", "tickets", "TicketRoutes.ts"),
    "export function registerTicketRoutes(app) { app.post('/tickets', () => requirePermission('tickets.write')); }\n",
  );
  writeFileSync(path.join(repoRoot, "backend", "src", "modules", "tickets", "TicketService.ts"), "export class TicketService {}\n");
  writeFileSync(path.join(repoRoot, "backend", "src", "modules", "tickets", "__tests__", "tickets.test.ts"), "import '../TicketService.js';\n");
  writeFileSync(path.join(repoRoot, "backend", "src", "modules", "billing", "BillingRoutes.ts"), "export function registerBillingRoutes(app) { app.post('/billing', () => {}); }\n");
  writeFileSync(path.join(repoRoot, "migrations", "001_create_ticket_tables.sql"), "create table ticket_messages(id text primary key);\n");
  return repoRoot;
}

describe("repo native pack", () => {
  it("builds repo-native capability, schema, slice, verification, and coverage summaries", () => {
    const repoRoot = createTicketRepo();
    try {
      const pack = buildRepoNativePack({
        repoRoot,
        objective: "Fix ticket creation tenant isolation",
        query: "tickets tenant isolation",
        changedFiles: ["backend/src/modules/tickets/TicketRoutes.ts"],
      });

      expect(pack.schemaVersion).toBe("repo-native-pack.v0");
      expect(pack.reusedTools).toEqual(
        expect.arrayContaining([
          "createFeatureIndex",
          "detectProjectContract",
          "buildRepoIndex",
          "analyzeSourceConflicts",
          "createVerificationPlan",
          "buildDomainIndex",
        ]),
      );
      expect(pack.capabilities.scripts.map((script) => script.name)).toEqual(
        expect.arrayContaining(["test", "lint:org-filter", "migrations:check"]),
      );
      expect(pack.capabilities.conventions.map((convention) => convention.path)).toContain(
        "docs/conventions/multi-tenant.md",
      );
      expect(pack.schema.tables.map((table) => table.name)).toContain("ticket_messages");
      expect(pack.domainIndex).toEqual(
        expect.objectContaining({
          manifestPresent: true,
          featureCount: 1,
        }),
      );
      expect(pack.domainIndex.apiEndpointCount).toBeGreaterThanOrEqual(1);
      expect(pack.featureSlices.map((slice) => slice.featureId)).toContain("tickets");
      expect(pack.featureSlices[0]?.routes).toContain("backend/src/modules/tickets/TicketRoutes.ts");
      expect(pack.featureSlices[0]?.apiEndpoints[0]).toEqual(
        expect.objectContaining({ pathTemplate: "/tickets", source: "route-scan" }),
      );
      expect(pack.featureSlices[0]?.schemaColumns.map((column) => column.name)).toContain("id");
      expect(pack.featureSlices[0]?.tests).toContain("backend/src/modules/tickets/__tests__/tickets.test.ts");
      expect(pack.verificationGates.map((gate) => gate.gateId)).toEqual(
        expect.arrayContaining(["tenant-isolation", "migration-check"]),
      );
      expect(pack.coverage.gaps.map((gap) => gap.kind)).toContain("feature-route-without-test");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("queries one feature slice without pulling unrelated feature files", () => {
    const repoRoot = createTicketRepo();
    try {
      const result = queryFeatureSlice({
        repoRoot,
        query: "tickets",
        changedFiles: ["backend/src/modules/tickets/TicketRoutes.ts"],
        limit: 1,
      });

      expect(result.slices).toHaveLength(1);
      expect(result.slices[0]?.featureId).toBe("tickets");
      expect(result.slices[0]?.keyFiles).toContain("backend/src/modules/tickets/TicketRoutes.ts");
      expect(result.slices[0]?.keyFiles).not.toContain("backend/src/modules/billing/BillingRoutes.ts");
      expect(result.slices[0]?.schemaTables).toContain("ticket_messages");
      expect(result.slices[0]?.apiEndpoints.map((endpoint) => endpoint.pathTemplate)).toContain("/tickets");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
