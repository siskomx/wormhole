import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkBlueprintGate,
  compileRepoBlueprint,
  renderAgentContext,
} from "../src/blueprint.js";
import {
  createArchitectureMap,
  createProjectModelCache,
  discoverEntrypointFlows,
} from "../src/project-intelligence.js";
import { projectOnboard } from "../src/project-onboard.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-blueprint-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: {
          build: "tsc -p tsconfig.json",
          test: "vitest run tests",
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@modelcontextprotocol/sdk": "^1.29.0",
          zod: "^4.4.3",
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
  writeFileSync(path.join(repoRoot, "tsconfig.json"), "{}\n");
  writeFileSync(path.join(repoRoot, "src", "index.ts"), "export function main() { return 'ok'; }\n");
  writeFileSync(path.join(repoRoot, "tests", "index.test.ts"), "import { main } from '../src/index';\nmain();\n");
  return repoRoot;
}

function compileFixture(repoRoot: string) {
  const projectModelCache = createProjectModelCache();
  return compileRepoBlueprint({
    objective: "Create coding-agent operating rules.",
    onboard: projectOnboard({ repoRoot }),
    architecture: createArchitectureMap({ repoRoot, projectModelCache }),
    entrypoints: discoverEntrypointFlows({ repoRoot, projectModelCache }),
  });
}

describe("blueprint compiler", () => {
  it("compiles native repo intelligence into a repo blueprint and constraints", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileFixture(repoRoot);

      expect(result.blueprint.kind).toBe("existing_repo");
      expect(result.blueprint.fields.packageManager.value).toBe("npm");
      expect(result.blueprint.fields.packageManager.status).toBe("confirmed_from_repo");
      expect(result.blueprint.fields.language.value).toBe("TypeScript");
      expect(result.constraints.packageManager.value).toBe("npm");
      expect(result.constraints.requiredVerification.map((command) => command.name)).toContain("test");
      expect(result.approvalNeeded.map((item) => item.field)).toContain("database");
      expect(result.approvalNeeded.find((item) => item.field === "database")?.status).toBe("unknown_blocking");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("detects database conventions from source files when dependencies do not expose them", () => {
    const repoRoot = createFixtureRepo();
    try {
      writeFileSync(
        path.join(repoRoot, "src", "sqlite-repo-index.ts"),
        "import { DatabaseSync } from 'node:sqlite';\nexport const db = new DatabaseSync(':memory:');\n",
      );

      const result = compileFixture(repoRoot);

      expect(result.blueprint.fields.database.value).toBe("SQLite");
      expect(result.blueprint.fields.database.status).toBe("confirmed_from_repo");
      expect(result.approvalNeeded.map((item) => item.field)).not.toContain("database");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("renders concise Markdown context for coding agents", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileFixture(repoRoot);
      const markdown = renderAgentContext(result);

      expect(markdown).toContain("# Wormhole Agent Context");
      expect(markdown).toContain("Package manager: npm");
      expect(markdown).toContain("Required verification");
      expect(markdown).not.toContain("undefined");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("warns when a planned command uses the wrong package manager", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileFixture(repoRoot);
      const gate = checkBlueprintGate({
        constraints: result.constraints,
        action: {
          plannedCommands: [{ command: "pnpm", args: ["test"] }],
        },
      });

      expect(gate.status).toBe("warn");
      expect(gate.findings[0]?.ruleId).toBe("package-manager");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("blocks completion claims until required verification is reported", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileFixture(repoRoot);
      const blocked = checkBlueprintGate({
        constraints: result.constraints,
        action: {
          completionClaim: true,
          plannedCommands: [{ command: "npm", args: ["test"] }],
          reportedVerification: [],
        },
      });
      const passed = checkBlueprintGate({
        constraints: result.constraints,
        action: {
          completionClaim: true,
          plannedCommands: [{ command: "npm", args: ["test"] }],
          reportedVerification: [{ command: "npm", args: ["test"], status: "passed" }],
        },
      });

      expect(blocked.status).toBe("block");
      expect(blocked.findings.map((finding) => finding.ruleId)).toContain("verification-required");
      expect(passed.status).toBe("pass");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
