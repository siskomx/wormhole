import type { OptimizedCommandInput, OptimizedCommandResult } from "./optimized-command-runner.js";
import { createOptimizedCommandRunner } from "./optimized-command-runner.js";
import type { ImpactAnalysisResult } from "./impact-analysis.js";
import type { ProjectContract, ProjectPackageManager, ProjectScript } from "./project-contract.js";
import { uniqueProjectLanes, type ProjectLane } from "./project-lanes.js";

export type VerificationCommand = OptimizedCommandInput & {
  name: string;
  reason?: string;
  tier?: VerificationTier;
  lanes?: ProjectLane[];
  source?: "contract" | "impact" | "fallback";
};

export type VerificationTier = "smoke" | "focused" | "standard" | "full";

export type VerificationPlan = {
  commands: VerificationCommand[];
  reasons: string[];
};

export type VerificationRunResult = {
  status: "passed" | "failed";
  results: Array<
    OptimizedCommandResult & {
      name: string;
      reason?: string;
      tier?: VerificationTier;
      lanes?: ProjectLane[];
      source?: "contract" | "impact" | "fallback";
    }
  >;
};

export function createVerificationPlan(input: {
  contract: Pick<ProjectContract, "repoRoot" | "packageManager" | "scripts">;
  impact?: Partial<ImpactAnalysisResult>;
  changedFiles?: string[];
  lanes?: ProjectLane[];
  tier?: VerificationTier;
}): VerificationPlan {
  const commands: VerificationCommand[] = [];
  const reasons: string[] = [];
  const testScript = findScript(input.contract.scripts, "test");
  const buildScript = findScript(input.contract.scripts, "build");
  const changedFiles = input.changedFiles ?? input.impact?.changedFiles ?? [];
  const lanes = input.lanes ?? uniqueProjectLanes(changedFiles);
  const effectiveLanes: ProjectLane[] = lanes.length > 0 ? lanes : ["runtime"];
  const tier = input.tier ?? (input.impact?.likelyTests && input.impact.likelyTests.length > 0 ? "focused" : "standard");

  if (tier === "smoke" && effectiveLanes.every((lane) => lane === "docs")) {
    return {
      commands,
      reasons: ["Docs-only changes do not require automated test commands at smoke tier."],
    };
  }

  if (testScript) {
    const focusedTests = input.impact?.likelyTests ?? [];
    commands.push(scriptCommand(input.contract.packageManager, testScript, {
      cwd: input.contract.repoRoot,
      extraArgs: focusedTests,
      tier: focusedTests.length > 0 ? "focused" : tier,
      lanes: effectiveLanes,
      source: focusedTests.length > 0 ? "impact" : "contract",
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
        tier: tier === "focused" ? "standard" : tier,
        lanes: effectiveLanes,
        source: "contract",
        reason: "Run build after tests to catch compiler and packaging regressions.",
      }),
    );
  }

  if (tier === "full" && effectiveLanes.includes("benchmarks")) {
    const benchmarkValidateScript = findScript(input.contract.scripts, "benchmarks:validate");
    if (benchmarkValidateScript) {
      commands.push(scriptCommand(input.contract.packageManager, benchmarkValidateScript, {
        cwd: input.contract.repoRoot,
        tier: "full",
        lanes: ["benchmarks"],
        source: "contract",
        reason: "Benchmark lane changed; validate benchmark fixtures and metadata.",
      }));
      reasons.push("Benchmark validation was selected because benchmark files changed.");
    }
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
  const results: VerificationRunResult["results"] = [];
  for (const command of input.commands) {
    const { name, reason, tier, lanes, source, ...commandInput } = command;
    const result = await runner.run(commandInput);
    results.push({ name, reason, tier, lanes, source, ...result });
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
  input: {
    cwd: string;
    reason: string;
    extraArgs?: string[];
    tier: VerificationTier;
    lanes: ProjectLane[];
    source: "contract" | "impact" | "fallback";
  },
): VerificationCommand {
  const extraArgs = input.extraArgs ?? [];
  const metadata = {
    tier: input.tier,
    lanes: input.lanes,
    source: input.source,
    reason: input.reason,
  };
  switch (packageManager) {
    case "pnpm":
      return {
        name: script.name,
        command: "pnpm",
        args: ["run", script.name, ...extraArgs],
        cwd: input.cwd,
        ...metadata,
      };
    case "yarn":
      return {
        name: script.name,
        command: "yarn",
        args: [script.name, ...extraArgs],
        cwd: input.cwd,
        ...metadata,
      };
    case "bun":
      return {
        name: script.name,
        command: "bun",
        args: ["run", script.name, ...extraArgs],
        cwd: input.cwd,
        ...metadata,
      };
    case "cargo":
      return {
        name: script.name,
        command: "cargo",
        args: [script.name, ...extraArgs],
        cwd: input.cwd,
        ...metadata,
      };
    case "dotnet":
      return {
        name: script.name,
        command: "dotnet",
        args: [script.name, ...extraArgs],
        cwd: input.cwd,
        ...metadata,
      };
    case "npm":
    case "unknown":
      return {
        name: script.name,
        command: "npm",
        args: extraArgs.length > 0 ? ["test", "--", ...extraArgs] : ["run", script.name],
        cwd: input.cwd,
        ...metadata,
      };
  }
}
