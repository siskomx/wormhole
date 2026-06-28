import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  queryDomainApi,
  queryDomainCoverage,
  queryDomainDrift,
  queryDomainSlice,
  queryDomainTable,
  queryDomainVerificationGatePlan,
  readDomainIndexStatus,
  refreshDomainIndex,
} from "../src/sqlite-domain-index.js";

function createDomainRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-sqlite-domain-index-"));
  mkdirSync(path.join(repoRoot, ".wormhole", "memory"), { recursive: true });
  mkdirSync(path.join(repoRoot, "backend", "src", "modules", "tickets"), { recursive: true });
  mkdirSync(path.join(repoRoot, "src", "features", "tickets", "hooks"), { recursive: true });
  mkdirSync(path.join(repoRoot, "public", "api-docs"), { recursive: true });
  mkdirSync(path.join(repoRoot, "migrations"), { recursive: true });
  mkdirSync(path.join(repoRoot, "docs", "conventions"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ scripts: { "lint:org-filter": "node scripts/lint-org-filter.js" } }),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(
    path.join(repoRoot, ".wormhole", "domain-index.json"),
    JSON.stringify({
      schemaVersion: "domain-index.v0",
      features: [
        {
          featureId: "tickets",
          aliases: ["ticket"],
          roots: ["backend/src/modules/tickets", "src/features/tickets"],
          portals: ["internal", "client"],
          tables: ["tickets", "ticket_messages"],
        },
      ],
      fileGroups: {
        routes: ["backend/src/modules/*/*Routes.ts"],
        hooks: ["src/features/*/hooks/use*.ts"],
        services: ["backend/src/modules/**/*Service.ts"],
        migrations: ["migrations/*.sql"],
        openapi: ["public/api-docs/openapi.json"],
        conventions: ["docs/conventions/*.md"],
        memory: [".wormhole/memory/*.md"],
      },
      verificationGates: [{ gateId: "tenant-isolation", scriptNames: ["lint:org-filter"], whenFeatureTouches: ["authz"] }],
    }),
  );
  writeFileSync(
    path.join(repoRoot, "backend", "src", "modules", "tickets", "TicketRoutes.ts"),
    "export function registerTicketRoutes(app) { app.get('/api/tickets', { preHandler: authenticate }, () => {}); }\n",
  );
  writeFileSync(path.join(repoRoot, "backend", "src", "modules", "tickets", "TicketService.ts"), "export class TicketService {}\n");
  writeFileSync(path.join(repoRoot, "src", "features", "tickets", "hooks", "useTickets.ts"), "export function useTickets() { return []; }\n");
  writeFileSync(path.join(repoRoot, "docs", "conventions", "multi-tenant.md"), "Tenant data must filter by organization_id.\n");
  writeFileSync(path.join(repoRoot, ".wormhole", "memory", "deployment.md"), "API routes run under the backend service.\n");
  writeFileSync(
    path.join(repoRoot, "migrations", "001_tickets.sql"),
    [
      "create table tickets(id text primary key, organization_id text not null);",
      "alter table tickets add column status text default 'open';",
      "create table ticket_messages(id text primary key, ticket_id text not null references tickets(id));",
      "create index idx_ticket_messages_ticket_id on ticket_messages(ticket_id);",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "public", "api-docs", "openapi.json"),
    JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/api/tickets": {
          get: {
            operationId: "listTickets",
            security: [{ bearerAuth: [] }],
            parameters: [{ name: "organizationId", in: "query" }],
            responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/PaginatedTickets" } } } } },
          },
        },
      },
    }),
  );
  return repoRoot;
}

describe("SQLite domain index", () => {
  it("persists a normalized domain index and serves feature/API/table/gate queries", () => {
    const repoRoot = createDomainRepo();
    try {
      const refreshed = refreshDomainIndex({ repoRoot });
      const status = readDomainIndexStatus({ repoRoot });
      const slice = queryDomainSlice({ repoRoot, feature: "ticket", requireFresh: true });
      const api = queryDomainApi({ repoRoot, feature: "tickets", requireFresh: true });
      const table = queryDomainTable({ repoRoot, table: "ticket_messages", requireFresh: true });
      const coverage = queryDomainCoverage({ repoRoot, requireFresh: true });
      const gate = queryDomainVerificationGatePlan({ repoRoot, feature: "tickets", requireFresh: true });

      expect(existsSync(refreshed.indexPath)).toBe(true);
      expect(refreshed.summary.featureCount).toBe(1);
      expect(status?.fresh).toBe(true);
      expect(status?.indexHealth.status).toBe("fresh");
      expect(slice.refused).toBeUndefined();
      expect(slice.feature?.featureId).toBe("tickets");
      expect(slice.apiEndpoints.map((endpoint) => endpoint.operationId)).toContain("listTickets");
      expect(slice.tables.map((candidate) => candidate.name)).toContain("ticket_messages");
      expect(api.endpoints[0]).toEqual(
        expect.objectContaining({ method: "GET", pathTemplate: "/api/tickets", responseSchemas: ["PaginatedTickets"] }),
      );
      expect(table.table?.indexes).toContain("idx_ticket_messages_ticket_id");
      expect(coverage.gaps.map((gap) => gap.kind)).not.toContain("feature-without-manifest");
      expect(gate.gates[0]).toEqual(
        expect.objectContaining({
          gateId: "tenant-isolation",
          matchedFeatureIds: ["tickets"],
          scriptNames: ["lint:org-filter"],
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports drift and refuses stale query results when freshness is required", () => {
    const repoRoot = createDomainRepo();
    const routePath = path.join(repoRoot, "backend", "src", "modules", "tickets", "TicketRoutes.ts");
    try {
      refreshDomainIndex({ repoRoot });
      writeFileSync(routePath, "export function registerTicketRoutes(app) { app.post('/api/tickets', () => {}); }\n");

      const status = readDomainIndexStatus({ repoRoot });
      const drift = queryDomainDrift({ repoRoot });
      const staleAllowed = queryDomainSlice({ repoRoot, feature: "tickets" });
      const refused = queryDomainSlice({ repoRoot, feature: "tickets", requireFresh: true });

      expect(status?.fresh).toBe(false);
      expect(status?.indexHealth.status).toBe("stale");
      expect(drift.fresh).toBe(false);
      expect(drift.changedFiles).toContain("backend/src/modules/tickets/TicketRoutes.ts");
      expect(staleAllowed.feature?.featureId).toBe("tickets");
      expect(refused.refused).toBe(true);
      expect(refused.feature).toBeUndefined();
      expect(refused.indexHealth.status).toBe("stale");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
