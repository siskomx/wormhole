import { describe, expect, it } from "vitest";
import { runDynamicDagSchedule } from "../src/scheduler.js";

describe("dynamic DAG spawning", () => {
  it("runs dynamically spawned child tasks without exceeding depth", async () => {
    const seen: string[] = [];
    const result = await runDynamicDagSchedule(
      [
        {
          taskId: "root",
          objective: "Root investigation",
          layer: 1,
          dependencies: [],
          readSet: [],
          writeSet: [],
        },
      ],
      async (task) => {
        seen.push(task.taskId);
        return {
          taskId: task.taskId,
          status: "completed" as const,
          spawnedTasks:
            task.taskId === "root"
              ? [
                  {
                    taskId: "child",
                    objective: "Child investigation",
                    layer: 2 as const,
                    dependencies: ["root"],
                    readSet: [],
                    writeSet: [],
                  },
                ]
              : [],
        };
      },
      { maxDepth: 4, maxTasks: 4 },
    );

    expect(result.status).toBe("completed");
    expect(seen).toEqual(["root", "child"]);
    expect(result.spawnedTaskCount).toBe(1);
  });

  it("counts total dynamic tasks once across deeper spawn chains", async () => {
    const result = await runDynamicDagSchedule(
      [
        {
          taskId: "root",
          objective: "Root investigation",
          layer: 1,
          dependencies: [],
          readSet: [],
          writeSet: [],
        },
      ],
      async (task) => ({
        taskId: task.taskId,
        status: "completed" as const,
        spawnedTasks:
          task.layer < 4
            ? [
                {
                  taskId: `layer-${task.layer + 1}`,
                  objective: `Layer ${task.layer + 1}`,
                  layer: (task.layer + 1) as 1 | 2 | 3 | 4,
                  dependencies: [task.taskId],
                  readSet: [],
                  writeSet: [],
                },
              ]
            : [],
      }),
      { maxDepth: 4, maxTasks: 4 },
    );

    expect(result.status).toBe("completed");
    expect(result.results.map((task) => task.taskId)).toEqual([
      "root",
      "layer-2",
      "layer-3",
      "layer-4",
    ]);
    expect(result.spawnedTaskCount).toBe(3);
  });
});
