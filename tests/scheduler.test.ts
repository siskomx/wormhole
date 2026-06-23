import { describe, expect, it } from "vitest";
import { createDagSchedule, runDagSchedule } from "../src/scheduler.js";

describe("DAG scheduler with read/write locks", () => {
  it("builds dependency waves while separating write conflicts", () => {
    const schedule = createDagSchedule([
      {
        taskId: "inspect",
        objective: "Inspect server",
        layer: 2,
        dependencies: [],
        readSet: ["src/server.ts"],
        writeSet: [],
      },
      {
        taskId: "edit-server",
        objective: "Edit server",
        layer: 3,
        dependencies: ["inspect"],
        readSet: ["src/server.ts"],
        writeSet: ["src/server.ts"],
      },
      {
        taskId: "edit-tests",
        objective: "Edit tests",
        layer: 3,
        dependencies: ["inspect"],
        readSet: ["tests/server.test.ts"],
        writeSet: ["tests/server.test.ts"],
      },
      {
        taskId: "also-edit-server",
        objective: "Alternative server edit",
        layer: 3,
        dependencies: ["inspect"],
        readSet: ["src/server.ts"],
        writeSet: ["src/server.ts"],
      },
    ]);

    expect(schedule.waves.map((wave) => wave.map((task) => task.taskId))).toEqual([
      ["inspect"],
      ["edit-server", "edit-tests"],
      ["also-edit-server"],
    ]);
    expect(schedule.lockDeferrals).toContainEqual(
      expect.objectContaining({
        taskId: "also-edit-server",
        reason: "write lock conflict",
      }),
    );
  });

  it("runs independent wave tasks before dependent tasks", async () => {
    const order: string[] = [];
    const result = await runDagSchedule(
      [
        {
          taskId: "a",
          objective: "A",
          layer: 2,
          dependencies: [],
          readSet: [],
          writeSet: ["a.txt"],
        },
        {
          taskId: "b",
          objective: "B",
          layer: 2,
          dependencies: [],
          readSet: [],
          writeSet: ["b.txt"],
        },
        {
          taskId: "c",
          objective: "C",
          layer: 3,
          dependencies: ["a", "b"],
          readSet: ["a.txt", "b.txt"],
          writeSet: ["c.txt"],
        },
      ],
      async (task) => {
        order.push(task.taskId);
        return { taskId: task.taskId, status: "completed" as const };
      },
    );

    expect(result.status).toBe("completed");
    expect(order.slice(0, 2).sort()).toEqual(["a", "b"]);
    expect(order[2]).toBe("c");
  });
});
