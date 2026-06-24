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
});
