import { describe, expect, it } from "vitest";
import { runModelPool } from "../src/model-pool.js";

describe("bounded model-pool orchestration", () => {
  it("runs thinker, worker, and verifier roles within a budget", async () => {
    const result = await runModelPool({
      objective: "Plan a repo migration",
      mode: "deep",
      turnBudget: 4,
      providers: {
        thinker: async (input) => `Think through ${input.objective}`,
        worker: async (input) => `Draft steps from ${input.thought}`,
        verifier: async (input) => `Verified ${input.work}`,
      },
    });

    expect(result.status).toBe("verified");
    expect(result.turnsUsed).toBe(3);
    expect(result.trace.map((entry) => entry.role)).toEqual(["thinker", "worker", "verifier"]);
    expect(result.output).toContain("Verified");
  });
});
