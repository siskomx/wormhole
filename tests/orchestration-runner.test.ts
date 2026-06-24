import { describe, expect, it } from "vitest";
import type { ScheduledTask } from "../src/scheduler.js";
import {
  executeLocalOrchestration,
  executeLocalOrchestrationWithOutcomes,
  planLocalOrchestration,
} from "../src/orchestration-runner.js";

const inspectTask: ScheduledTask = {
  taskId: "inspect",
  objective: "Inspect the repo",
  layer: 2,
  dependencies: [],
  readSet: ["src/server.ts"],
  writeSet: [],
};

const editTask: ScheduledTask = {
  taskId: "edit",
  objective: "Edit the repo",
  layer: 3,
  dependencies: ["inspect"],
  readSet: ["src/server.ts"],
  writeSet: ["src/server.ts"],
};

describe("local orchestration runner", () => {
  it("plans local orchestration waves without executing tasks", () => {
    const plan = planLocalOrchestration({
      missionId: "M1",
      tasks: [
        inspectTask,
        editTask,
        {
          taskId: "edit-tests",
          objective: "Edit tests",
          layer: 3,
          dependencies: ["inspect"],
          readSet: ["tests/server.test.ts"],
          writeSet: ["tests/server.test.ts"],
        },
      ],
      maxDepth: 3,
      maxTasks: 5,
    });

    expect(plan.status).toBe("planned");
    expect(plan.taskCount).toBe(3);
    expect(plan.schedule.waves.map((wave) => wave.map((task) => task.taskId))).toEqual([
      ["inspect"],
      ["edit", "edit-tests"],
    ]);
  });

  it("returns blocked plans for invalid depth, budget, duplicate ids, and missing dependencies", () => {
    const tooDeep = planLocalOrchestration({
      missionId: "M1",
      tasks: [{ ...editTask, layer: 4 }],
      maxDepth: 3,
      maxTasks: 5,
    });
    const tooMany = planLocalOrchestration({
      missionId: "M1",
      tasks: [inspectTask, editTask],
      maxDepth: 3,
      maxTasks: 1,
    });
    const duplicate = planLocalOrchestration({
      missionId: "M1",
      tasks: [inspectTask, { ...inspectTask }],
      maxDepth: 3,
      maxTasks: 5,
    });
    const missingDependency = planLocalOrchestration({
      missionId: "M1",
      tasks: [editTask],
      maxDepth: 3,
      maxTasks: 5,
    });

    expect(tooDeep.status).toBe("blocked");
    expect(tooDeep.blockedReason).toContain("exceeds max depth");
    expect(tooMany.blockedReason).toContain("exceeds max task budget");
    expect(duplicate.blockedReason).toContain("Duplicate task id");
    expect(missingDependency.blockedReason).toContain("Missing dependency");
  });

  it("executes local orchestration with a caller-supplied worker", async () => {
    const result = await executeLocalOrchestration(
      {
        missionId: "M1",
        tasks: [inspectTask, editTask],
        maxDepth: 3,
        maxTasks: 5,
      },
      async (task) => ({
        taskId: task.taskId,
        status: "completed",
        output: `completed ${task.taskId}`,
      }),
    );

    expect(result.status).toBe("completed");
    expect(result.results.map((task) => task.taskId)).toEqual(["inspect", "edit"]);
    expect(result.results[1]?.output).toBe("completed edit");
  });

  it("tracks dynamically spawned local tasks under depth and budget limits", async () => {
    const result = await executeLocalOrchestration(
      {
        missionId: "M1",
        tasks: [inspectTask],
        maxDepth: 3,
        maxTasks: 3,
      },
      async (task) => ({
        taskId: task.taskId,
        status: "completed",
        spawnedTasks:
          task.taskId === "inspect"
            ? [
                {
                  taskId: "follow-up",
                  objective: "Follow up",
                  layer: 3,
                  dependencies: ["inspect"],
                  readSet: ["src/server.ts"],
                  writeSet: [],
                },
              ]
            : undefined,
      }),
    );

    expect(result.status).toBe("completed");
    expect(result.spawnedTaskCount).toBe(1);
    expect(result.results.map((task) => task.taskId)).toEqual(["inspect", "follow-up"]);
  });

  it("stops execution when a local task fails", async () => {
    const result = await executeLocalOrchestration(
      {
        missionId: "M1",
        tasks: [inspectTask, editTask],
        maxDepth: 3,
        maxTasks: 5,
      },
      async (task) => ({
        taskId: task.taskId,
        status: task.taskId === "inspect" ? "failed" : "completed",
        error: task.taskId === "inspect" ? "inspection failed" : undefined,
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("inspection failed");
    expect(result.results.map((task) => task.taskId)).toEqual(["inspect"]);
  });

  it("executes deterministic MCP-style outcomes without external adapters", async () => {
    const result = await executeLocalOrchestrationWithOutcomes({
      missionId: "M1",
      tasks: [inspectTask, editTask],
      maxDepth: 3,
      maxTasks: 5,
      outcomes: [
        { taskId: "inspect", status: "completed", output: "inspected" },
        { taskId: "edit", status: "completed", output: "edited" },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.results.map((task) => task.output)).toEqual(["inspected", "edited"]);
  });
});
