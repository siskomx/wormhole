import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileAppProcess } from "../src/app-process.js";
import {
  acceptAppProcessRunSectionFile,
  loadAppProcessRunBundle,
  recordAppProcessVerificationFile,
} from "../src/app-process-run-files.js";
import { writeAppProcessArtifacts } from "../src/app-process-files.js";
import { compileBootstrapBlueprint } from "../src/blueprint.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-app-process-run-files-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
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
  writeFileSync(path.join(repoRoot, "src", "index.ts"), "export const value = 1;\n");
  return repoRoot;
}

describe("app process run files", () => {
  it("loads app-process artifacts, persists run state, appends events, and reports missing artifacts", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileAppProcess({
        repoRoot,
        objective: "Build a team scheduling app.",
        blueprint: compileBootstrapBlueprint({ repoRoot, objective: "Build a team scheduling app." }),
      });
      writeAppProcessArtifacts({ repoRoot, result });

      const initialBundle = loadAppProcessRunBundle({ repoRoot });
      expect(initialBundle.status.unacceptedDraftSections).toContain("productDefinition");
      expect(initialBundle.artifacts.some((artifact) => artifact.status === "missing")).toBe(false);

      const accepted = acceptAppProcessRunSectionFile({
        repoRoot,
        section: "productDefinition",
        acceptedBy: "test",
        now: "2026-01-01T00:00:00.000Z",
      });

      expect(accepted.status.acceptedDraftSections).toContain("productDefinition");
      expect(existsSync(path.join(repoRoot, ".wormhole", "app-process", "run-state.json"))).toBe(true);
      const eventLog = readFileSync(path.join(repoRoot, ".wormhole", "app-process", "events.jsonl"), "utf8");
      expect(eventLog).toContain("run_initialized");
      expect(eventLog).toContain("section_accepted");

      const requiredCommand = result.appProcess.verification.value.requiredCommands[0];
      recordAppProcessVerificationFile({
        repoRoot,
        command: requiredCommand!.command,
        args: requiredCommand!.args,
        status: "passed",
        summary: "Verification captured.",
        now: "2026-01-01T00:00:01.000Z",
      });

      unlinkSync(path.join(repoRoot, ".wormhole", "lanes", "ux.md"));
      const staleBundle = loadAppProcessRunBundle({ repoRoot });
      expect(staleBundle.artifacts).toContainEqual(
        expect.objectContaining({
          relativePath: ".wormhole/lanes/ux.md",
          status: "missing",
        }),
      );
      expect(staleBundle.status.status).toBe("blocked");
      expect(staleBundle.status.blockedGates).toContainEqual(
        expect.objectContaining({
          ruleId: "artifact-freshness:missing",
          severity: "block",
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("marks app-process artifacts stale when the requested objective differs", () => {
    const repoRoot = createFixtureRepo();
    try {
      const originalObjective = "Build a team scheduling app.";
      const result = compileAppProcess({
        repoRoot,
        objective: originalObjective,
        blueprint: compileBootstrapBlueprint({ repoRoot, objective: originalObjective }),
      });
      writeAppProcessArtifacts({ repoRoot, result });

      const staleBundle = loadAppProcessRunBundle({
        repoRoot,
        objective: "Build a billing lifecycle app.",
      });

      expect(staleBundle.objectiveFreshness).toEqual(
        expect.objectContaining({
          status: "stale",
          expectedObjective: "Build a billing lifecycle app.",
          actualObjective: originalObjective,
        }),
      );
      expect(staleBundle.artifacts).toContainEqual(
        expect.objectContaining({
          relativePath: ".wormhole/app-process.json",
          status: "stale",
        }),
      );
      expect(staleBundle.artifacts.filter((artifact) => artifact.relativePath === ".wormhole/app-process.json")).toHaveLength(1);
      expect(staleBundle.status.status).toBe("blocked");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("marks app-process artifacts stale when same-objective repo fingerprints drift", () => {
    const repoRoot = createFixtureRepo();
    try {
      const originalObjective = "Build a team scheduling app.";
      const result = compileAppProcess({
        repoRoot,
        objective: originalObjective,
        blueprint: compileBootstrapBlueprint({ repoRoot, objective: originalObjective }),
      });
      writeAppProcessArtifacts({ repoRoot, result });
      mkdirSync(path.join(repoRoot, "src", "features", "billing-lifecycle"), { recursive: true });
      writeFileSync(
        path.join(repoRoot, "src", "features", "billing-lifecycle", "index.ts"),
        "export function lifecycleAccountingMarker() { return 'billing'; }\n",
      );

      const staleBundle = loadAppProcessRunBundle({
        repoRoot,
        objective: originalObjective,
      });

      expect(staleBundle.objectiveFreshness?.status).toBe("fresh");
      expect(staleBundle.fingerprintFreshness?.status).toBe("stale");
      expect(staleBundle.fingerprintFreshness?.featureIndex?.status).toBe("stale");
      expect(staleBundle.fingerprintFreshness?.blueprint?.status).toBe("stale");
      expect(staleBundle.artifacts).toContainEqual(
        expect.objectContaining({
          relativePath: ".wormhole/app-process.json",
          status: "stale",
        }),
      );
      expect(staleBundle.artifacts.filter((artifact) => artifact.relativePath === ".wormhole/app-process.json")).toHaveLength(1);
      expect(staleBundle.status.status).toBe("blocked");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
