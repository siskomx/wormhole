import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reviewTestQuality } from "../src/test-quality-review.js";

describe("test quality review", () => {
  it("warns when source changes have no matching test changes", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-test-quality-"));
    writeFileSync(path.join(repoRoot, "app.ts"), "export const app = true;\n");

    const result = reviewTestQuality({ repoRoot, changedFiles: ["app.ts"] });

    expect(result.decision).toBe("warn");
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "missing_tests" }));
  });

  it("flags skipped and assertion-free tests", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-test-quality-"));
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "tests", "app.test.ts"),
      "import { it } from 'vitest';\nit.skip('does work', () => { const value = 1; });\n",
    );

    const result = reviewTestQuality({ repoRoot, changedFiles: ["tests/app.test.ts"] });

    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["skipped_test", "assertion_free_test"]),
    );
  });

  it("flags snapshot-only tests", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-test-quality-"));
    mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "tests", "app.test.ts"),
      "import { expect, it } from 'vitest';\nit('renders', () => { expect(render()).toMatchSnapshot(); });\n",
    );

    const result = reviewTestQuality({ repoRoot, changedFiles: ["tests/app.test.ts"] });

    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "snapshot_only_test" }));
  });
});
