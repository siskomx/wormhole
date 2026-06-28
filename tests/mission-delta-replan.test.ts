import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMissionDeltaReplan } from "../src/mission-delta-replan.js";
import { normalizeCommandDiagnostics } from "../src/diagnostics.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-delta-replan-"));
  mkdirSync(path.join(repoRoot, "src", "services"), { recursive: true });
  mkdirSync(path.join(repoRoot, "src", "api"), { recursive: true });
  mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({
      scripts: { test: "vitest run tests", typecheck: "tsc --noEmit" },
      dependencies: {},
      devDependencies: { vitest: "^4.0.0", typescript: "^6.0.0" },
    }),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(
    path.join(repoRoot, "src", "services", "user-service.ts"),
    [
      "export type User = { id: string; name: string };",
      "export function loadUser(id: string): User {",
      "  return { id, name: 'Ada' };",
      "}",
      "export function formatUser(user: User): string {",
      "  return `${user.name}:${user.id}`;",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "src", "api", "users.ts"),
    [
      "import { loadUser, formatUser } from '../services/user-service';",
      "export function registerUserRoutes(app: { get(path: string, handler: unknown): void }) {",
      "  app.get('/users/:id', () => formatUser(loadUser('42')));",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(repoRoot, "tests", "user-service.test.ts"),
    [
      "import { loadUser, formatUser } from '../src/services/user-service';",
      "test('formats users', () => {",
      "  expect(formatUser(loadUser('7'))).toBe('Ada:7');",
      "});",
    ].join("\n"),
  );
  return repoRoot;
}

describe("mission delta replan", () => {
  it("re-scopes a mission after changed files and diagnostics", () => {
    const repoRoot = createFixtureRepo();
    try {
      const diagnostics = normalizeCommandDiagnostics({
        source: "typecheck",
        output: "src/services/user-service.ts(2,10): error TS2322: Type mismatch",
      });
      const report = createMissionDeltaReplan({
        repoRoot,
        missionId: "M1",
        objective: "Change user loading behavior",
        changedFiles: ["src/services/user-service.ts"],
        diffText:
          "diff --git a/src/services/user-service.ts b/src/services/user-service.ts\n@@ -2,2 +2,2 @@\n-export function loadUser(id: string): User {\n+export function loadUser(id: string): User {\n",
        diagnostics,
        evidenceRecords: [
          {
            evidenceId: "E1",
            sourceType: "file",
            sourcePath: "src/services/user-service.ts",
            summary: "Old user-service evidence.",
          },
          {
            evidenceId: "E2",
            sourceType: "file",
            sourcePath: "README.md",
            summary: "Unrelated docs evidence.",
          },
        ],
        maxContextChars: 4_000,
      });

      expect(report.status).toBe("needs_replan");
      expect(report.blastRadius.changedSymbols.map((symbol) => symbol.name)).toContain("loadUser");
      expect(report.blastRadius.impactedFiles.map((file) => file.path)).toEqual(
        expect.arrayContaining(["src/api/users.ts", "tests/user-service.test.ts"]),
      );
      expect(report.focusedVerification.likelyTests.map((test) => test.path)).toContain(
        "tests/user-service.test.ts",
      );
      expect(report.diagnosticsSummary.errorCount).toBe(1);
      expect(report.staleEvidence).toEqual([
        expect.objectContaining({
          evidenceId: "E1",
          reason: "Evidence source changed in the latest delta.",
        }),
      ]);
      expect(report.gateRecommendation.open).toBe(false);
      expect(report.gateRecommendation.reasons).toEqual(
        expect.arrayContaining([
          "Changed files require fresh evidence before reusing the prior plan.",
          "Diagnostics contain errors that require plan revision.",
        ]),
      );
      expect(report.planRevision.requiredSteps).toEqual(
        expect.arrayContaining([
          "Record fresh evidence for changed files: src/services/user-service.ts.",
          "Address or explicitly triage current error diagnostics before emitting a revised plan.",
        ]),
      );
      expect(report.contextPack.rendered).toContain("Context Pack");
      expect(report.contextPack.stats.renderedChars).toBeLessThanOrEqual(4_000);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports repo-native slice and schema changes in mission delta replans", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-mission-delta-native-"));
    try {
      mkdirSync(path.join(repoRoot, "backend", "src", "modules", "tickets"), { recursive: true });
      mkdirSync(path.join(repoRoot, "migrations"), { recursive: true });
      writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "vitest run tests" } }));
      writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
      writeFileSync(path.join(repoRoot, "backend", "src", "modules", "tickets", "TicketRoutes.ts"), "export function registerTicketRoutes() {}\n");
      writeFileSync(path.join(repoRoot, "migrations", "001_create_ticket_tables.sql"), "create table ticket_messages(id text);\n");

      const report = createMissionDeltaReplan({
        repoRoot,
        objective: "Fix tickets",
        changedFiles: ["migrations/001_create_ticket_tables.sql"],
        evidenceRecords: [
          {
            evidenceId: "ev-ticket-schema",
            sourceType: "file",
            sourcePath: "migrations/001_create_ticket_tables.sql",
            summary: "Ticket table migration.",
          },
        ],
      });

      expect(report.repoNative.featureSlices.map((slice) => slice.featureId)).toContain("tickets");
      expect(report.repoNative.schemaChanged).toBe(true);
      expect(report.repoNative.coverageGapCount).toBeGreaterThanOrEqual(0);
      expect(report.gateRecommendation.reasons).toContain("Repo-native schema or migration files changed.");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
