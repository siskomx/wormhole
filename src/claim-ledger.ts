import type { SourceAuthority } from "./source-authority.js";

export const CLAIM_KINDS = [
  "file_exists",
  "symbol_exists",
  "relation_path_exists",
  "script_exists",
  "dependency_exists",
  "table_exists",
  "verification_passed",
  "impact_tests_found",
  "generated_artifact_fresh",
  "deletion_safety",
  "change_safe",
] as const;

export type ClaimKind = (typeof CLAIM_KINDS)[number];
export type ClaimStatus = "supported" | "unsupported" | "stale" | "conflicted" | "unverified";

export type ClaimEvidenceAnchor = {
  evidenceId?: string;
  sourcePath?: string;
  lineStart?: number;
  lineEnd?: number;
  repoFactId?: string;
  toolName?: string;
  sourceHash?: string;
};

export type ClaimInvalidationKey = {
  kind: "file" | "repo_fingerprint" | "repo_fact" | "symbol" | "verification";
  value: string;
};

export type ClaimProducer = {
  toolName: string;
  missionId?: string;
  artifactId?: string;
  runId?: string;
  agentId?: string;
};

export type ClaimRecordInput = {
  kind: ClaimKind;
  subject: string;
  predicate: string;
  object?: string;
  claimText: string;
  producer: ClaimProducer;
  evidenceIds?: string[];
  evidenceAnchors?: ClaimEvidenceAnchor[];
  invalidationKeys?: ClaimInvalidationKey[];
  status?: ClaimStatus;
  sourceAuthority?: SourceAuthority;
  repoFingerprint?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

export type ClaimRecord = Required<
  Pick<
    ClaimRecordInput,
    "kind" | "subject" | "predicate" | "claimText" | "producer" | "evidenceIds" | "evidenceAnchors" | "invalidationKeys"
  >
> &
  Pick<ClaimRecordInput, "object" | "sourceAuthority" | "repoFingerprint" | "confidence" | "metadata"> & {
    claimId: string;
    status: ClaimStatus;
    createdAt: string;
    updatedAt: string;
    staleReason?: string;
    unsupportedReason?: string;
    conflictedReason?: string;
  };

export type ClaimLedgerSnapshot = {
  claims: ClaimRecord[];
};

export type ClaimQueryInput = {
  claimIds?: string[];
  status?: ClaimStatus;
  kind?: ClaimKind;
  subject?: string;
  producerToolName?: string;
  limit?: number;
};

export type ClaimQueryResult = {
  count: number;
  claims: ClaimRecord[];
};

export type ClaimInvalidationInput = {
  changedFiles?: string[];
  invalidationKeys?: ClaimInvalidationKey[];
  reason?: string;
};

export type ClaimInvalidationResult = {
  invalidatedClaimIds: string[];
  staleClaims: ClaimRecord[];
};

export type ClaimVerificationInput = {
  claimId: string;
  status?: ClaimStatus;
  evidenceIds?: string[];
  reason?: string;
};

export type ClaimGateInput = {
  claims?: ClaimRecord[];
  enforce?: boolean;
};

export type ClaimGateFinding = {
  ruleId: `claim-ledger:${ClaimStatus}`;
  severity: "warn" | "block";
  message: string;
  claimId: string;
  status: ClaimStatus;
  kind: ClaimKind;
};

export type ClaimLedgerStore = ReturnType<typeof createClaimLedgerStore>;

const HIGH_RISK_CLAIM_KINDS = new Set<ClaimKind>([
  "verification_passed",
  "impact_tests_found",
  "generated_artifact_fresh",
  "deletion_safety",
  "change_safe",
]);

export function createClaimLedgerStore(
  initial: Partial<ClaimLedgerSnapshot> = {},
  onChange?: (snapshot: ClaimLedgerSnapshot) => void,
) {
  const claims = new Map<string, ClaimRecord>();
  for (const claim of initial.claims ?? []) {
    claims.set(claim.claimId, cloneClaim(claim));
  }

  function snapshot(): ClaimLedgerSnapshot {
    return {
      claims: [...claims.values()].map(cloneClaim),
    };
  }

  function persist(): void {
    onChange?.(snapshot());
  }

  function record(input: ClaimRecordInput): ClaimRecord {
    const now = new Date().toISOString();
    const claim: ClaimRecord = {
      claimId: nextClaimId(claims),
      kind: input.kind,
      subject: input.subject,
      predicate: input.predicate,
      ...(input.object ? { object: input.object } : {}),
      claimText: input.claimText,
      producer: { ...input.producer },
      evidenceIds: uniqueSorted(input.evidenceIds ?? []),
      evidenceAnchors: (input.evidenceAnchors ?? []).map((anchor) => ({ ...anchor })),
      invalidationKeys: normalizeInvalidationKeys(input.invalidationKeys ?? []),
      status: input.status ?? defaultStatus(input),
      ...(input.sourceAuthority ? { sourceAuthority: input.sourceAuthority } : {}),
      ...(input.repoFingerprint ? { repoFingerprint: input.repoFingerprint } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.metadata ? { metadata: cloneJson(input.metadata) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    claims.set(claim.claimId, cloneClaim(claim));
    persist();
    return cloneClaim(claim);
  }

  function get(claimId: string): ClaimRecord {
    const claim = claims.get(claimId);
    if (!claim) {
      throw new Error(`Claim not found: ${claimId}`);
    }
    return cloneClaim(claim);
  }

  function query(input: ClaimQueryInput = {}): ClaimQueryResult {
    const claimIds = input.claimIds ? new Set(input.claimIds) : undefined;
    const filtered = [...claims.values()]
      .filter((claim) => !claimIds || claimIds.has(claim.claimId))
      .filter((claim) => !input.status || claim.status === input.status)
      .filter((claim) => !input.kind || claim.kind === input.kind)
      .filter((claim) => !input.subject || claim.subject === input.subject)
      .filter((claim) => !input.producerToolName || claim.producer.toolName === input.producerToolName)
      .sort((left, right) => left.claimId.localeCompare(right.claimId));
    const limited = filtered.slice(0, input.limit ?? filtered.length);
    return {
      count: filtered.length,
      claims: limited.map(cloneClaim),
    };
  }

  function verify(input: ClaimVerificationInput): ClaimRecord {
    const claim = claims.get(input.claimId);
    if (!claim) {
      throw new Error(`Claim not found: ${input.claimId}`);
    }
    const evidenceIds = uniqueSorted([...(claim.evidenceIds ?? []), ...(input.evidenceIds ?? [])]);
    const status = input.status ?? (evidenceIds.length > 0 || claim.evidenceAnchors.length > 0 ? "supported" : "unsupported");
    const { staleReason: _staleReason, unsupportedReason: _unsupportedReason, conflictedReason: _conflictedReason, ...baseClaim } = claim;
    const updated: ClaimRecord = {
      ...baseClaim,
      evidenceIds,
      status,
      updatedAt: new Date().toISOString(),
      ...(status === "unsupported" && input.reason ? { unsupportedReason: input.reason } : {}),
      ...(status === "conflicted" && input.reason ? { conflictedReason: input.reason } : {}),
      ...(status === "stale" && input.reason ? { staleReason: input.reason } : {}),
    };
    claims.set(updated.claimId, cloneClaim(updated));
    persist();
    return cloneClaim(updated);
  }

  function invalidate(input: ClaimInvalidationInput): ClaimInvalidationResult {
    const keys = new Set([
      ...(input.changedFiles ?? []).map((file) => keyString({ kind: "file", value: file })),
      ...(input.invalidationKeys ?? []).map(keyString),
    ]);
    const reason = input.reason ?? "Supporting claim evidence changed.";
    const staleClaims: ClaimRecord[] = [];
    for (const claim of claims.values()) {
      if (claim.status === "stale") {
        continue;
      }
      const match = claim.invalidationKeys.some((key) => keys.has(keyString(key)));
      if (!match) {
        continue;
      }
      const stale: ClaimRecord = {
        ...claim,
        status: "stale",
        staleReason: reason,
        updatedAt: new Date().toISOString(),
      };
      claims.set(stale.claimId, cloneClaim(stale));
      staleClaims.push(cloneClaim(stale));
    }
    if (staleClaims.length > 0) {
      persist();
    }
    return {
      invalidatedClaimIds: staleClaims.map((claim) => claim.claimId),
      staleClaims,
    };
  }

  return {
    record,
    get,
    query,
    verify,
    invalidate,
    snapshot,
  };
}

export function evaluateClaimGate(input: ClaimGateInput): ClaimGateFinding[] {
  const enforce = input.enforce ?? false;
  const findings: ClaimGateFinding[] = [];
  for (const claim of input.claims ?? []) {
    if (claim.status === "supported") {
      continue;
    }
    const highRisk = HIGH_RISK_CLAIM_KINDS.has(claim.kind);
    const severity: ClaimGateFinding["severity"] =
      claim.status === "unverified" ? "warn" : enforce && highRisk ? "block" : "warn";
    findings.push({
      ruleId: `claim-ledger:${claim.status}`,
      severity,
      claimId: claim.claimId,
      status: claim.status,
      kind: claim.kind,
      message: `Claim ${claim.claimId} is ${claim.status}: ${claim.claimText}`,
    });
  }
  return findings;
}

function defaultStatus(input: ClaimRecordInput): ClaimStatus {
  if ((input.evidenceIds?.length ?? 0) > 0 || (input.evidenceAnchors?.length ?? 0) > 0) {
    return "supported";
  }
  return "unverified";
}

function nextClaimId(claims: Map<string, ClaimRecord>): string {
  let max = 0;
  for (const claimId of claims.keys()) {
    const match = /^claim-(\d+)$/.exec(claimId);
    if (match?.[1]) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `claim-${max + 1}`;
}

function normalizeInvalidationKeys(keys: ClaimInvalidationKey[]): ClaimInvalidationKey[] {
  const unique = new Map<string, ClaimInvalidationKey>();
  for (const key of keys) {
    const normalized: ClaimInvalidationKey = {
      kind: key.kind,
      value: normalizeKeyValue(key.kind, key.value),
    };
    unique.set(keyString(normalized), normalized);
  }
  return [...unique.values()].sort((left, right) => keyString(left).localeCompare(keyString(right)));
}

function keyString(key: ClaimInvalidationKey): string {
  return `${key.kind}:${normalizeKeyValue(key.kind, key.value)}`;
}

function normalizeKeyValue(kind: ClaimInvalidationKey["kind"], value: string): string {
  const trimmed = value.trim();
  if (kind === "file") {
    return trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  }
  return trimmed;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function cloneClaim(claim: ClaimRecord): ClaimRecord {
  return cloneJson(claim);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
