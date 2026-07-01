import { describe, expect, it } from "vitest";
import { createIndexHealthSnapshot } from "../src/index-health.js";
import { blockingGateSignalMessages, evaluateGateSignals } from "../src/gate-signals.js";
import type { ResumeValidationResult } from "../src/resume-store.js";

function resumeResult(overrides: Partial<ResumeValidationResult> = {}): ResumeValidationResult {
  return {
    repoRoot: "/repo",
    valid: true,
    missingCheckpoint: false,
    staleMaterialRecordIds: [],
    staleScratchRecordIds: [],
    unauditedRecordIds: [],
    unresolvedEvidenceIds: [],
    unresolvedContextPackIds: [],
    missingChangedFiles: [],
    repoFingerprintChanged: false,
    reasons: [],
    ...overrides,
  };
}

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

  it("blocks enforced gates when target language coverage is missing even if the index ran", () => {
    const indexHealth = createIndexHealthSnapshot({
      source: "repo_index",
      present: true,
      fresh: true,
      languageCoverage: [
        {
          language: "rust",
          displayName: "Rust",
          supportLevel: "supported",
          totalFileCount: 34,
          indexedFileCount: 0,
          coverage: 0,
          status: "blocker",
          reasons: ["Language coverage missing for Rust: 34 files detected, 0 indexed."],
        },
      ],
    });

    expect(indexHealth.status).toBe("degraded");
    expect(evaluateGateSignals({ freshness: { indexHealth } })[0]).toEqual(
      expect.objectContaining({
        ruleId: "index-health:language-coverage",
        severity: "warn",
      }),
    );
    expect(evaluateGateSignals({ freshness: { indexHealth }, enforce: true })[0]).toEqual(
      expect.objectContaining({
        ruleId: "index-health:language-coverage",
        severity: "block",
      }),
    );
    expect(blockingGateSignalMessages({ freshness: { indexHealth } })).toContain(
      "Language coverage missing for Rust: 34 files detected, 0 indexed.",
    );
  });

  it("blocks gates when runtime behavior or loop health is blocking", () => {
    const runtimeFindings = evaluateGateSignals({
      runtimeBehavior: {
        summary: {
          status: "blocker",
          uncoveredRequiredToolCount: 1,
          orderingViolationCount: 1,
        },
        blockingReasons: ["Required tool was not observed: verification_run."],
      },
      enforce: true,
    });
    const loopFindings = evaluateGateSignals({
      loopHealth: {
        status: "blocked",
        blockers: [
          {
            code: "RUNTIME_AUDIT_BLOCKER",
            message: "Runtime behavior audit is blocking.",
          },
        ],
      },
      enforce: true,
    });

    expect(runtimeFindings).toContainEqual(
      expect.objectContaining({
        ruleId: "runtime-behavior:blocker",
        severity: "block",
      }),
    );
    expect(blockingGateSignalMessages({ runtimeBehavior: { summary: { status: "blocker" } } })).toContain(
      "Runtime behavior audit is blocking.",
    );
    expect(loopFindings).toContainEqual(
      expect.objectContaining({
        ruleId: "agent-loop-health:blocked",
        severity: "block",
      }),
    );
  });

  it("blocks enforced gates on high-risk stale claim checks", () => {
    const findings = evaluateGateSignals({
      claimChecks: {
        claims: [
          {
            claimId: "claim-1",
            kind: "impact_tests_found",
            subject: "src/kernel.ts",
            predicate: "has_impacted_tests",
            claimText: "src/kernel.ts has impacted tests.",
            status: "stale",
            evidenceIds: ["E1"],
            evidenceAnchors: [],
            invalidationKeys: [{ kind: "file", value: "src/kernel.ts" }],
            producer: { toolName: "change_impact_analyze" },
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
        enforce: true,
      },
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: "claim-ledger:stale",
        severity: "block",
        message: expect.stringContaining("claim-1"),
      }),
    );
  });
});

describe("gate resume signals", () => {
  it("warns on integrity failures and does not block without resume.enforce, even when globally enforced", () => {
    const validation = resumeResult({ valid: false, repoFingerprintChanged: true });
    expect(evaluateGateSignals({ resume: { validation } })[0]).toEqual(
      expect.objectContaining({ ruleId: "resume:repo-fingerprint-changed", severity: "warn" }),
    );
    // global enforce must NOT promote resume findings — only resume.enforce does
    expect(evaluateGateSignals({ resume: { validation }, enforce: true })[0]).toEqual(
      expect.objectContaining({ ruleId: "resume:repo-fingerprint-changed", severity: "warn" }),
    );
    expect(blockingGateSignalMessages({ resume: { validation } })).toEqual([]);
  });

  it("blocks integrity failures and missing checkpoint when resume.enforce is set", () => {
    const validation = resumeResult({
      valid: false,
      repoFingerprintChanged: true,
      missingCheckpoint: true,
      staleMaterialRecordIds: ["r1"],
      missingChangedFiles: ["src/x.ts"],
      unresolvedEvidenceIds: ["e1"],
      unresolvedContextPackIds: ["c1"],
    });
    const findings = evaluateGateSignals({ resume: { validation, enforce: true } });
    const blocked = findings.filter((f) => f.severity === "block").map((f) => f.ruleId).sort();
    expect(blocked).toEqual(
      [
        "resume:missing-changed-files",
        "resume:missing-checkpoint",
        "resume:repo-fingerprint-changed",
        "resume:stale-material-records",
        "resume:unresolved-context-packs",
        "resume:unresolved-evidence",
      ].sort(),
    );
  });

  it("keeps unaudited records as warn even when resume.enforce is set", () => {
    const validation = resumeResult({ valid: false, unauditedRecordIds: ["r1"] });
    expect(evaluateGateSignals({ resume: { validation, enforce: true } })).toEqual([
      expect.objectContaining({ ruleId: "resume:unaudited-records", severity: "warn" }),
    ]);
  });

  it("emits nothing for a valid resume result", () => {
    expect(evaluateGateSignals({ resume: { validation: resumeResult(), enforce: true } })).toEqual([]);
  });
});
