import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAppProcessGate,
  compileAppProcess,
  renderAppProcessContext,
  validateAppProcess,
} from "../src/app-process.js";
import { compileBootstrapBlueprint } from "../src/blueprint.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-app-process-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: {
          test: "vitest run tests",
        },
        dependencies: {
          pg: "^8.16.0",
          react: "^19.2.0",
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
  writeFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(path.join(repoRoot, "README.md"), "# Accounting portal\n\nManages clients and invoices.\n");
  writeFileSync(path.join(repoRoot, "src", "index.tsx"), "export function App() { return null; }\n");
  return repoRoot;
}

describe("app process compiler", () => {
  it("drafts product definition, roadmap, backlog, and operating gates from a repo blueprint", () => {
    const repoRoot = createFixtureRepo();
    try {
      const blueprint = compileBootstrapBlueprint({
        repoRoot,
        objective: "Add subscription billing for accountants.",
      });
      const result = compileAppProcess({
        repoRoot,
        objective: "Add subscription billing for accountants.",
        blueprint,
      });

      expect(result.appProcess.schemaVersion).toBe("app-process.v0");
      expect(result.appProcess.status).toBe("partial");
      expect(result.appProcess.productDefinition.value.keyEntities).toEqual(
        expect.arrayContaining(["Subscription", "Invoice", "Payment", "Accountant"]),
      );
      expect(result.appProcess.productDefinition.value.securityPosture).toBe("high");
      expect(result.appProcess.architecture.value.stack.packageManager).toBe("pnpm");
      expect(result.appProcess.architecture.value.stack.database).toBe("Postgres");
      expect(result.appProcess.backlog.value.stories.map((story) => story.ownerLane)).toEqual(
        expect.arrayContaining(["backend", "frontend", "security", "tests"]),
      );
      expect(result.appProcess.backlog.value.stories.every((story) => story.acceptanceCriteria.length > 0)).toBe(true);
      expect(result.appProcess.backlog.value.stories.every((story) => story.verifiableBy.length > 0)).toBe(true);
      expect(result.appProcess.progressive.lanes.map((lane) => lane.lane)).toEqual(
        expect.arrayContaining(["discovery", "product", "roadmap", "backlog", "architecture", "ux", "security", "verification"]),
      );
      expect(validateAppProcess(result.appProcess).valid).toBe(true);

      const blocked = checkAppProcessGate({
        appProcess: result.appProcess,
        action: {
          completionClaim: true,
          reportedVerification: [],
        },
      });
      const passed = checkAppProcessGate({
        appProcess: result.appProcess,
        action: {
          completionClaim: true,
          acceptedDraftSections: ["productDefinition", "roadmap", "backlog", "ux", "security"],
          reportedVerification: [{ command: "pnpm", args: ["run", "test"], status: "passed" }],
        },
      });

      expect(blocked.status).toBe("block");
      expect(blocked.findings.map((finding) => finding.ruleId)).toEqual(
        expect.arrayContaining(["app-process:productDefinition:unconfirmed", "app-process:verification-required"]),
      );
      expect(passed.status).toBe("pass");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("renders concise app context without undefined fields", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileAppProcess({
        repoRoot,
        objective: "Build a client invoice dashboard.",
        blueprint: compileBootstrapBlueprint({ repoRoot, objective: "Build a client invoice dashboard." }),
      });

      const markdown = renderAppProcessContext(result);

      expect(markdown).toContain("# Wormhole App Process Context");
      expect(markdown).toContain("Product definition: ai_drafted");
      expect(markdown).toContain("Current phase: 1");
      expect(markdown).not.toContain("undefined");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not promote generic planning words into product entities", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-app-process-generic-"));
    try {
      writeFileSync(
        path.join(repoRoot, "package.json"),
        JSON.stringify(
          {
            type: "module",
            scripts: { test: "vitest run tests" },
            devDependencies: { typescript: "^6.0.3", vitest: "^4.1.9" },
          },
          null,
          2,
        ),
      );
      writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
      const result = compileAppProcess({
        repoRoot,
        objective: "Create a full app process map.",
        blueprint: compileBootstrapBlueprint({ repoRoot, objective: "Create a full app process map." }),
      });

      expect(result.appProcess.productDefinition.value.keyEntities.length).toBeGreaterThan(0);
      for (const genericEntity of ["Full", "Proces", "Process", "Map", "Workflow", "Workflows"]) {
        expect(result.appProcess.productDefinition.value.keyEntities).not.toContain(genericEntity);
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
