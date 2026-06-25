import { createHash } from "node:crypto";

export type ConductorRisk = "low" | "medium" | "high";
export type ConductorComplexity = "low" | "medium" | "high";
export type ConductorRole = "planner" | "worker" | "verifier";
export type ConductorScaffoldId = "single-pass" | "plan-execute-verify" | "iterative-repair";

export type ConductorInput = {
  objective: string;
  risk: ConductorRisk;
  complexity: ConductorComplexity;
  requiredStrengths: string[];
  modelProfileIds: string[];
};

export type ConductorStep = {
  stepId: string;
  role: ConductorRole;
  objective: string;
  preferredProfileId?: string;
};

export type ConductorTrace = {
  traceId: string;
  input: ConductorInput;
  scaffoldId: ConductorScaffoldId;
  reasonCodes: string[];
};

export type ConductorPlan = {
  scaffoldId: ConductorScaffoldId;
  steps: ConductorStep[];
  trace: ConductorTrace;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cloneInput(input: ConductorInput): ConductorInput {
  return {
    objective: input.objective,
    risk: input.risk,
    complexity: input.complexity,
    requiredStrengths: [...input.requiredStrengths],
    modelProfileIds: [...input.modelProfileIds],
  };
}

function determineScaffoldId(input: ConductorInput): ConductorScaffoldId {
  if (input.risk === "high") {
    return "plan-execute-verify";
  }
  if (input.complexity === "high") {
    return "iterative-repair";
  }
  return "single-pass";
}

function buildSteps(input: ConductorInput, scaffoldId: ConductorScaffoldId): ConductorStep[] {
  const profiles = input.modelProfileIds.length > 0 ? [...input.modelProfileIds] : ["default"];
  if (scaffoldId === "single-pass") {
    return [
      {
        stepId: "worker-1",
        role: "worker",
        objective: input.objective,
        preferredProfileId: profiles[0],
      },
    ];
  }

  const plannerObjective =
    scaffoldId === "iterative-repair"
      ? `Plan an iterative repair strategy for ${input.objective}`
      : `Plan how to complete ${input.objective}`;
  const workerObjective =
    scaffoldId === "iterative-repair"
      ? `Implement the first repair pass for ${input.objective}`
      : `Execute the plan for ${input.objective}`;
  const verifierObjective =
    scaffoldId === "iterative-repair"
      ? `Verify the repair pass for ${input.objective}`
      : `Verify the outcome for ${input.objective}`;

  return [
    {
      stepId: "planner-1",
      role: "planner",
      objective: plannerObjective,
      preferredProfileId: profiles[0],
    },
    {
      stepId: "worker-1",
      role: "worker",
      objective: workerObjective,
      preferredProfileId: profiles[1] ?? profiles[0],
    },
    {
      stepId: "verifier-1",
      role: "verifier",
      objective: verifierObjective,
      preferredProfileId: profiles[2] ?? profiles[1] ?? profiles[0],
    },
  ];
}

function buildReasonCodes(input: ConductorInput, scaffoldId: ConductorScaffoldId): string[] {
  return [
    `risk:${input.risk}`,
    `complexity:${input.complexity}`,
    `scaffold:${scaffoldId}`,
  ];
}

function traceId(input: ConductorInput, scaffoldId: ConductorScaffoldId, steps: ConductorStep[]): string {
  return `conductor:sha256:${sha256(JSON.stringify({ input, scaffoldId, steps }))}`;
}

export function createConductorPlan(input: ConductorInput): ConductorPlan {
  const normalizedInput = cloneInput(input);
  const scaffoldId = determineScaffoldId(normalizedInput);
  const steps = buildSteps(normalizedInput, scaffoldId);
  const trace = {
    traceId: traceId(normalizedInput, scaffoldId, steps),
    input: cloneInput(normalizedInput),
    scaffoldId,
    reasonCodes: buildReasonCodes(normalizedInput, scaffoldId),
  };

  return {
    scaffoldId,
    steps,
    trace,
  };
}

export function replayConductorPlan(trace: ConductorTrace): ConductorPlan {
  return createConductorPlan(trace.input);
}
