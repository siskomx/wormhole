import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-blueprint-tools-"));
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

describe("blueprint tool handlers", () => {
  it("compiles, writes, and gates repo blueprint artifacts", () => {
    const repoRoot = createFixtureRepo();
    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const compiled = tools.blueprintCompileRepo({
        repoRoot,
        objective: "Create coding-agent operating rules.",
      });
      const written = tools.blueprintWriteArtifacts({
        repoRoot,
        objective: "Create coding-agent operating rules.",
      });
      const gate = tools.blueprintGateCheck({
        constraints: compiled.constraints,
        action: {
          plannedCommands: [{ command: "pnpm", args: ["test"] }],
        },
      });

      expect(compiled.blueprint.fields.packageManager.value).toBe("npm");
      expect(compiled.agentContextMarkdown).toContain("# Wormhole Agent Context");
      expect(written.files.map((file) => file.relativePath)).toContain(".wormhole/constraints.json");
      expect(existsSync(path.join(repoRoot, ".wormhole", "agent-context.md"))).toBe(true);
      expect(gate.status).toBe("warn");
      expect(gate.findings.map((finding) => finding.ruleId)).toContain("package-manager");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("writes progressive bootstrap artifacts through the tool handler", () => {
    const repoRoot = createFixtureRepo();
    try {
      mkdirSync(path.join(repoRoot, "backend", "src"), { recursive: true });
      mkdirSync(path.join(repoRoot, "src", "features"), { recursive: true });
      writeFileSync(path.join(repoRoot, "backend", "src", "server.ts"), "export function startServer() {}\n");
      writeFileSync(path.join(repoRoot, "src", "features", "App.tsx"), "export function App() { return null; }\n");

      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const written = tools.blueprintWriteArtifacts({
        repoRoot,
        objective: "Create coding-agent operating rules.",
        progressive: true,
      });

      expect(written.files.map((file) => file.relativePath)).toEqual(
        expect.arrayContaining([
          ".wormhole/blueprint.json",
          ".wormhole/lanes/backend.json",
          ".wormhole/lanes/frontend.json",
        ]),
      );
      expect(existsSync(path.join(repoRoot, ".wormhole", "lanes", "frontend.json"))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
