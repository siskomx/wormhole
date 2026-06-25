import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDependencySecurityReport } from "../src/dependency-security.js";

describe("dependency security report", () => {
  it("summarizes direct, dev, transitive, lockfile, license, and local findings", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-dep-sec-"));
    writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        dependencies: { zod: "^4.0.0" },
        devDependencies: { vitest: "^4.0.0" },
      }),
    );
    writeFileSync(
      path.join(repoRoot, "package-lock.json"),
      JSON.stringify({
        packages: {
          "": { dependencies: { zod: "^4.0.0" }, devDependencies: { vitest: "^4.0.0" } },
          "node_modules/zod": { version: "4.0.0", license: "MIT" },
          "node_modules/vitest": { version: "4.0.0" },
          "node_modules/tiny-lib": { version: "1.0.0", license: "Apache-2.0" },
        },
      }),
    );

    try {
      const report = createDependencySecurityReport({ repoRoot });

      expect(report.packageManager).toBe("npm");
      expect(report.directDependencies).toBe(2);
      expect(report.transitiveDependencies).toBe(1);
      expect(report.licenses.MIT).toBe(1);
      expect(report.findings).toContainEqual(
        expect.objectContaining({
          kind: "missing-license",
          packageName: "vitest",
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
