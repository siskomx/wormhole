import { describe, expect, it } from "vitest";
import {
  createAgentRegistry,
  type AgentDescriptor,
} from "../src/agent-adapter.js";

const hermesAgent: AgentDescriptor = {
  agentId: "hermes-local",
  displayName: "Hermes Local",
  target: "hermes-agent",
  transport: "mcp-stdio",
  capabilities: ["planning", "coding", "review", "tool-use"],
  installation: "installed",
  authentication: "none",
  maxConcurrentTasks: 1,
  supportsInterrupt: true,
};

const piProvider: AgentDescriptor = {
  agentId: "inflection-pi",
  displayName: "Inflection Pi",
  target: "inflection-pi",
  transport: "provider-api",
  capabilities: ["planning", "research"],
  installation: "available",
  authentication: "on_use",
  maxConcurrentTasks: 2,
  supportsInterrupt: false,
};

describe("agent adapter registry", () => {
  it("registers external agents and dispatches tasks by capability", () => {
    const registry = createAgentRegistry();
    registry.register(hermesAgent);
    registry.register(piProvider);

    const run = registry.dispatch({
      missionId: "M1",
      taskId: "T1",
      objective: "Inspect repo structure and identify orchestration gaps.",
      requiredCapabilities: ["coding", "review"],
      payload: { files: ["src/kernel.ts"] },
    });

    expect(run.assignedAgentId).toBe("hermes-local");
    expect(run.status).toBe("queued");
    expect(registry.status(run.runId).payload).toEqual({ files: ["src/kernel.ts"] });
  });

  it("tracks completion results with evidence and artifact provenance", () => {
    const registry = createAgentRegistry();
    registry.register(hermesAgent);
    const run = registry.dispatch({
      missionId: "M1",
      taskId: "T1",
      objective: "Review the task graph.",
      requiredCapabilities: ["review"],
    });

    const completed = registry.complete(run.runId, {
      status: "completed",
      summary: "Task graph has a missing worker-launch boundary.",
      evidenceIds: ["E1"],
      artifactIds: ["A1"],
    });

    expect(completed.status).toBe("completed");
    expect(completed.result?.evidenceIds).toEqual(["E1"]);
    expect(completed.result?.artifactIds).toEqual(["A1"]);
  });

  it("enforces concurrency and interrupt support", () => {
    const registry = createAgentRegistry();
    registry.register(hermesAgent);
    registry.dispatch({
      missionId: "M1",
      taskId: "T1",
      objective: "First Hermes task.",
      requiredCapabilities: ["coding"],
    });

    expect(() =>
      registry.dispatch({
        missionId: "M1",
        taskId: "T2",
        objective: "Second Hermes task.",
        requiredCapabilities: ["coding"],
      }),
    ).toThrow("No available agent satisfies task requirements");

    registry.register(piProvider);
    const piRun = registry.dispatch({
      missionId: "M1",
      taskId: "T3",
      objective: "Summarize product assumptions.",
      requiredCapabilities: ["planning"],
      preferredTargets: ["inflection-pi"],
    });

    expect(() => registry.interrupt(piRun.runId, "User changed direction")).toThrow(
      "Agent does not support interrupts",
    );
  });

  it("interrupts supported agent runs without allowing completion afterward", () => {
    const registry = createAgentRegistry();
    registry.register(hermesAgent);
    const run = registry.dispatch({
      missionId: "M1",
      taskId: "T1",
      objective: "Inspect implementation options.",
      requiredCapabilities: ["coding"],
    });

    const interrupted = registry.interrupt(run.runId, "Stop and return current state.");

    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.interruptReason).toBe("Stop and return current state.");
    expect(() =>
      registry.complete(run.runId, {
        status: "completed",
        summary: "Late result.",
      }),
    ).toThrow("Cannot complete interrupted agent run");
  });
});
