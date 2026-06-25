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

  it("records LSP diagnostics and returns mission delta replan guidance", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-feedback-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
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
    writeFileSync(path.join(repoRoot, "src", "user.ts"), "export function loadUser() { return 'Ada'; }\n");
    writeFileSync(path.join(repoRoot, "tests", "user.test.ts"), "import { loadUser } from '../src/user';\nloadUser();\n");

    try {
      const kernel = createInMemoryKernel();
      const mission = kernel.startMission({
        objective: "Repair user loading after typecheck failure",
        repoRoot,
      });
      const tools = createToolHandlers(kernel, { allowedRepoRoots: [repoRoot] });
      const feedback = tools.lspFeedbackReplan({
        missionId: mission.missionId,
        uri: `file://${path.join(repoRoot, "src", "user.ts").replace(/\\/g, "/")}`,
        diagnostics: [
          {
            range: { start: { line: 0, character: 7 } },
            severity: 1,
            code: "TS2322",
            source: "typescript",
            message: "Type 'string' is not assignable to type 'number'.",
          },
        ],
        evidenceRecords: [
          {
            evidenceId: "E1",
            sourceType: "file",
            sourcePath: "src/user.ts",
            summary: "Previous user module evidence.",
          },
        ],
        maxContextChars: 2_000,
      });

      expect(feedback.recorded.count).toBe(1);
      expect(feedback.changedFiles).toEqual(["src/user.ts"]);
      expect(feedback.replan.status).toBe("needs_replan");
      expect(feedback.replan.diagnosticsSummary.errorCount).toBe(1);
      expect(feedback.replan.staleEvidence.map((evidence) => evidence.evidenceId)).toEqual(["E1"]);
      expect(tools.diagnosticsQuery({ file: "src/user.ts" }).diagnostics).toHaveLength(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
