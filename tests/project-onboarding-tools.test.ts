import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

describe("project onboarding tool handlers", () => {
  it("returns only findings for inline secret scans", () => {
    const tools = createToolHandlers(createInMemoryKernel());

    const result = tools.secretScan({
      source: "inline",
      text: "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456\n",
    });

    expect(Object.keys(result)).toEqual(["findings"]);
    expect(result.findings[0]?.secretType).toBe("openai-api-key");
  });

  it("forwards repo secret scan caps and reports file-limit truncation details", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-secret-scan-caps-"));
    writeFileSync(path.join(repoRoot, "a.txt"), "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456\n");
    writeFileSync(path.join(repoRoot, "b.txt"), "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890\n");

    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
      });

      const result = tools.secretScan({ repoRoot, maxFiles: 1 });

      expect("scannedFiles" in result).toBe(true);
      if (!("scannedFiles" in result)) {
        throw new Error("expected repo secret scan result");
      }
      expect(result.scannedFiles).toBe(1);
      expect(result.truncated).toBe(true);
      expect(result.skipReasons).toContain("file_limit");
      expect(result.skippedFiles).toContainEqual({ path: "b.txt", reason: "file_limit" });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("exposes project contract, diagnostics, impact, verification, safety, semantic, and LSP helpers", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-onboarding-tools-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify(
        {
          scripts: { test: "vitest run tests", build: "tsc -p tsconfig.json" },
          dependencies: { zod: "^4.0.0" },
          devDependencies: { typescript: "^6.0.0", vitest: "^4.0.0" },
        },
        null,
        2,
      ),
    );
    writeFileSync(path.join(repoRoot, "package-lock.json"), "{}\n");
    writeFileSync(path.join(repoRoot, "tsconfig.json"), "{}\n");
    writeFileSync(path.join(repoRoot, ".env.example"), "PORT=3000\n");
    writeFileSync(path.join(repoRoot, "src", "user.ts"), "export function loadUser() { return 'u'; }\n");
    writeFileSync(path.join(repoRoot, "src", "server.ts"), "import { loadUser } from './user';\nexport const user = loadUser();\n");
    writeFileSync(path.join(repoRoot, "tests", "user.test.ts"), "import { loadUser } from '../src/user';\nloadUser();\n");

    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
      });

      const contract = tools.projectContractDetect({ repoRoot });
      const dependencies = tools.dependencyInventory({ repoRoot });
      const commands = tools.projectCommandMap({ repoRoot });
      const diagnostics = tools.diagnosticsFromCommand({
        source: "npm test",
        output: "src/user.ts(2,1): error TS1000: bad syntax\n",
      });
      tools.diagnosticsRecord({ diagnostics });
      const diagnosticQuery = tools.diagnosticsQuery({ file: "src/user.ts" });
      const impact = tools.impactAnalyze({
        repoRoot,
        changedFiles: ["src/user.ts"],
      });
      const testPlan = tools.testPlanSelect({
        repoRoot,
        changedFiles: ["src/user.ts"],
      });
      const verification = await tools.verificationRun({
        commands: [
          {
            name: "node-smoke",
            command: process.execPath,
            args: ["-e", "console.log('ok')"],
            timeoutMs: 2_000,
          },
        ],
      });
      const secretScan = tools.secretScan({
        source: ".env",
        text: "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456\n",
      });
      const risk = tools.operationRiskReview({
        command: "git",
        args: ["push", "--force"],
      });
      const semanticIndex = tools.semanticIndexBuild({
        records: [{ id: "db", path: "src/db.ts", text: "database connection pool" }],
      });
      const semantic = tools.semanticSearch({
        index: semanticIndex,
        query: "database pool",
      });
      const lsp = tools.lspProbe({ repoRoot });

      expect(contract.packageManager).toBe("npm");
      expect(dependencies.dependencies.map((dependency) => dependency.name)).toContain("zod");
      expect(commands.scripts.map((script) => script.name)).toEqual(["build", "test"]);
      expect(diagnosticQuery.diagnostics[0]?.code).toBe("TS1000");
      expect(impact.impactedFiles).toContain("src/server.ts");
      expect(testPlan.commands.map((command) => command.name)).toContain("test");
      expect(verification.status).toBe("passed");
      expect(secretScan.findings[0]?.secretType).toBe("openai-api-key");
      expect(risk.riskLevel).toBe("high");
      expect(semantic.results[0]?.id).toBe("db");
      expect(lsp.servers.map((server) => server.language)).toContain("typescript");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
