import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createJsonlEventLog, readJsonlEvents } from "../src/event-log.js";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

function startMissionWithTask() {
  const kernel = createInMemoryKernel();
  const mission = kernel.startMission({
    objective: "Coordinate active sub-orchestrators",
    repoRoot: process.cwd(),
  });
  const task = kernel.registerTask(mission.missionId, {
    layer: 2,
    name: "Dax repo investigator",
    objective: "Inspect current repo flow and report implementation risks.",
  });

  return { kernel, mission, task };
}

describe("active sub-orchestrator control plane", () => {
  it("tracks task heartbeat and current flow", () => {
    const { kernel, mission, task } = startMissionWithTask();

    const status = kernel.reportTaskStatus(mission.missionId, task.taskId, {
      status: "running",
      currentFlow: "Reading kernel and MCP tool surfaces",
      summary: "Found evidence and plan tools.",
      touchedPaths: ["src/kernel.ts", "src/mcp-server.ts"],
    });

    expect(status.status).toBe("running");
    expect(status.currentFlow).toBe("Reading kernel and MCP tool surfaces");
    expect(kernel.taskStatus(mission.missionId, task.taskId).pendingAckCount).toBe(0);
  });

  it("keeps a task running when the parent sends a status query", () => {
    const { kernel, mission, task } = startMissionWithTask();
    kernel.reportTaskStatus(mission.missionId, task.taskId, {
      status: "running",
      currentFlow: "Inspecting tests",
      summary: "Gathering context.",
    });

    const message = kernel.sendControlMessage(mission.missionId, {
      targetTaskId: task.taskId,
      mode: "query",
      content: "What flow are you currently in?",
      sender: "parent",
    });

    expect(message.effectivePolicy).toBe("next_checkpoint");
    expect(message.ackRequired).toBe(false);
    expect(kernel.taskStatus(mission.missionId, task.taskId).task.status).toBe("running");
    expect(kernel.listTaskInbox(mission.missionId, task.taskId)).toHaveLength(1);
  });

  it("pauses a task for a direction change until the child acknowledges it", () => {
    const { kernel, mission, task } = startMissionWithTask();
    kernel.reportTaskStatus(mission.missionId, task.taskId, {
      status: "running",
      currentFlow: "Inspecting backend",
      summary: "Looking at API code.",
    });

    const message = kernel.sendControlMessage(mission.missionId, {
      targetTaskId: task.taskId,
      mode: "direction_change",
      content: "Stop backend discovery and focus on UI planning.",
      sender: "parent",
    });

    expect(message.effectivePolicy).toBe("pause_until_ack");
    expect(message.ackRequired).toBe(true);
    expect(kernel.taskStatus(mission.missionId, task.taskId).task.status).toBe("paused");
    expect(kernel.taskStatus(mission.missionId, task.taskId).pendingAckCount).toBe(1);

    const ack = kernel.ackControlMessage(mission.missionId, task.taskId, message.messageId, {
      acknowledgedBy: "child",
      response: "Acknowledged. Revised local plan to focus UI evidence.",
    });

    expect(ack.acknowledgedAt).toBeDefined();
    expect(kernel.taskStatus(mission.missionId, task.taskId).task.status).toBe("running");
    expect(kernel.taskStatus(mission.missionId, task.taskId).pendingAckCount).toBe(0);
  });

  it("interrupts a task immediately and requires acknowledgement", () => {
    const { kernel, mission, task } = startMissionWithTask();
    kernel.reportTaskStatus(mission.missionId, task.taskId, {
      status: "running",
      currentFlow: "Preparing patch",
      summary: "About to edit files.",
    });

    const message = kernel.sendControlMessage(mission.missionId, {
      targetTaskId: task.taskId,
      mode: "interrupt",
      content: "Pause now and return current state.",
      sender: "user",
    });

    expect(message.effectivePolicy).toBe("immediate_stop");
    expect(message.ackRequired).toBe(true);
    expect(kernel.taskStatus(mission.missionId, task.taskId).task.status).toBe("interrupted");
    expect(kernel.taskStatus(mission.missionId, task.taskId).pendingAckCount).toBe(1);
  });

  it("replays task status, messages, and acknowledgements from JSONL", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wormhole-control-plane-"));
    const logPath = path.join(tempDir, "events.jsonl");
    const kernel = createInMemoryKernel({ eventLog: createJsonlEventLog(logPath) });
    const mission = kernel.startMission({
      objective: "Coordinate active sub-orchestrators",
      repoRoot: process.cwd(),
    });
    const task = kernel.registerTask(mission.missionId, {
      layer: 2,
      name: "Dax repo investigator",
      objective: "Inspect current repo flow.",
    });
    kernel.reportTaskStatus(mission.missionId, task.taskId, {
      status: "running",
      currentFlow: "Inspecting tests",
      summary: "Gathering context.",
    });
    const message = kernel.sendControlMessage(mission.missionId, {
      targetTaskId: task.taskId,
      mode: "direction_change",
      content: "Focus on UI planning.",
      sender: "parent",
    });
    kernel.ackControlMessage(mission.missionId, task.taskId, message.messageId, {
      acknowledgedBy: "child",
      response: "Acknowledged.",
    });

    const replayed = createInMemoryKernel({ initialEvents: readJsonlEvents(logPath) });
    const status = replayed.taskStatus(mission.missionId, task.taskId);

    expect(status.task.status).toBe("running");
    expect(status.pendingAckCount).toBe(0);
    expect(replayed.listTaskInbox(mission.missionId, task.taskId)).toHaveLength(0);
    expect(replayed.listTaskInbox(mission.missionId, task.taskId, { includeAcknowledged: true }))
      .toHaveLength(1);
  });

  it("exposes the control plane through generic tool handlers", () => {
    const kernel = createInMemoryKernel();
    const tools = createToolHandlers(kernel);
    const mission = tools.missionStart({
      objective: "Coordinate active sub-orchestrators",
      repoRoot: process.cwd(),
    });
    const task = tools.taskRegister({
      missionId: mission.missionId,
      layer: 2,
      name: "Dax repo investigator",
      objective: "Inspect current repo flow.",
    });

    const message = tools.controlMessage({
      missionId: mission.missionId,
      targetTaskId: task.taskId,
      mode: "query",
      content: "What are you doing?",
      sender: "parent",
    });

    expect(message.effectivePolicy).toBe("next_checkpoint");
    expect(tools.taskInbox({ missionId: mission.missionId, taskId: task.taskId }))
      .toHaveLength(1);
  });
});
