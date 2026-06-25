import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectProjectContract } from "../src/project-contract.js";

describe("project contract detection", () => {
  it("detects package scripts, lockfiles, env vars, dependencies, and ports", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-contract-"));
    try {
      writeFileSync(
        path.join(repoRoot, "package.json"),
        JSON.stringify({
          scripts: { test: "vitest run tests", build: "tsc -p tsconfig.json" },
          dependencies: { zod: "^4.0.0" },
          devDependencies: { vitest: "^4.0.0" },
        }),
      );
      writeFileSync(path.join(repoRoot, "package-lock.json"), "{}\n");
      writeFileSync(path.join(repoRoot, ".env.example"), "DATABASE_URL=\nPORT=3000\n");
      writeFileSync(
        path.join(repoRoot, "docker-compose.yml"),
        ["services:", "  api:", "    ports:", '      - "8080:3000"', ""].join("\n"),
      );

      const contract = detectProjectContract({ repoRoot });

      expect(contract.packageManager).toBe("npm");
      expect(contract.scripts.map((script) => script.name)).toEqual(["build", "test"]);
      expect(contract.lockfiles).toEqual(["package-lock.json"]);
      expect(contract.envVars.map((envVar) => envVar.name)).toEqual(["DATABASE_URL", "PORT"]);
      expect(contract.ports).toEqual([3000, 8080]);
      expect(contract.dependencies).toContainEqual({
        name: "zod",
        version: "^4.0.0",
        manager: "npm",
        dev: false,
      });
      expect(contract.dependencies).toContainEqual({
        name: "vitest",
        version: "^4.0.0",
        manager: "npm",
        dev: true,
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects missing repo roots", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-contract-root-"));
    try {
      expect(() => detectProjectContract({ repoRoot: path.join(repoRoot, "missing") })).toThrow(
        /does not exist/i,
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
