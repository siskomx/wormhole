import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectOnboard } from "../src/project-onboard.js";

describe("project onboarding orchestration", () => {
  it("combines contract, index, LSP, safety, impact, verification, dependency, and policy signals", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-onboard-v2-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest run tests", build: "tsc -p tsconfig.json" },
        dependencies: { zod: "^4.0.0" },
        devDependencies: { typescript: "^6.0.0", vitest: "^4.0.0" },
      }),
    );
    writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
    writeFileSync(path.join(repoRoot, "tsconfig.json"), "{}\n");
    writeFileSync(path.join(repoRoot, ".env.example"), "PORT=3000\n");
    writeFileSync(
      path.join(repoRoot, "src", "user.ts"),
      "export function loadUser() { return 'user'; }\nexport function formatUser() { return loadUser(); }\n",
    );
    writeFileSync(path.join(repoRoot, "src", "server.ts"), "import { loadUser } from './user';\nloadUser();\n");
    writeFileSync(path.join(repoRoot, "tests", "user.test.ts"), "import { loadUser } from '../src/user';\nloadUser();\n");

    try {
      const report = projectOnboard({
        repoRoot,
        changedFiles: ["src/user.ts"],
        maxChangedSymbols: 1,
        action: { operations: [{ kind: "command", command: "npm", args: ["test"] }] },
        semanticRecords: [{ id: "user", path: "src/user.ts", text: "load user profile" }],
      } as Parameters<typeof projectOnboard>[0] & { maxChangedSymbols: number });

      expect(report.contract.packageManager).toBe("npm");
      expect(report.repoIndex.fileCount).toBeGreaterThanOrEqual(3);
      expect(report.lsp.status).toBe("configured");
      expect(report.impact.likelyTests).toContain("tests/user.test.ts");
      expect(report.impact.reasons).toContain("Changed symbol expansion capped at 1 of 2 symbols.");
      expect(report.verificationPlan.commands.map((command) => command.name)).toContain("test");
      expect(report.dependencySecurity.directDependencies).toBeGreaterThanOrEqual(2);
      expect(report.actionPolicy.riskLevel).toBe("low");
      expect(report.semantic?.results[0]?.id).toBe("user");
      expect(report.repoNativePack.schemaVersion).toBe("repo-native-pack.v0");
      expect(report.repoNativePack.reusedTools).toContain("createFeatureIndex");
      expect(report.repoNativePack.capabilities.scripts.map((script) => script.name)).toContain("test");
      expect(report.repoNativePack.coverage.gaps).toEqual(expect.any(Array));
      expect(report.recommendations).toContain("Run focused verification before editing impacted files.");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not include real env names, values, or vendor labels in onboarding output", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-onboard-env-redaction-"));
    writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "vitest run tests" } }));
    writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
    writeFileSync(path.join(repoRoot, ".env.example"), "DATABASE_URL=\n");
    writeFileSync(
      path.join(repoRoot, ".env"),
      "STRIPE_SECRET_KEY=not-a-real-payment-secret-placeholder\nPUBLIC_PORT=9999\n",
    );

    try {
      const report = projectOnboard({ repoRoot });
      const serialized = JSON.stringify(report);

      expect(serialized).not.toContain("STRIPE_SECRET_KEY");
      expect(serialized).not.toContain("sk_live");
      expect(serialized).not.toContain("not-a-real-payment-secret-placeholder");
      expect(serialized).not.toContain("stripe");
      expect(serialized).not.toContain("9999");
      expect(report.safety.findings).toContainEqual(
        expect.objectContaining({
          source: ".env",
          secretType: "sensitive-env-file",
          redacted: "[sensitive env file]",
        }),
      );
      expect(report.safety.candidateFiles).toEqual(expect.any(Number));
      expect(report.safety.truncated).toBe(false);
      expect(report.safety.skipReasons).toEqual([]);
      expect(report.safety.skippedFiles).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports incomplete safety coverage without leaking skipped file contents", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-onboard-safety-coverage-"));
    writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "vitest run tests" } }));
    writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
    writeFileSync(
      path.join(repoRoot, "large.txt"),
      `${"x".repeat(300 * 1024)}\nHIDDEN_TOKEN=super-secret-value-that-must-not-leak\n`,
    );

    try {
      const report = projectOnboard({ repoRoot });
      const serialized = JSON.stringify(report.safety);

      expect(report.safety.candidateFiles).toBeGreaterThanOrEqual(1);
      expect(report.safety.truncated).toBe(true);
      expect(report.safety.skippedFiles).toContainEqual({ path: "large.txt", reason: "file_size_limit" });
      expect(report.safety.skipReasons).toEqual(["file_size_limit"]);
      expect(serialized).not.toContain("super-secret-value");
      expect(serialized).not.toContain("HIDDEN_TOKEN");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
