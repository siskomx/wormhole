import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileBootstrapBlueprint, compileRepoBlueprint } from "../src/blueprint.js";
import { writeBlueprintArtifacts, writeProgressiveBlueprintArtifacts } from "../src/blueprint-files.js";
import {
  createArchitectureMap,
  createProjectModelCache,
  discoverEntrypointFlows,
} from "../src/project-intelligence.js";
import { projectOnboard } from "../src/project-onboard.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-blueprint-files-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: {
          test: "vitest run tests",
        },
        dependencies: {
          "@modelcontextprotocol/sdk": "^1.29.0",
        },
        devDependencies: {
          typescript: "^6.0.3",
          vitest: "^4.1.9",
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(path.join(repoRoot, "src", "index.ts"), "export function main() { return 'ok'; }\n");
  writeFileSync(path.join(repoRoot, "tests", "index.test.ts"), "import { main } from '../src/index';\nmain();\n");
  return repoRoot;
}

function compileFixture(repoRoot: string) {
  const projectModelCache = createProjectModelCache();
  return compileRepoBlueprint({
    objective: "Write local coding-agent rules.",
    onboard: projectOnboard({ repoRoot }),
    architecture: createArchitectureMap({ repoRoot, projectModelCache }),
    entrypoints: discoverEntrypointFlows({ repoRoot, projectModelCache }),
  });
}

describe("blueprint artifact writer", () => {
  it("writes blueprint, constraints, and agent context under .wormhole", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileFixture(repoRoot);
      const artifacts = writeBlueprintArtifacts({ repoRoot, result });
      const blueprintPath = path.join(repoRoot, ".wormhole", "blueprint.json");
      const constraintsPath = path.join(repoRoot, ".wormhole", "constraints.json");
      const contextPath = path.join(repoRoot, ".wormhole", "agent-context.md");

      expect(artifacts.files.map((file) => file.relativePath)).toEqual([
        ".wormhole/agent-context.md",
        ".wormhole/blueprint.json",
        ".wormhole/constraints.json",
      ]);
      expect(existsSync(blueprintPath)).toBe(true);
      expect(existsSync(constraintsPath)).toBe(true);
      expect(existsSync(contextPath)).toBe(true);

      const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8")) as { kind: string };
      const constraints = JSON.parse(readFileSync(constraintsPath, "utf8")) as {
        requiredVerification: Array<{ name: string }>;
      };
      const markdown = readFileSync(contextPath, "utf8");

      expect(blueprint.kind).toBe("existing_repo");
      expect(constraints.requiredVerification.map((command) => command.name)).toContain("test");
      expect(markdown).toContain("# Wormhole Agent Context");
      expect(markdown).not.toContain("undefined");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("writes a compact progressive bootstrap with per-lane artifacts", () => {
    const repoRoot = createFixtureRepo();
    try {
      mkdirSync(path.join(repoRoot, "backend", "src"), { recursive: true });
      mkdirSync(path.join(repoRoot, "backend", "src", ".claude", "refs"), { recursive: true });
      mkdirSync(path.join(repoRoot, "src", "features"), { recursive: true });
      mkdirSync(path.join(repoRoot, ".claude", "skills"), { recursive: true });
      mkdirSync(path.join(repoRoot, "src", "generated"), { recursive: true });
      writeFileSync(path.join(repoRoot, "backend", "src", "server.ts"), "export function registerRoutes() {}\n");
      writeFileSync(path.join(repoRoot, "backend", "src", ".claude", "refs", "testing.md"), "# Testing refs\n");
      writeFileSync(path.join(repoRoot, "src", "features", "App.tsx"), "export function App() { return null; }\n");
      writeFileSync(path.join(repoRoot, ".claude", "skills", "SKILL.md"), "# Agent skill\n");
      writeFileSync(path.join(repoRoot, "src", "generated", "openapi.ts"), "export const generated = true;\n");

      const result = compileBootstrapBlueprint({
        repoRoot,
        objective: "Write local coding-agent rules.",
      });
      const artifacts = writeProgressiveBlueprintArtifacts({ repoRoot, result });
      const blueprintPath = path.join(repoRoot, ".wormhole", "blueprint.json");
      const frontendLanePath = path.join(repoRoot, ".wormhole", "lanes", "frontend.json");
      const agentMetaLanePath = path.join(repoRoot, ".wormhole", "lanes", "agent-meta.json");
      const generatedLanePath = path.join(repoRoot, ".wormhole", "lanes", "generated.json");

      const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8")) as {
        schemaVersion: string;
        status: string;
        lanes: Array<{ lane: string; status: string; fileCount: number; artifactPath: string }>;
        modules?: unknown[];
      };
      const frontendLane = JSON.parse(readFileSync(frontendLanePath, "utf8")) as {
        lane: string;
        sampleFiles: string[];
      };
      const agentMetaLane = JSON.parse(readFileSync(agentMetaLanePath, "utf8")) as {
        lane: string;
        sampleFiles: string[];
      };
      const markdown = readFileSync(path.join(repoRoot, ".wormhole", "agent-context.md"), "utf8");

      expect(artifacts.files.map((file) => file.relativePath)).toEqual(
        expect.arrayContaining([
          ".wormhole/blueprint.json",
          ".wormhole/constraints.json",
          ".wormhole/agent-context.md",
          ".wormhole/lanes/backend.json",
          ".wormhole/lanes/frontend.json",
          ".wormhole/lanes/agent-meta.json",
          ".wormhole/lanes/generated.json",
        ]),
      );
      expect(blueprint.schemaVersion).toBe("blueprint-progress.v0");
      expect(blueprint.status).toBe("partial");
      expect(blueprint.modules).toBeUndefined();
      expect(readFileSync(blueprintPath, "utf8").length).toBeLessThan(20_000);
      expect(blueprint.lanes.find((lane) => lane.lane === "frontend")?.status).toBe("pending");
      expect(frontendLane.sampleFiles).toContain("src/features/App.tsx");
      expect(agentMetaLane.sampleFiles).toContain("backend/src/.claude/refs/testing.md");
      expect(existsSync(agentMetaLanePath)).toBe(true);
      expect(existsSync(generatedLanePath)).toBe(true);
      expect(markdown).toContain("Blueprint status: partial");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
