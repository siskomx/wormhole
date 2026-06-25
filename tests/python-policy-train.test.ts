import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PythonCommand = {
  command: string;
  args?: string[];
};

function findPython(): PythonCommand | undefined {
  const candidates: PythonCommand[] =
    process.platform === "win32"
      ? [{ command: "python" }, { command: "py", args: ["-3"] }]
      : [{ command: "python3" }, { command: "python" }];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...(candidate.args ?? []), "--version"], {
      encoding: "utf8",
      shell: false,
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  return undefined;
}

function requirePython(): PythonCommand {
  const python = findPython();
  expect(python, "Python is required for the Wormhole runtime").toBeDefined();
  return python as PythonCommand;
}

function runPolicyScript(script: string, payload: unknown): unknown {
  const python = requirePython();

  const repoRoot = process.cwd();
  const pythonPath = path.join(repoRoot, "python");
  const result = spawnSync(
    python.command,
    [...(python.args ?? []), "-c", script, JSON.stringify(payload)],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${pythonPath}${path.delimiter}${process.env.PYTHONPATH}`
          : pythonPath,
      },
    },
  );

  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const traceJsonl = [
  {
    traceId: "t1",
    taskKind: "feature",
    graphNodeCount: 120,
    evidenceCount: 4,
    openQuestions: 0,
    action: {
      workerCount: 2,
      verifierCount: 1,
      maxDepth: 3,
      modelProfile: "balanced",
      splitStrategy: "parallel",
      contextBudget: "large",
      evidenceMode: "strict",
      stopRule: "verify",
    },
    outcome: {
      testsPassed: true,
      evidenceCount: 4,
      openQuestions: 0,
      durationMs: 10_000,
      tokenEstimate: 8_000,
      userCorrectionCount: 0,
    },
  },
  {
    traceId: "t2",
    taskKind: "feature",
    graphNodeCount: 150,
    evidenceCount: 5,
    openQuestions: 0,
    action: {
      workerCount: 2,
      verifierCount: 1,
      maxDepth: 3,
      modelProfile: "balanced",
      splitStrategy: "parallel",
      contextBudget: "large",
      evidenceMode: "strict",
      stopRule: "verify",
    },
    outcome: {
      testsPassed: true,
      evidenceCount: 5,
      openQuestions: 0,
      durationMs: 12_000,
      tokenEstimate: 9_000,
      userCorrectionCount: 0,
    },
  },
]
  .map((row) => JSON.stringify(row))
  .join("\n");

describe("Python policy trainer", () => {
  it("trains a deterministic Q-table from JSONL traces", () => {
    const script = [
      "import json, sys",
      "from wormhole_sidecar.policy_train import train_policy",
      "print(json.dumps(train_policy(json.loads(sys.argv[1])), sort_keys=True))",
    ].join("\n");
    const payload = { traceJsonl, learningRate: 0.4, discount: 0, epochs: 4 };

    const first = runPolicyScript(script, payload);
    const second = runPolicyScript(script, payload);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      trainingSamples: 2,
      warnings: [],
    });
    expect((first as { policyId: string }).policyId).toMatch(/^policy:[a-f0-9]{16}$/);
    expect(Object.keys((first as { qTable: Record<string, unknown> }).qTable)).toEqual([
      "feature|graph:medium|evidence:medium|risk:low",
    ]);
    expect(
      Object.keys(
        (first as { qTable: Record<string, Record<string, number>> }).qTable[
          "feature|graph:medium|evidence:medium|risk:low"
        ],
      ),
    ).toEqual([
      "workers=2|verifiers=1|depth=3|model=balanced|split=parallel|context=large|evidence=strict|stop=verify",
    ]);
  });

  it("evaluates replay pass rate and reports unsafe candidate actions", () => {
    const script = [
      "import json, sys",
      "from wormhole_sidecar.policy_train import evaluate_policy",
      "print(json.dumps(evaluate_policy(json.loads(sys.argv[1])), sort_keys=True))",
    ].join("\n");
    const result = runPolicyScript(script, {
      traceJsonl,
      policy: {
        policyId: "unsafe",
        qTable: {
          "feature|graph:medium|evidence:medium|risk:low": {
            "workers=99|verifiers=5|depth=9|model=risky|split=single|context=medium|evidence=standard|stop=verify": 1,
          },
        },
      },
    });

    expect(result).toMatchObject({
      replayPassRate: 0,
      trainingSamples: 2,
    });
    expect((result as { safetyViolations: string[] }).safetyViolations).toEqual([
      "workers=99|verifiers=5|depth=9|model=risky|split=single|context=medium|evidence=standard|stop=verify",
    ]);
  });

  it("compares policies with deterministic baselines in the sidecar", () => {
    const script = [
      "import json, sys",
      "from wormhole_sidecar.policy_train import compare_policy_baselines",
      "print(json.dumps(compare_policy_baselines(json.loads(sys.argv[1])), sort_keys=True))",
    ].join("\n");
    const result = runPolicyScript(script, {
      traceJsonl,
      policy: {
        policyId: "candidate",
        qTable: {
          "feature|graph:medium|evidence:medium|risk:low": {
            "workers=2|verifiers=1|depth=3|model=balanced|split=parallel|context=large|evidence=strict|stop=verify": 1,
          },
        },
      },
    });

    expect((result as { candidate: { replayPassRate: number } }).candidate.replayPassRate).toBe(1);
    expect((result as { baselines: Array<{ policyId: string }> }).baselines.map((baseline) => baseline.policyId)).toEqual([
      "baseline:single-balanced",
      "baseline:parallel-verify",
      "baseline:strict-deep",
    ]);
    expect((result as { best: { policyId: string } }).best.policyId).toBe("candidate");
  });
});
