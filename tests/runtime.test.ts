import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDefaultKernel,
  createDefaultToolHandlerOptions,
  resolveDefaultEventLogPath,
  resolveDefaultRuntimeStatePath,
} from "../src/runtime.js";

describe("runtime defaults", () => {
  it("stores the default event log under .wormhole in the working directory", () => {
    const cwd = path.resolve("C:/work/repo");

    expect(resolveDefaultEventLogPath(cwd)).toBe(
      path.join(cwd, ".wormhole", "events.jsonl"),
    );
    expect(resolveDefaultRuntimeStatePath(cwd)).toBe(
      path.join(cwd, ".wormhole", "runtime-state.json"),
    );
    expect(createDefaultToolHandlerOptions(cwd)).toEqual({
      runtimeStatePath: path.join(cwd, ".wormhole", "runtime-state.json"),
    });
  });

  it("loads projected state from the default event log on restart", () => {
    const cwd = path.resolve(".wormhole-runtime-test");
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(cwd, { recursive: true });

    try {
      const kernel = createDefaultKernel(cwd);
      const mission = kernel.startMission({
        objective: "Plan how to add audit logging",
        repoRoot: process.cwd(),
      });
      kernel.startRound(mission.missionId);
      kernel.recordEvidence(mission.missionId, {
        sourceType: "file",
        sourcePath: "docs/planning/wormhole-canonical-plan.md",
        retrievalMethod: "read_file",
        summary: "Canonical plan exists.",
      });

      expect(existsSync(resolveDefaultEventLogPath(cwd))).toBe(true);

      const restarted = createDefaultKernel(cwd);
      expect(restarted.missionStatus(mission.missionId).evidenceCount).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
