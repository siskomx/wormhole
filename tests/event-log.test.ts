import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createJsonlEventLog } from "../src/event-log.js";
import { createInMemoryKernel } from "../src/kernel.js";

describe("JSONL event log", () => {
  it("appends kernel events as one JSON object per line", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wormhole-event-log-"));
    const logPath = path.join(tempDir, "events.jsonl");
    const eventLog = createJsonlEventLog(logPath);
    const kernel = createInMemoryKernel({ eventLog });

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

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    const eventTypes = lines.map((line) => JSON.parse(line).type);

    expect(eventTypes).toEqual([
      "mission.started",
      "round.started",
      "evidence.recorded",
    ]);
  });
});
