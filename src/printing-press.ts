import type { AgentDescriptor } from "./agent-adapter.js";

export type PrintingPressEvidenceMode = "compact" | "raw" | "sqlite";

export type PrintingPressCliDescriptor = {
  cliId: string;
  displayName: string;
  command: string;
  args?: string[];
  capabilities: string[];
  installation: "available" | "installed" | "disabled";
  authentication: "on_install" | "on_use" | "none";
  evidenceMode: PrintingPressEvidenceMode;
  providesMcpServer: boolean;
  supportsInterrupt: boolean;
  maxConcurrentTasks: number;
  skillName?: string;
  category?: string;
};

export type PrintingPressSelection = {
  requiredCapabilities: string[];
  preferredCliIds?: string[];
};

export type PrintingPressRegistry = {
  register(cli: PrintingPressCliDescriptor): PrintingPressCliDescriptor;
  list(): PrintingPressCliDescriptor[];
  select(input: PrintingPressSelection): PrintingPressCliDescriptor;
  toAgentDescriptor(cliId: string): AgentDescriptor;
};

function cloneCli(cli: PrintingPressCliDescriptor): PrintingPressCliDescriptor {
  return {
    ...cli,
    args: cli.args ? [...cli.args] : undefined,
    capabilities: [...cli.capabilities],
  };
}

function matchesSelection(
  cli: PrintingPressCliDescriptor,
  input: PrintingPressSelection,
): boolean {
  if (cli.installation === "disabled") {
    return false;
  }
  if (
    input.preferredCliIds &&
    input.preferredCliIds.length > 0 &&
    !input.preferredCliIds.includes(cli.cliId)
  ) {
    return false;
  }
  return input.requiredCapabilities.every((capability) =>
    cli.capabilities.includes(capability),
  );
}

export function createPrintingPressRegistry(): PrintingPressRegistry {
  const clis = new Map<string, PrintingPressCliDescriptor>();

  function getCli(cliId: string): PrintingPressCliDescriptor {
    const cli = clis.get(cliId);
    if (!cli) {
      throw new Error(`Printing Press CLI not found: ${cliId}`);
    }
    return cli;
  }

  return {
    register(cli: PrintingPressCliDescriptor): PrintingPressCliDescriptor {
      if (cli.capabilities.length === 0) {
        throw new Error("Printing Press CLI must declare at least one capability");
      }
      if (cli.maxConcurrentTasks < 1) {
        throw new Error("Printing Press CLI maxConcurrentTasks must be at least 1");
      }
      const registered = cloneCli(cli);
      clis.set(cli.cliId, registered);
      return cloneCli(registered);
    },

    list(): PrintingPressCliDescriptor[] {
      return [...clis.values()].map(cloneCli);
    },

    select(input: PrintingPressSelection): PrintingPressCliDescriptor {
      const cli = [...clis.values()].find((candidate) =>
        matchesSelection(candidate, input),
      );
      if (!cli) {
        throw new Error("No Printing Press CLI satisfies task requirements");
      }
      return cloneCli(cli);
    },

    toAgentDescriptor(cliId: string): AgentDescriptor {
      const cli = getCli(cliId);
      return {
        agentId: `printing-press:${cli.cliId}`,
        displayName: cli.displayName,
        target: "printing-press",
        transport: "cli",
        capabilities: [...cli.capabilities],
        installation: cli.installation,
        authentication: cli.authentication,
        maxConcurrentTasks: cli.maxConcurrentTasks,
        supportsInterrupt: cli.supportsInterrupt,
      };
    },
  };
}
