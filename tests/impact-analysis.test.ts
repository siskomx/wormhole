import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeImpact } from "../src/impact-analysis.js";

describe("impact analysis", () => {
  it("finds impacted files and likely tests for changed files", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-impact-"));
    try {
      mkdirSync(path.join(repoRoot, "src"), { recursive: true });
      mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
      writeFileSync(path.join(repoRoot, "src", "user.ts"), "export function loadUser() { return 'user'; }\n");
      writeFileSync(
        path.join(repoRoot, "src", "server.ts"),
        "import { loadUser } from './user';\nexport function start() { return loadUser(); }\n",
      );
      writeFileSync(
        path.join(repoRoot, "tests", "user.test.ts"),
        "import { loadUser } from '../src/user';\ntest('user', () => loadUser());\n",
      );

      const impact = analyzeImpact({
        repoRoot,
        changedFiles: ["src/user.ts"],
      });

      expect(impact.changedFiles).toEqual(["src/user.ts"]);
      expect(impact.impactedFiles).toEqual(expect.arrayContaining(["src/server.ts"]));
      expect(impact.likelyTests).toEqual(["tests/user.test.ts"]);
      expect(impact.riskLevel).toBe("medium");
      expect(impact.reasons).toContain("Changed file has inbound dependents.");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
