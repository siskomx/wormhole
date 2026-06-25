import type { OptimizedCommandInput, OptimizedCommandResult } from "./optimized-command-runner.js";
import { createOptimizedCommandRunner } from "./optimized-command-runner.js";
import type { ImpactAnalysisResult } from "./impact-analysis.js";
import type { ProjectContract, ProjectPackageManager, ProjectScript } from "./project-contract.js";

export type VerificationCommand = OptimizedCommandInput & {
  name: string;
  reason?: string;
};

export type VerificationPlan = {
  commands: VerificationCommand[];
  reasons: string[];
};

export type VerificationRunResult = {
  status: "passed" | "failed";
  results: Array<OptimizedCommandResult & { name: string; reason?: string }>;
};

export function createVerificationPlan(input: {
  contract: Pick<ProjectContract, "repoRoot" | "packageManager" | "scripts">;
  impact?: Partial<ImpactAnalysisResult>;
}): VerificationPlan {
  const commands: VerificationCommand[] = [];
  const reasons: string[] = [];
  const testScript = findScript(input.contract.scripts, "test");
  const buildScript = findScript(input.contract.scripts, "build");

  if (testScript) {
    const focusedTests = input.impact?.likelyTests ?? [];
    commands.push(scriptCommand(input.contract.packageManager, testScript, {
      cwd: input.contract.repoRoot,
      extraArgs: focusedTests,
      reason:
        focusedTests.length > 0
          ? "Run likely impacted tests first."
          : "Run the project test script.",
    }));
    if (focusedTests.length > 0) {
      reasons.push("Focused tests were selected from impacted files.");
    }
  }

  if (buildScript) {
    commands.push(
      scriptCommand(input.contract.packageManager, buildScript, {
        cwd: input.contract.repoRoot,
        reason: "Run build after tests to catch compiler and packaging regressions.",
      }),
    );
  }

  if (commands.length === 0) {
    reasons.push("No test or build scripts were found in the project contract.");
  }

  return { commands, reasons };
}

export async function runVerificationPlan(input: {
  commands: VerificationCommand[];
}): Promise<VerificationRunResult> {
  const runner = createOptimizedCommandRunner();
  const results: Array<OptimizedCommandResult & { name: string; reason?: string }> = [];
  for (const command of input.commands) {
    const { name, reason, ...commandInput } = command;
    const result = await runner.run(commandInput);
    results.push({ name, reason, ...result });
  }
  return {
    status: results.every((result) => result.status === "completed" && result.exitCode === 0)
      ? "passed"
      : "failed",
    results,
  };
}

function findScript(scripts: ProjectScript[], name: string): ProjectScript | undefined {
  return scripts.find((script) => script.name === name);
}

function scriptCommand(
  packageManager: ProjectPackageManager,
  script: ProjectScript,
  input: { cwd: string; reason: string; extraArgs?: string[] },
): VerificationCommand {
  const extraArgs = input.extraArgs ?? [];
  switch (packageManager) {
    case "pnpm":
      return {
        name: script.name,
        command: "pnpm",
        args: ["run", script.name, ...extraArgs],
        cwd: input.cwd,
        reason: input.reason,
      };
    case "yarn":
      return {
        name: script.name,
        command: "yarn",
        args: [script.name, ...extraArgs],
        cwd: input.cwd,
        reason: input.reason,
      };
    case "bun":
      return {
        name: script.name,
        command: "bun",
        args: ["run", script.name, ...extraArgs],
        cwd: input.cwd,
        reason: input.reason,
      };
    case "npm":
    case "unknown":
      return {
        name: script.name,
        command: "npm",
        args: extraArgs.length > 0 ? ["test", "--", ...extraArgs] : ["run", script.name],
        cwd: input.cwd,
        reason: input.reason,
      };
  }
}
