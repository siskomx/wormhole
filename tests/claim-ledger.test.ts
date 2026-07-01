import { describe, expect, it } from "vitest";
import {
  createClaimLedgerStore,
  evaluateClaimGate,
  type ClaimRecord,
} from "../src/claim-ledger.js";

describe("claim ledger", () => {
  it("records deterministic claims with evidence and invalidation keys", () => {
    const ledger = createClaimLedgerStore();

    const claim = ledger.record({
      kind: "verification_passed",
      subject: "npm test",
      predicate: "passed",
      object: "test suite",
      claimText: "npm test passed for this change.",
      producer: { toolName: "verification_run" },
      evidenceIds: ["E1"],
      invalidationKeys: [{ kind: "file", value: "src/kernel.ts" }],
    });

    expect(claim.claimId).toBe("claim-1");
    expect(claim.status).toBe("supported");
    expect(claim.evidenceIds).toEqual(["E1"]);
    expect(claim.invalidationKeys).toEqual([{ kind: "file", value: "src/kernel.ts" }]);
    expect(ledger.query({ status: "supported" }).claims.map((record) => record.claimId)).toEqual(["claim-1"]);
  });

  it("marks file-dependent claims stale when changed files match invalidation keys", () => {
    const ledger = createClaimLedgerStore();
    ledger.record({
      kind: "relation_path_exists",
      subject: "src/a.ts",
      predicate: "impacts",
      object: "src/b.ts",
      claimText: "src/a.ts impacts src/b.ts.",
      producer: { toolName: "repo_relation_query" },
      evidenceIds: ["E1"],
      invalidationKeys: [{ kind: "file", value: "src/a.ts" }],
    });
    ledger.record({
      kind: "symbol_exists",
      subject: "src/c.ts#run",
      predicate: "exists",
      claimText: "run exists in src/c.ts.",
      producer: { toolName: "repo_intelligence_search" },
      evidenceIds: ["E2"],
      invalidationKeys: [{ kind: "file", value: "src/c.ts" }],
    });

    const invalidated = ledger.invalidate({
      changedFiles: ["src/a.ts"],
      reason: "change_impact_analyze reported src/a.ts changed.",
    });

    expect(invalidated.invalidatedClaimIds).toEqual(["claim-1"]);
    expect(ledger.query({ status: "stale" }).claims).toEqual([
      expect.objectContaining({
        claimId: "claim-1",
        staleReason: "change_impact_analyze reported src/a.ts changed.",
      }),
    ]);
    expect(ledger.query({ status: "supported" }).claims.map((claim) => claim.claimId)).toEqual(["claim-2"]);
  });

  it("verifies unproven claims by attaching evidence and clearing unsupported state", () => {
    const ledger = createClaimLedgerStore();
    const claim = ledger.record({
      kind: "file_exists",
      subject: "src/kernel.ts",
      predicate: "exists",
      claimText: "src/kernel.ts exists.",
      producer: { toolName: "repo_intelligence_search" },
    });

    const unsupported = ledger.verify({
      claimId: claim.claimId,
      status: "unsupported",
      reason: "No current source evidence was attached.",
    });
    const supported = ledger.verify({
      claimId: claim.claimId,
      evidenceIds: ["E1"],
    });

    expect(unsupported).toEqual(
      expect.objectContaining({
        status: "unsupported",
        unsupportedReason: "No current source evidence was attached.",
      }),
    );
    expect(supported).toEqual(
      expect.objectContaining({
        status: "supported",
        evidenceIds: ["E1"],
      }),
    );
    expect(supported.unsupportedReason).toBeUndefined();
  });

  it("reports high-risk stale and unsupported claims to the gate", () => {
    const claims: ClaimRecord[] = [
      {
        claimId: "claim-1",
        kind: "verification_passed",
        subject: "npm test",
        predicate: "passed",
        claimText: "npm test passed.",
        status: "stale",
        evidenceIds: ["E1"],
        evidenceAnchors: [],
        invalidationKeys: [{ kind: "file", value: "src/kernel.ts" }],
        producer: { toolName: "verification_run" },
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        claimId: "claim-2",
        kind: "file_exists",
        subject: "README.md",
        predicate: "exists",
        claimText: "README exists.",
        status: "unverified",
        evidenceIds: [],
        evidenceAnchors: [],
        invalidationKeys: [],
        producer: { toolName: "repo_intelligence_search" },
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ];

    expect(evaluateClaimGate({ claims, enforce: true })).toEqual([
      expect.objectContaining({
        ruleId: "claim-ledger:stale",
        severity: "block",
        claimId: "claim-1",
      }),
      expect.objectContaining({
        ruleId: "claim-ledger:unverified",
        severity: "warn",
        claimId: "claim-2",
      }),
    ]);
  });
});
