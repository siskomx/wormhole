import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { normalizeCommandDiagnostics } from "../src/diagnostics.js";
import { createToolHandlers } from "../src/tools.js";

describe("mission delta replan tool handler", () => {
  it("uses mission state defaults and returns replan guidance", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-mission-delta-tools-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest run tests" },
        dependencies: {},
        devDependencies: { vitest: "^4.0.0" },
      }),
    );
    writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
    writeFileSync(path.join(repoRoot, "src", "user.ts"), "export function loadUser() { return 'Ada'; }\n");
    writeFileSync(path.join(repoRoot, "tests", "user.test.ts"), "import { loadUser } from '../src/user';\nloadUser();\n");

    try {
      const kernel = createInMemoryKernel();
      const mission = kernel.startMission({
        objective: "Change user loading behavior",
        repoRoot,
      });
      const tools = createToolHandlers(kernel, { allowedRepoRoots: [repoRoot] });
      const report = tools.missionDeltaReplan({
        missionId: mission.missionId,
        changedFiles: ["src/user.ts"],
        diagnostics: normalizeCommandDiagnostics({
          source: "typecheck",
          output: "src/user.ts(1,1): error TS1000: Broken user module",
        }),
        evidenceRecords: [
          {
            evidenceId: "E1",
            sourceType: "file",
            sourcePath: "src/user.ts",
            summary: "Previous user evidence.",
          },
        ],
        maxContextChars: 2_000,
      });

      expect(report.objective).toBe("Change user loading behavior");
      expect(report.repoRoot).toBe(repoRoot);
      expect(report.status).toBe("needs_replan");
      expect(report.staleEvidence.map((evidence) => evidence.evidenceId)).toEqual(["E1"]);
      expect(report.gateRecommendation.open).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
