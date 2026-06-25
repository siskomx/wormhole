import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

describe("project intelligence v2 tool handlers", () => {
  it("exposes onboarding, durable index, impact v2, dependency security, action policy, and optimization adapter tools", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-intel-tools-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest run tests" },
        dependencies: { zod: "^4.0.0" },
        devDependencies: { typescript: "^6.0.0" },
      }),
    );
    writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
    writeFileSync(path.join(repoRoot, "tsconfig.json"), "{}\n");
    writeFileSync(path.join(repoRoot, "src", "user.ts"), "export function loadUser() { return 'user'; }\n");
    writeFileSync(path.join(repoRoot, "tests", "user.test.ts"), "import { loadUser } from '../src/user';\nloadUser();\n");

    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const onboard = tools.projectOnboard({ repoRoot, changedFiles: ["src/user.ts"] });
      const repoIndex = tools.durableRepoIndexRefresh({ repoRoot });
      const semanticIndex = tools.durableSemanticIndexRefresh({
        repoRoot,
        records: [{ id: "user", path: "src/user.ts", text: "load user" }],
      });
      const semantic = tools.durableSemanticSearch({ repoRoot, query: "load user" });
      const impact = tools.testImpactAnalyzeV2({
        repoRoot,
        changedFiles: ["src/user.ts"],
        diffText: "@@ -1 +1 @@\n-export function loadUser() { return 'old'; }\n+export function loadUser() { return 'user'; }",
      });
      const dependency = tools.dependencySecurityReport({ repoRoot });
      const policy = tools.actionPolicyReview({
        operations: [{ kind: "command", command: "npm", args: ["test"] }],
      });
      const adapter = tools.optimizationAdapterRegister({
        adapterId: "native-compact",
        transport: "native",
        capabilities: ["command_output_compaction"],
        installation: "installed",
      });
      const optimized = await tools.optimizationAdapterRun({
        adapterId: adapter.adapterId,
        kind: "command_output_compaction",
        content: "small output",
      });

      expect(onboard.contract.packageManager).toBe("npm");
      expect(repoIndex.summary.fileCount).toBeGreaterThanOrEqual(2);
      expect(semanticIndex.index.provider).toBe("deterministic-token-overlap");
      expect(semantic.results[0]?.id).toBe("user");
      expect(impact.changedSymbols.map((symbol) => symbol.name)).toContain("loadUser");
      expect(dependency.packageManager).toBe("npm");
      expect(policy.riskLevel).toBe("low");
      expect(optimized.status).toBe("completed");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
