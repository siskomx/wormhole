import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDomainIndex } from "../src/domain-index.js";

function createDomainRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-domain-index-"));
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
      servers: [{ url: "http://localhost:3000" }],
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

describe("domain index", () => {
  it("builds joined feature, API, schema, convention, memory, and verification facts", () => {
    const repoRoot = createDomainRepo();
    try {
      const index = buildDomainIndex({ repoRoot });

      expect(index.schemaVersion).toBe("domain-index.v0");
      expect(index.features[0]?.featureId).toBe("tickets");
      expect(index.features[0]?.routes).toContain("backend/src/modules/tickets/TicketRoutes.ts");
      expect(index.features[0]?.hooks).toContain("src/features/tickets/hooks/useTickets.ts");
      expect(index.features[0]?.services).toContain("backend/src/modules/tickets/TicketService.ts");
      expect(index.apiEndpoints[0]).toEqual(
        expect.objectContaining({
          featureId: "tickets",
          method: "GET",
          pathTemplate: "/api/tickets",
          source: "openapi",
          authRequired: true,
          responseSchemas: ["PaginatedTickets"],
        }),
      );
      expect(index.tables.find((table) => table.name === "tickets")?.columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["id", "organization_id", "status"]),
      );
      expect(index.tables.find((table) => table.name === "ticket_messages")?.indexes).toContain("idx_ticket_messages_ticket_id");
      expect(index.coverage.gaps.map((gap) => gap.kind)).not.toContain("feature-without-manifest");
      expect(index.conventions.map((item) => item.path)).toContain("docs/conventions/multi-tenant.md");
      expect(index.memory.map((item) => item.path)).toContain(".wormhole/memory/deployment.md");
      expect(index.verificationGates[0]).toEqual(
        expect.objectContaining({
          gateId: "tenant-isolation",
          scriptNames: ["lint:org-filter"],
          matchedFeatureIds: ["tickets"],
        }),
      );
      expect(index.verificationGates[0]?.commands[0]).toEqual(
        expect.objectContaining({ name: "lint:org-filter", command: "npm" }),
      );
      expect(index.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back to route scanning when no OpenAPI file is indexed", () => {
    const repoRoot = createDomainRepo();
    try {
      rmSync(path.join(repoRoot, "public"), { recursive: true, force: true });
      writeFileSync(
        path.join(repoRoot, ".wormhole", "domain-index.json"),
        JSON.stringify({
          schemaVersion: "domain-index.v0",
          features: [{ featureId: "tickets", roots: ["backend/src/modules/tickets"], tables: ["tickets"] }],
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

      const index = buildDomainIndex({ repoRoot });

      expect(index.apiEndpoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            featureId: "tickets",
            method: "GET",
            pathTemplate: "/api/tickets",
            source: "route-scan",
            authRequired: true,
          }),
        ]),
      );
      expect(index.coverage.gaps.map((gap) => gap.kind)).toContain("route-without-openapi");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports generic indexed features that are missing from the manifest", () => {
    const repoRoot = createDomainRepo();
    try {
      mkdirSync(path.join(repoRoot, "backend", "src", "modules", "billing"), { recursive: true });
      writeFileSync(
        path.join(repoRoot, "backend", "src", "modules", "billing", "BillingRoutes.ts"),
        "export function registerBillingRoutes(app) { app.get('/api/billing', () => {}); }\n",
      );

      const index = buildDomainIndex({ repoRoot });

      expect(index.coverage.gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "feature-without-manifest",
            subject: "feature:billing",
          }),
        ]),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
