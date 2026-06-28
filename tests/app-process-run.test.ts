import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileAppProcess, type AppProcess } from "../src/app-process.js";
import {
  acceptAppProcessSection,
  createAppProcessRunStatus,
  createInitialAppProcessRunState,
  continueAppProcessRun,
  recordAppProcessVerification,
  type AppProcessDraftSectionId,
} from "../src/app-process-run.js";
import { compileBootstrapBlueprint } from "../src/blueprint.js";

const DRAFT_SECTIONS: AppProcessDraftSectionId[] = [
  "productDefinition",
  "roadmap",
  "backlog",
  "ux",
  "security",
];

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-app-process-run-"));
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
  writeFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(path.join(repoRoot, "src", "index.tsx"), "export function App() { return null; }\n");
  return repoRoot;
}

function compileFixtureAppProcess(repoRoot: string): AppProcess {
  return compileAppProcess({
    repoRoot,
    objective: "Build a shared team scheduling app.",
    blueprint: compileBootstrapBlueprint({ repoRoot, objective: "Build a shared team scheduling app." }),
  }).appProcess;
}

describe("app process run controller", () => {
  it("tracks accepted draft sections, continuation, and verification-backed gate status", () => {
    const repoRoot = createFixtureRepo();
    try {
      const appProcess = compileFixtureAppProcess(repoRoot);
      let runState = createInitialAppProcessRunState({
        appProcess,
        now: "2026-01-01T00:00:00.000Z",
      });

      const initialStatus = createAppProcessRunStatus({ appProcess, runState });

      expect(initialStatus.status).toBe("blocked");
      expect(initialStatus.acceptedDraftSections).toEqual([]);
      expect(initialStatus.unacceptedDraftSections).toEqual(DRAFT_SECTIONS);
      expect(initialStatus.nextAction).toMatchObject({
        kind: "accept_section",
        section: "productDefinition",
      });
      expect(initialStatus.gate.findings.map((finding) => finding.ruleId)).toContain(
        "app-process:productDefinition:unconfirmed",
      );

      for (const section of DRAFT_SECTIONS) {
        runState = acceptAppProcessSection({
          appProcess,
          runState,
          section,
          acceptedBy: "test",
          now: `2026-01-01T00:00:0${DRAFT_SECTIONS.indexOf(section) + 1}.000Z`,
        }).runState;
      }

      const acceptedStatus = createAppProcessRunStatus({ appProcess, runState });
      expect(acceptedStatus.unacceptedDraftSections).toEqual([]);
      expect(acceptedStatus.nextAction.kind).toBe("continue_story");

      const continued = continueAppProcessRun({
        appProcess,
        runState,
        now: "2026-01-01T00:00:10.000Z",
      });
      runState = continued.runState;

      expect(continued.continuation).toMatchObject({
        action: "prepare_story",
        storyId: "APP-P0-S1",
        ownerLane: "product",
        status: "prepared",
      });
      expect(createAppProcessRunStatus({ appProcess, runState }).nextAction.kind).toBe("record_verification");

      const requiredCommand = appProcess.verification.value.requiredCommands[0];
      expect(requiredCommand).toBeDefined();
      runState = recordAppProcessVerification({
        appProcess,
        runState,
        command: requiredCommand!.command,
        args: requiredCommand!.args,
        status: "passed",
        summary: "Focused verification passed in dogfood run.",
        now: "2026-01-01T00:00:11.000Z",
      }).runState;

      const verifiedStatus = createAppProcessRunStatus({ appProcess, runState });
      expect(verifiedStatus.status).toBe("ready");
      expect(verifiedStatus.gate.status).toBe("pass");
      expect(verifiedStatus.nextAction.kind).toBe("none");
      expect(verifiedStatus.verification.missingCommands).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
