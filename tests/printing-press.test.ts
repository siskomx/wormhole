import { describe, expect, it } from "vitest";
import {
  createPrintingPressRegistry,
  type PrintingPressCliDescriptor,
} from "../src/printing-press.js";

const linearCli: PrintingPressCliDescriptor = {
  cliId: "pp-linear",
  displayName: "Printing Press Linear",
  command: "/pp-linear",
  args: ["sql"],
  capabilities: ["project-management", "evidence", "sqlite-query"],
  installation: "installed",
  authentication: "on_use",
  evidenceMode: "sqlite",
  providesMcpServer: true,
  supportsInterrupt: false,
  maxConcurrentTasks: 2,
};

describe("Printing Press CLI registry", () => {
  it("registers generated CLIs and selects them by required capability", () => {
    const registry = createPrintingPressRegistry();
    registry.register(linearCli);

    const selected = registry.select({
      requiredCapabilities: ["project-management", "sqlite-query"],
    });

    expect(selected.cliId).toBe("pp-linear");
    expect(registry.list().map((cli) => cli.cliId)).toEqual(["pp-linear"]);
  });

  it("rejects disabled or non-matching CLIs", () => {
    const registry = createPrintingPressRegistry();
    registry.register({
      ...linearCli,
      cliId: "disabled-linear",
      installation: "disabled",
    });

    expect(() =>
      registry.select({
        requiredCapabilities: ["project-management"],
      }),
    ).toThrow("No Printing Press CLI satisfies task requirements");
  });

  it("converts a CLI descriptor into a Wormhole external agent descriptor", () => {
    const registry = createPrintingPressRegistry();
    registry.register(linearCli);

    const agent = registry.toAgentDescriptor("pp-linear");

    expect(agent.agentId).toBe("printing-press:pp-linear");
    expect(agent.target).toBe("printing-press");
    expect(agent.transport).toBe("cli");
    expect(agent.capabilities).toEqual(linearCli.capabilities);
    expect(agent.maxConcurrentTasks).toBe(2);
  });

  it("verifies and runs registered printed CLIs with evidence bundles", async () => {
    const registry = createPrintingPressRegistry();
    registry.register({
      ...linearCli,
      command: process.execPath,
      args: ["-e", "console.log('printed tool ok')"],
      authentication: "none",
    });

    const verification = registry.verify({ cliId: "pp-linear" });
    const run = await registry.run({
      cliId: "pp-linear",
      timeoutMs: 2_000,
    });

    expect(verification.status).toBe("passed");
    expect(run.status).toBe("completed");
    expect(run.stdout).toContain("printed tool ok");
    expect(run.exitCode).toBe(0);
    expect(run.evidenceBundle.hash).toMatch(/^sha256:/);
    expect(run.evidenceBundle.command).toContain(process.execPath);
  });

  it("reports timed-out printed CLI runs deterministically", async () => {
    const registry = createPrintingPressRegistry();
    registry.register({
      ...linearCli,
      command: process.execPath,
      args: ["-e", "setTimeout(() => console.log('late'), 500)"],
      authentication: "none",
    });

    const run = await registry.run({
      cliId: "pp-linear",
      timeoutMs: 25,
    });

    expect(run.status).toBe("timed_out");
    expect(run.exitCode).toBeNull();
    expect(run.stderr).toContain("timed out");
  });
});
