export type ModelPoolMode = "fast" | "balanced" | "deep";

export type ModelPoolProviders = {
  thinker: (input: { objective: string }) => Promise<string>;
  worker: (input: { objective: string; thought: string }) => Promise<string>;
  verifier: (input: { objective: string; thought: string; work: string }) => Promise<string>;
};

export type ModelPoolTraceEntry = {
  role: "thinker" | "worker" | "verifier";
  output: string;
};

export type ModelPoolResult = {
  status: "verified" | "partial";
  mode: ModelPoolMode;
  turnsUsed: number;
  output: string;
  trace: ModelPoolTraceEntry[];
};

export async function runModelPool(input: {
  objective: string;
  mode: ModelPoolMode;
  turnBudget: number;
  providers: ModelPoolProviders;
}): Promise<ModelPoolResult> {
  const trace: ModelPoolTraceEntry[] = [];
  if (input.turnBudget < 1) {
    return {
      status: "partial",
      mode: input.mode,
      turnsUsed: 0,
      output: "No model-pool turns available.",
      trace,
    };
  }

  const thought = await input.providers.thinker({ objective: input.objective });
  trace.push({ role: "thinker", output: thought });
  if (input.turnBudget < 2) {
    return { status: "partial", mode: input.mode, turnsUsed: 1, output: thought, trace };
  }

  const work = await input.providers.worker({ objective: input.objective, thought });
  trace.push({ role: "worker", output: work });
  if (input.turnBudget < 3) {
    return { status: "partial", mode: input.mode, turnsUsed: 2, output: work, trace };
  }

  const verification = await input.providers.verifier({
    objective: input.objective,
    thought,
    work,
  });
  trace.push({ role: "verifier", output: verification });
  return {
    status: "verified",
    mode: input.mode,
    turnsUsed: 3,
    output: verification,
    trace,
  };
}
