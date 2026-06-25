import { describe, expect, it } from "vitest";
import { createBehaviorPolicyStore } from "../src/behavior-policy.js";

describe("behavior policy store", () => {
  it("persists brevity and minimality modes in memory", () => {
    const store = createBehaviorPolicyStore();

    expect(store.getMode()).toEqual({ brevity: "normal", minimality: "review" });
    expect(store.setMode({ brevity: "dense", minimality: "strict" })).toEqual({
      brevity: "dense",
      minimality: "strict",
    });
    expect(store.getMode()).toEqual({ brevity: "dense", minimality: "strict" });
  });

  it("applies dense mode while preserving backtick literals from the original text", () => {
    const store = createBehaviorPolicyStore();
    store.setMode({ brevity: "dense", minimality: "review" });

    const result = store.apply({
      text: "Run `npm test` before commit. This sentence is extra explanation. Keep path `src/tools.ts`.",
    });

    expect(result.text).toContain("`npm test`");
    expect(result.text).toContain("`src/tools.ts`");
    expect(result.estimatedTokensSaved).toBeGreaterThanOrEqual(0);
  });

  it("delegates minimality review and returns text plus findings", () => {
    const store = createBehaviorPolicyStore();

    const result = store.reviewMinimality({
      objective: "Add a small report",
      planSteps: ["Create a distributed event bus", "Deploy kubernetes"],
    });

    expect(result.text).toContain("Prefer the smallest change");
    expect(result.findings.map((finding) => finding.phrase)).toEqual([
      "kubernetes",
      "distributed event bus",
      "event bus",
    ]);
  });
});
