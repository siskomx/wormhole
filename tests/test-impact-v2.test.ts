import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTestImpactV2 } from "../src/test-impact-v2.js";

describe("test impact v2", () => {
  it("maps diff hunks to changed symbols and confidence-scored tests", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-impact-v2-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "user.ts"),
      ["export function loadUser() {", "  return 'new-user';", "}", ""].join("\n"),
    );
    writeFileSync(path.join(repoRoot, "tests", "user.test.ts"), "import { loadUser } from '../src/user';\nloadUser();\n");
    const diffText = [
      "diff --git a/src/user.ts b/src/user.ts",
      "@@ -1,3 +1,3 @@",
      " export function loadUser() {",
      "-  return 'old-user';",
      "+  return 'new-user';",
      " }",
    ].join("\n");

    try {
      const result = analyzeTestImpactV2({
        repoRoot,
        changedFiles: ["src/user.ts"],
        diffText,
      });

      expect(result.changedSymbols.map((symbol) => symbol.name)).toContain("loadUser");
      expect(result.hunks[0]).toEqual(expect.objectContaining({ file: "src/user.ts", newStart: 1 }));
      expect(result.likelyTests[0]).toEqual(
        expect.objectContaining({
          path: "tests/user.test.ts",
          reason: expect.stringContaining("loadUser"),
        }),
      );
      expect(result.likelyTests[0]?.confidence).toBeGreaterThan(0.7);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
