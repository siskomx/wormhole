import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-app-process-tools-"));
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

describe("app process tool handlers", () => {
  it("compiles, validates, and writes app process artifacts through tools", () => {
    const repoRoot = createFixtureRepo();
    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const compiled = tools.appProcessCompile({
        repoRoot,
        objective: "Build a shared team scheduling app.",
      });
      const validation = tools.appProcessValidate({ appProcess: compiled.appProcess });
      const written = tools.appProcessWriteArtifacts({
        repoRoot,
        objective: "Build a shared team scheduling app.",
      });

      expect(compiled.appProcess.productDefinition.value.keyEntities).toContain("Team");
      expect(validation.valid).toBe(true);
      expect(written.files.map((file) => file.relativePath)).toContain(".wormhole/app-process.json");
      expect(existsSync(path.join(repoRoot, ".wormhole", "app-context.md"))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("drives durable app-process status, acceptance, continuation, and verification through tools", () => {
    const repoRoot = createFixtureRepo();
    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      tools.appProcessWriteArtifacts({
        repoRoot,
        objective: "Build a shared team scheduling app.",
      });

      const initialStatus = tools.appProcessStatus({ repoRoot });
      expect(initialStatus.status.status).toBe("blocked");
      expect(initialStatus.status.nextAction).toMatchObject({
        kind: "accept_section",
        section: "productDefinition",
      });

      for (const section of ["productDefinition", "roadmap", "backlog", "ux", "security"] as const) {
        tools.appProcessAcceptSection({ repoRoot, section, acceptedBy: "test" });
      }

      const continued = tools.appProcessContinue({ repoRoot });
      expect(continued.status.currentContinuation).toMatchObject({
        storyId: "APP-P0-S1",
        status: "prepared",
      });

      const verificationCommand = continued.appProcess.verification.value.requiredCommands[0];
      const recorded = tools.appProcessRecordVerification({
        repoRoot,
        command: verificationCommand!.command,
        args: verificationCommand!.args,
        status: "passed",
        summary: "Tool-level verification captured.",
      });

      expect(recorded.status.status).toBe("ready");
      expect(recorded.status.gate.status).toBe("pass");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
