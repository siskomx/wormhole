import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
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

export type PrintingPressVerification = {
  cliId: string;
  status: "passed" | "failed";
  checks: Array<{ name: string; passed: boolean; message: string }>;
};

export type PrintingPressRunInput = {
  cliId: string;
  args?: string[];
  stdin?: string;
  timeoutMs?: number;
};

export type PrintingPressEvidenceBundle = {
  hash: string;
  command: string;
  stdoutHash: string;
  stderrHash: string;
  exitCode: number | null;
  startedAt: string;
  completedAt: string;
};

export type PrintingPressRunResult = {
  runId: string;
  cliId: string;
  status: "completed" | "failed" | "timed_out";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  evidenceBundle: PrintingPressEvidenceBundle;
};

export type PrintingPressRegistry = {
  register(cli: PrintingPressCliDescriptor): PrintingPressCliDescriptor;
  list(): PrintingPressCliDescriptor[];
  select(input: PrintingPressSelection): PrintingPressCliDescriptor;
  toAgentDescriptor(cliId: string): AgentDescriptor;
  verify(input: { cliId: string }): PrintingPressVerification;
  run(input: PrintingPressRunInput): Promise<PrintingPressRunResult>;
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

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function commandLooksResolvable(command: string): boolean {
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }
  return command.trim().length > 0;
}

function buildCommand(cli: PrintingPressCliDescriptor, extraArgs: string[] = []): string {
  return [cli.command, ...(cli.args ?? []), ...extraArgs].join(" ");
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

    verify(input: { cliId: string }): PrintingPressVerification {
      const cli = getCli(input.cliId);
      const checks = [
        {
          name: "capabilities",
          passed: cli.capabilities.length > 0,
          message: "CLI declares at least one capability",
        },
        {
          name: "concurrency",
          passed: cli.maxConcurrentTasks > 0,
          message: "CLI maxConcurrentTasks is positive",
        },
        {
          name: "installation",
          passed: cli.installation !== "disabled",
          message: "CLI is not disabled",
        },
        {
          name: "command",
          passed: commandLooksResolvable(cli.command),
          message: "CLI command is resolvable or available on PATH",
        },
      ];
      return {
        cliId: cli.cliId,
        status: checks.every((check) => check.passed) ? "passed" : "failed",
        checks,
      };
    },

    run(input: PrintingPressRunInput): Promise<PrintingPressRunResult> {
      const cli = getCli(input.cliId);
      if (cli.installation === "disabled") {
        throw new Error("Cannot run disabled Printing Press CLI");
      }
      const args = [...(cli.args ?? []), ...(input.args ?? [])];
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const runId = `pprun:${sha256(`${cli.cliId}\n${buildCommand(cli, input.args)}\n${startedAt}`)}`;

      return new Promise((resolve) => {
        const child = spawn(cli.command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const timeoutMs = input.timeoutMs ?? 30_000;
        const timeout = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill();
          stderr += `Printing Press CLI timed out after ${timeoutMs}ms`;
          const completedAt = new Date().toISOString();
          const durationMs = Date.now() - startedMs;
          resolve({
            runId,
            cliId: cli.cliId,
            status: "timed_out",
            stdout,
            stderr,
            exitCode: null,
            durationMs,
            evidenceBundle: {
              hash: sha256(`${buildCommand(cli, input.args)}\n${stdout}\n${stderr}\ntimeout`),
              command: buildCommand(cli, input.args),
              stdoutHash: sha256(stdout),
              stderrHash: sha256(stderr),
              exitCode: null,
              startedAt,
              completedAt,
            },
          });
        }, timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        child.on("error", (error) => {
          stderr += error.message;
        });
        child.on("close", (code) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          const completedAt = new Date().toISOString();
          const durationMs = Date.now() - startedMs;
          const exitCode = code ?? null;
          resolve({
            runId,
            cliId: cli.cliId,
            status: exitCode === 0 ? "completed" : "failed",
            stdout,
            stderr,
            exitCode,
            durationMs,
            evidenceBundle: {
              hash: sha256(`${buildCommand(cli, input.args)}\n${stdout}\n${stderr}\n${exitCode}`),
              command: buildCommand(cli, input.args),
              stdoutHash: sha256(stdout),
              stderrHash: sha256(stderr),
              exitCode,
              startedAt,
              completedAt,
            },
          });
        });

        if (input.stdin) {
          child.stdin.write(input.stdin);
        }
        child.stdin.end();
      });
    },
  };
}
