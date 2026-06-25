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
    writeFileSync(path.join(repoRoot, "src", "user.ts"), "export function loadUser() { return 'user'; }\n");
    writeFileSync(path.join(repoRoot, "src", "server.ts"), "import { loadUser } from './user';\nloadUser();\n");
    writeFileSync(path.join(repoRoot, "tests", "user.test.ts"), "import { loadUser } from '../src/user';\nloadUser();\n");

    try {
      const report = projectOnboard({
        repoRoot,
        changedFiles: ["src/user.ts"],
        action: { operations: [{ kind: "command", command: "npm", args: ["test"] }] },
        semanticRecords: [{ id: "user", path: "src/user.ts", text: "load user profile" }],
      });

      expect(report.contract.packageManager).toBe("npm");
      expect(report.repoIndex.fileCount).toBeGreaterThanOrEqual(3);
      expect(report.lsp.status).toBe("configured");
      expect(report.impact.likelyTests).toContain("tests/user.test.ts");
      expect(report.verificationPlan.commands.map((command) => command.name)).toContain("test");
      expect(report.dependencySecurity.directDependencies).toBeGreaterThanOrEqual(2);
      expect(report.actionPolicy.riskLevel).toBe("low");
      expect(report.semantic?.results[0]?.id).toBe("user");
      expect(report.recommendations).toContain("Run focused verification before editing impacted files.");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
