import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

describe("agent transport execution", () => {
  it("dispatches and executes CLI agents with evidence hashes", async () => {
    const tools = createToolHandlers(createInMemoryKernel());
    tools.agentRegister({
      agentId: "cli-coder",
      displayName: "CLI Coder",
      target: "local-cli",
      transport: "cli",
      capabilities: ["coding"],
      installation: "installed",
      authentication: "none",
      maxConcurrentTasks: 1,
      supportsInterrupt: false,
      runtime: {
        command: process.execPath,
        args: ["-e", "process.stdin.on('data', data => console.log(JSON.parse(data).objective))"],
        timeoutMs: 2000,
      },
    });

    const completed = await tools.agentDispatchExecute({
      missionId: "M1",
      taskId: "T1",
      objective: "Implement a focused test",
      requiredCapabilities: ["coding"],
    });

    expect(completed.status).toBe("completed");
    expect(completed.result?.summary).toContain("CLI agent completed");
    expect(JSON.stringify(completed.result?.output)).toContain("Implement a focused test");
    expect(JSON.stringify(completed.result?.output)).toMatch(/sha256:/);
  });

  it("records failed executable dispatches when an agent runtime is misconfigured", async () => {
    const tools = createToolHandlers(createInMemoryKernel());
    tools.agentRegister({
      agentId: "bad-cli",
      displayName: "Bad CLI",
      target: "local-cli",
      transport: "cli",
      capabilities: ["coding"],
      installation: "installed",
      authentication: "none",
      maxConcurrentTasks: 1,
      supportsInterrupt: false,
    });

    const failed = await tools.agentDispatchExecute({
      missionId: "M1",
      taskId: "T1",
      objective: "Run with missing command",
      requiredCapabilities: ["coding"],
    });
    const nextRun = tools.agentDispatch({
      missionId: "M1",
      taskId: "T2",
      objective: "Capacity is freed after failed execution",
      requiredCapabilities: ["coding"],
    });

    expect(failed.status).toBe("failed");
    expect(failed.result?.summary).toContain("runtime.command");
    expect(nextRun.assignedAgentId).toBe("bad-cli");
  });
});
