import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileAppProcess } from "../src/app-process.js";
import { writeAppProcessArtifacts } from "../src/app-process-files.js";
import { compileBootstrapBlueprint } from "../src/blueprint.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-app-process-files-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: { test: "vitest run tests" },
        dependencies: { react: "^19.2.0" },
        devDependencies: { typescript: "^6.0.3", vitest: "^4.1.9" },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(path.join(repoRoot, "src", "index.tsx"), "export function App() { return null; }\n");
  return repoRoot;
}

describe("app process artifact writer", () => {
  it("writes product, roadmap, backlog, app context, and process lane artifacts", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileAppProcess({
        repoRoot,
        objective: "Build a team scheduling app.",
        blueprint: compileBootstrapBlueprint({ repoRoot, objective: "Build a team scheduling app." }),
      });

      const written = writeAppProcessArtifacts({ repoRoot, result });
      const relativePaths = written.files.map((file) => file.relativePath);

      expect(relativePaths).toEqual(
        expect.arrayContaining([
          ".wormhole/app-context.md",
          ".wormhole/app-process.md",
          ".wormhole/app-process.json",
          ".wormhole/app-process/phases/phase-0.json",
          ".wormhole/app-process/phases/phase-1.json",
          ".wormhole/backlog.json",
          ".wormhole/product-definition.md",
          ".wormhole/roadmap.json",
          ".wormhole/lanes/product.md",
          ".wormhole/lanes/roadmap.md",
          ".wormhole/lanes/ux.md",
          ".wormhole/lanes/security.md",
          ".wormhole/lanes/verification.md",
        ]),
      );
      expect(existsSync(path.join(repoRoot, ".wormhole", "app-process.json"))).toBe(true);
      expect(JSON.parse(readFileSync(path.join(repoRoot, ".wormhole", "backlog.json"), "utf8")).stories.length).toBeGreaterThan(0);
      expect(readFileSync(path.join(repoRoot, ".wormhole", "product-definition.md"), "utf8")).toContain("## Non Goals");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
