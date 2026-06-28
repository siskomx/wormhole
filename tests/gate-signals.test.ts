import { describe, expect, it } from "vitest";
import { createIndexHealthSnapshot } from "../src/index-health.js";
import { blockingGateSignalMessages, evaluateGateSignals } from "../src/gate-signals.js";

describe("gate index health signals", () => {
  it("warns on degraded index health without blocking even when enforced", () => {
    const indexHealth = createIndexHealthSnapshot({
      source: "repo_index",
      present: true,
      fresh: true,
      truncated: true,
      skippedFiles: ["src/missing.ts"],
    });

    expect(evaluateGateSignals({ freshness: { indexHealth } })).toEqual([
      expect.objectContaining({
        ruleId: "index-health:degraded",
        severity: "warn",
      }),
    ]);
    expect(evaluateGateSignals({ freshness: { indexHealth }, enforce: true })).toEqual([
      expect.objectContaining({
        ruleId: "index-health:degraded",
        severity: "warn",
      }),
    ]);
    expect(blockingGateSignalMessages({ freshness: { indexHealth } })).toEqual([]);
  });

  it("blocks stale and missing index health only when gate signals are enforced", () => {
    const stale = createIndexHealthSnapshot({
      source: "durable_repo_index",
      present: true,
      fresh: false,
    });
    const missing = createIndexHealthSnapshot({
      source: "durable_repo_index",
      present: false,
    });

    expect(evaluateGateSignals({ freshness: { indexHealth: stale } })[0]).toEqual(
      expect.objectContaining({
        ruleId: "index-health:stale",
        severity: "warn",
      }),
    );
    expect(evaluateGateSignals({ freshness: { indexHealth: stale }, enforce: true })[0]).toEqual(
      expect.objectContaining({
        ruleId: "index-health:stale",
        severity: "block",
      }),
    );
    expect(evaluateGateSignals({ freshness: { indexHealth: missing }, enforce: true })[0]).toEqual(
      expect.objectContaining({
        ruleId: "index-health:missing",
        severity: "block",
      }),
    );
  });

  it("keeps healthy and legacy freshness inputs backward compatible", () => {
    const fresh = createIndexHealthSnapshot({
      source: "repo_index",
      present: true,
      fresh: true,
      truncated: false,
    });

    expect(evaluateGateSignals({ freshness: { indexHealth: fresh }, enforce: true })).toEqual([]);
    expect(
      evaluateGateSignals({
        freshness: {
          durableIndex: {
            repoIndex: {
              fresh: false,
            },
          },
        },
        enforce: true,
      }),
    ).toContainEqual(
      expect.objectContaining({
        ruleId: "freshness:durable-index-stale",
        severity: "block",
      }),
    );
  });
});
