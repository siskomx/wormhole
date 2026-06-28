import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readDomainIndexManifest } from "../src/domain-index-manifest.js";

describe("domain index manifest", () => {
  it("normalizes repo-confined domain index manifests", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-domain-manifest-"));
    try {
      mkdirSync(path.join(repoRoot, ".wormhole"), { recursive: true });
      writeFileSync(
        path.join(repoRoot, ".wormhole", "domain-index.json"),
        JSON.stringify(
          {
            schemaVersion: "domain-index.v0",
            features: [
              {
                featureId: "Tickets",
                displayName: "Ticket Desk",
                aliases: ["ticket", "ticketing"],
                roots: ["src/features/tickets", "backend/src/modules/tickets", "../outside"],
                portals: ["internal", "client"],
                tables: ["tickets", "ticket_messages"],
              },
            ],
            fileGroups: {
              routes: ["backend/src/modules/*/*Routes.ts"],
              hooks: ["src/features/*/hooks/use*.ts"],
              services: ["src/features/**/*Service.ts"],
              migrations: ["migrations/*.sql"],
              openapi: ["public/api-docs/openapi.json"],
              conventions: ["docs/conventions/*.md"],
              memory: [".wormhole/memory/*.md"],
            },
            verificationGates: [
              {
                gateId: "tenant-isolation",
                scriptNames: ["lint:org-filter"],
                whenFeatureTouches: ["authz", "database_schema"],
              },
            ],
          },
          null,
          2,
        ),
      );

      const result = readDomainIndexManifest({ repoRoot });

      expect(result.manifest?.schemaVersion).toBe("domain-index.v0");
      expect(result.manifest?.features[0]).toEqual({
        featureId: "tickets",
        displayName: "Ticket Desk",
        aliases: ["ticket", "ticketing"],
        roots: ["backend/src/modules/tickets", "src/features/tickets"],
        portals: ["client", "internal"],
        tables: ["ticket_messages", "tickets"],
      });
      expect(result.manifest?.fileGroups.routes).toEqual(["backend/src/modules/*/*Routes.ts"]);
      expect(result.manifest?.verificationGates[0]).toEqual({
        gateId: "tenant-isolation",
        scriptNames: ["lint:org-filter"],
        whenFeatureTouches: ["authz", "database_schema"],
      });
      expect(result.warnings).toContain("Ignored unsafe domain-index path: ../outside");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns an absent result when no manifest exists", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-domain-manifest-empty-"));
    try {
      const resolved = path.resolve(repoRoot);
      const result = readDomainIndexManifest({ repoRoot });

      expect(result).toEqual({
        repoRoot: resolved,
        manifestPath: path.join(resolved, ".wormhole", "domain-index.json"),
        manifest: undefined,
        warnings: [],
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
