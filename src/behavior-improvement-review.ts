import { createHash } from "node:crypto";

export const BEHAVIOR_IMPROVEMENT_REVIEW_VERSION = "behavior-improvement-review.v1";
export const MIN_TRACE_COUNT = 5;
export const MAX_BLOCKERS = 8;
export const MAX_WARNINGS = 8;
export const MAX_CANDIDATES = 8;
export const MAX_TOOLS_PER_CANDIDATE = 4;
export const MAX_MESSAGE_CHARS = 240;

export type RuntimeImprovementStatus = "ok" | "warning" | "blocker";
export type BehaviorImprovementReviewStatus = "ok" | "warning" | "blocked";
export type FreshnessStatus = "fresh" | "stale" | "unknown";
export type VerificationStatus = "passed" | "failed" | "unknown";
export type BehaviorImprovementCandidateCategory =
  | "tool-description"
  | "routing-context"
  | "workflow-guidance"
  | "context-pack-rule";
export type BehaviorImprovementCandidateState = "advisory" | "needs-evidence" | "blocked";
export type BehaviorImprovementSeverity = "info" | "warning" | "blocker";

export interface BehaviorImprovementRuntimeSummary {
  status: RuntimeImprovementStatus;
  missingToolCount: number;
  failedToolCount: number;
  skippedToolCount: number;
  orderingViolationCount: number;
  missingToolNames: string[];
  failedToolNames: string[];
  skippedToolNames: string[];
  orderingViolationToolNames: string[];
  recommendedToolNames: string[];
}

export interface BehaviorImprovementRelationSummary {
  errorCount: number;
  warningCount: number;
  gapKinds: string[];
}

export interface BehaviorImprovementTraceCounts {
  runtimeAudits: number;
  reasoningTraces: number;
  orchestrationTraces: number;
  modelProfileTraces: number;
}

export interface BehaviorImprovementPriorReportReference {
  reportId: string;
  candidateIds: string[];
}

export interface BehaviorImprovementGateSummary {
  sourceConflictCount: number;
  freshnessStatus: FreshnessStatus;
  verificationStatus: VerificationStatus;
  traceCounts: BehaviorImprovementTraceCounts;
  unsafeScope: boolean;
  priorReportReferences: BehaviorImprovementPriorReportReference[];
}

export interface BehaviorImprovementReviewInput {
  runtime: BehaviorImprovementRuntimeSummary;
  relations: BehaviorImprovementRelationSummary;
  gates: BehaviorImprovementGateSummary;
  knownToolNames: string[];
}

export interface BehaviorImprovementNotice {
  code: string;
  subject: string;
  severity: Exclude<BehaviorImprovementSeverity, "info">;
  message: string;
}

export interface BehaviorImprovementCandidate {
  id: string;
  category: BehaviorImprovementCandidateCategory;
  state: BehaviorImprovementCandidateState;
  severity: BehaviorImprovementSeverity;
  target: string;
  rationale: string;
  recommendedExistingTools: string[];
  requiresHumanReview: boolean;
  blockers: BehaviorImprovementNotice[];
  warnings: BehaviorImprovementNotice[];
}

export interface BehaviorImprovementReview {
  reportVersion: typeof BEHAVIOR_IMPROVEMENT_REVIEW_VERSION;
  advisoryOnly: true;
  status: BehaviorImprovementReviewStatus;
  inputHash: string;
  blockers: BehaviorImprovementNotice[];
  warnings: BehaviorImprovementNotice[];
  candidates: BehaviorImprovementCandidate[];
}

type NormalizedInput = BehaviorImprovementReviewInput;

const RUNTIME_STATUSES = new Set<RuntimeImprovementStatus>(["ok", "warning", "blocker"]);
const FRESHNESS_STATUSES = new Set<FreshnessStatus>(["fresh", "stale", "unknown"]);
const VERIFICATION_STATUSES = new Set<VerificationStatus>(["passed", "failed", "unknown"]);
const UNSAFE_TOOL_NAME_TOKENS = ["filepath", "registryentry", "activation", "command", "patch", "diff", "path"];

const SEVERITY_RANK: Record<BehaviorImprovementSeverity, number> = {
  blocker: 0,
  warning: 1,
  info: 2,
};
const STATE_RANK: Record<BehaviorImprovementCandidateState, number> = {
  blocked: 0,
  "needs-evidence": 1,
  advisory: 2,
};

export function createBehaviorImprovementReview(input: BehaviorImprovementReviewInput): BehaviorImprovementReview {
  validateBehaviorImprovementReviewInput(input);
  const normalized = normalizeBehaviorImprovementReviewInput(input);
  const inputHash = createHash("sha256").update(canonicalJson(normalized)).digest("hex");
  const knownToolNames = new Set(normalized.knownToolNames);
  const totalTraceCount = traceTotal(normalized.gates.traceCounts);
  const lowTraceCount = totalTraceCount < MIN_TRACE_COUNT;
  const unknownGate =
    normalized.gates.freshnessStatus === "unknown" || normalized.gates.verificationStatus === "unknown";
  const priorCandidateIds = new Set(
    normalized.gates.priorReportReferences.flatMap((reference) => reference.candidateIds),
  );
  const blockers = createTopLevelBlockers(normalized);
  const warnings = createTopLevelWarnings(normalized, totalTraceCount);
  const candidates: BehaviorImprovementCandidate[] = [];
  let unknownToolOmissionCount = 0;
  let unsafeToolOmissionCount = 0;

  const filterRecommendedTools = (toolNames: string[]): string[] => {
    const recommendedTools: string[] = [];
    for (const toolName of uniqueSorted(toolNames)) {
      if (!knownToolNames.has(toolName)) {
        unknownToolOmissionCount += 1;
        warnings.push(
          notice(
            "UNKNOWN_TOOL_NAME_OMITTED",
            `recommended-tools:unknown-${unknownToolOmissionCount}`,
            "warning",
            "A recommendation was omitted because it is not in the known tool set.",
          ),
        );
        continue;
      }
      if (hasUnsafeToolNameToken(toolName)) {
        unsafeToolOmissionCount += 1;
        warnings.push(
          notice(
            "UNSAFE_TOOL_NAME_OMITTED",
            `recommended-tools:unsafe-${unsafeToolOmissionCount}`,
            "warning",
            "A recommendation was omitted because its registry name matches a guarded token.",
          ),
        );
        continue;
      }
      recommendedTools.push(toolName);
    }
    return recommendedTools.sort(compareStrings).slice(0, MAX_TOOLS_PER_CANDIDATE);
  };

  const buildCandidate = (definition: {
    category: BehaviorImprovementCandidateCategory;
    target: string;
    rationale: string;
    recommendedToolNames: string[];
    requiresHumanReview: boolean;
    relevantBlockers: BehaviorImprovementNotice[];
    evidenceWarnings: BehaviorImprovementNotice[];
  }): BehaviorImprovementCandidate => {
    const id = `${definition.category}:${definition.target}`;
    const circular = priorCandidateIds.has(id);
    const highImpactCircular = circular && isHighImpactCategory(definition.category);
    const candidateWarnings = [...definition.evidenceWarnings];
    const candidateBlockers = [...definition.relevantBlockers];

    if (circular) {
      const circularNotice = notice(
        "CIRCULAR_CANDIDATE",
        id,
        "warning",
        "A prior report already proposed this candidate.",
      );
      warnings.push(circularNotice);
      if (highImpactCircular) {
        candidateBlockers.push({
          ...circularNotice,
          severity: "blocker",
        });
      } else {
        candidateWarnings.push(circularNotice);
      }
    }

    if (definition.relevantBlockers.length > 0 || highImpactCircular) {
      return {
        id,
        category: definition.category,
        state: "blocked",
        severity: "blocker",
        target: definition.target,
        rationale: definition.rationale,
        recommendedExistingTools: filterRecommendedTools(definition.recommendedToolNames),
        requiresHumanReview: definition.requiresHumanReview,
        blockers: sortedNotices(candidateBlockers, MAX_BLOCKERS),
        warnings: sortedNotices(candidateWarnings, MAX_WARNINGS),
      };
    }

    if (lowTraceCount || unknownGate || circular) {
      candidateWarnings.push(
        notice(
          "EVIDENCE_NEEDED",
          id,
          "warning",
          "More evidence is needed before using this advice.",
        ),
      );
      return {
        id,
        category: definition.category,
        state: "needs-evidence",
        severity: "warning",
        target: definition.target,
        rationale: definition.rationale,
        recommendedExistingTools: filterRecommendedTools(definition.recommendedToolNames),
        requiresHumanReview: definition.requiresHumanReview,
        blockers: [],
        warnings: sortedNotices(candidateWarnings, MAX_WARNINGS),
      };
    }

    return {
      id,
      category: definition.category,
      state: "advisory",
      severity: definition.evidenceWarnings.length > 0 ? "warning" : "info",
      target: definition.target,
      rationale: definition.rationale,
      recommendedExistingTools: filterRecommendedTools(definition.recommendedToolNames),
      requiresHumanReview: definition.requiresHumanReview,
      blockers: [],
      warnings: sortedNotices(candidateWarnings, MAX_WARNINGS),
    };
  };

  if (hasRuntimeGap(normalized.runtime)) {
    candidates.push(
      buildCandidate({
        category: "tool-description",
        target: "runtime-tools",
        rationale: "Runtime route evidence shows coverage gaps for existing tools.",
        recommendedToolNames: [
          ...normalized.runtime.recommendedToolNames,
          ...normalized.runtime.missingToolNames,
          ...normalized.runtime.failedToolNames,
          ...normalized.runtime.skippedToolNames,
          ...normalized.runtime.orderingViolationToolNames,
          "runtime_behavior_audit",
          "tool_catalog_query",
        ],
        requiresHumanReview: false,
        relevantBlockers:
          normalized.runtime.status === "blocker"
            ? [
                notice(
                  "RUNTIME_BLOCKER",
                  "runtime",
                  "blocker",
                  "Runtime behavior audit reported blocker status.",
                ),
              ]
            : [],
        evidenceWarnings:
          normalized.runtime.status === "warning"
            ? [
                notice(
                  "RUNTIME_WARNING",
                  "runtime",
                  "warning",
                  "Runtime behavior audit reported warning status.",
                ),
              ]
            : [],
      }),
    );
  }

  if (hasRelationGap(normalized.relations)) {
    candidates.push(
      buildCandidate({
        category: "routing-context",
        target: "capability-relations",
        rationale: "Capability relation audit summary reported structural gaps.",
        recommendedToolNames: ["capability_relation_audit", "tool_catalog_query"],
        requiresHumanReview: false,
        relevantBlockers:
          normalized.relations.errorCount > 0
            ? [
                notice(
                  "RELATION_ERRORS",
                  "capability-relations",
                  "blocker",
                  "Capability relation audit reported error gaps.",
                ),
              ]
            : [],
        evidenceWarnings:
          normalized.relations.warningCount > 0
            ? [
                notice(
                  "RELATION_WARNINGS",
                  "capability-relations",
                  "warning",
                  "Capability relation audit reported warning gaps.",
                ),
              ]
            : [],
      }),
    );
  }

  if (hasWorkflowGateGap(normalized.gates)) {
    candidates.push(
      buildCandidate({
        category: "workflow-guidance",
        target: "gate-health",
        rationale: "Gate, freshness, or verification summaries require human review.",
        recommendedToolNames: workflowRecommendedTools(normalized.gates),
        requiresHumanReview: true,
        relevantBlockers: workflowGateBlockers(normalized.gates),
        evidenceWarnings: [],
      }),
    );
  }

  if (lowTraceCount || unknownGate) {
    candidates.push(
      buildCandidate({
        category: "context-pack-rule",
        target: "context-evidence",
        rationale: "Trace and context evidence is not strong enough for advisory confidence.",
        recommendedToolNames: ["ctx_pack_refresh", "durable_index_manifest_status", "state_maintenance_run"],
        requiresHumanReview: true,
        relevantBlockers: [],
        evidenceWarnings: contextEvidenceWarnings(normalized.gates, totalTraceCount),
      }),
    );
  }

  const sortedCandidates = sortedCandidatesWithinBounds(candidates);
  const sortedBlockers = sortedNotices(blockers, MAX_BLOCKERS);
  const sortedWarnings = sortedNotices(warnings, MAX_WARNINGS);
  const status =
    blockers.length > 0 || candidates.some((candidate) => candidate.state === "blocked")
      ? "blocked"
      : warnings.length > 0 || candidates.some((candidate) => candidate.state === "needs-evidence")
        ? "warning"
        : "ok";

  return {
    reportVersion: BEHAVIOR_IMPROVEMENT_REVIEW_VERSION,
    advisoryOnly: true,
    status,
    inputHash,
    blockers: sortedBlockers,
    warnings: sortedWarnings,
    candidates: sortedCandidates,
  };
}

function validateBehaviorImprovementReviewInput(input: BehaviorImprovementReviewInput): void {
  const root = requireObject(input, "input");
  const runtime = requireObject(root.runtime, "runtime");
  const relations = requireObject(root.relations, "relations");
  const gates = requireObject(root.gates, "gates");
  const traceCounts = requireObject(gates.traceCounts, "gates.traceCounts");

  requireEnum(runtime.status, RUNTIME_STATUSES, "runtime.status");
  requireCount(runtime.missingToolCount, "runtime.missingToolCount");
  requireCount(runtime.failedToolCount, "runtime.failedToolCount");
  requireCount(runtime.skippedToolCount, "runtime.skippedToolCount");
  requireCount(runtime.orderingViolationCount, "runtime.orderingViolationCount");
  requireStringArray(runtime.missingToolNames, "runtime.missingToolNames");
  requireStringArray(runtime.failedToolNames, "runtime.failedToolNames");
  requireStringArray(runtime.skippedToolNames, "runtime.skippedToolNames");
  requireStringArray(runtime.orderingViolationToolNames, "runtime.orderingViolationToolNames");
  requireStringArray(runtime.recommendedToolNames, "runtime.recommendedToolNames");

  requireCount(relations.errorCount, "relations.errorCount");
  requireCount(relations.warningCount, "relations.warningCount");
  requireStringArray(relations.gapKinds, "relations.gapKinds");

  requireCount(gates.sourceConflictCount, "gates.sourceConflictCount");
  requireEnum(gates.freshnessStatus, FRESHNESS_STATUSES, "gates.freshnessStatus");
  requireEnum(gates.verificationStatus, VERIFICATION_STATUSES, "gates.verificationStatus");
  requireCount(traceCounts.runtimeAudits, "gates.traceCounts.runtimeAudits");
  requireCount(traceCounts.reasoningTraces, "gates.traceCounts.reasoningTraces");
  requireCount(traceCounts.orchestrationTraces, "gates.traceCounts.orchestrationTraces");
  requireCount(traceCounts.modelProfileTraces, "gates.traceCounts.modelProfileTraces");
  if (typeof gates.unsafeScope !== "boolean") {
    throw invalidInput("gates.unsafeScope must be a boolean.");
  }
  validatePriorReportReferences(gates.priorReportReferences);
  requireStringArray(root.knownToolNames, "knownToolNames");
}

function normalizeBehaviorImprovementReviewInput(input: BehaviorImprovementReviewInput): NormalizedInput {
  return {
    runtime: {
      status: input.runtime.status,
      missingToolCount: input.runtime.missingToolCount,
      failedToolCount: input.runtime.failedToolCount,
      skippedToolCount: input.runtime.skippedToolCount,
      orderingViolationCount: input.runtime.orderingViolationCount,
      missingToolNames: uniqueSorted(input.runtime.missingToolNames),
      failedToolNames: uniqueSorted(input.runtime.failedToolNames),
      skippedToolNames: uniqueSorted(input.runtime.skippedToolNames),
      orderingViolationToolNames: uniqueSorted(input.runtime.orderingViolationToolNames),
      recommendedToolNames: uniqueSorted(input.runtime.recommendedToolNames),
    },
    relations: {
      errorCount: input.relations.errorCount,
      warningCount: input.relations.warningCount,
      gapKinds: uniqueSorted(input.relations.gapKinds),
    },
    gates: {
      sourceConflictCount: input.gates.sourceConflictCount,
      freshnessStatus: input.gates.freshnessStatus,
      verificationStatus: input.gates.verificationStatus,
      traceCounts: {
        runtimeAudits: input.gates.traceCounts.runtimeAudits,
        reasoningTraces: input.gates.traceCounts.reasoningTraces,
        orchestrationTraces: input.gates.traceCounts.orchestrationTraces,
        modelProfileTraces: input.gates.traceCounts.modelProfileTraces,
      },
      unsafeScope: input.gates.unsafeScope,
      priorReportReferences: normalizePriorReportReferences(input.gates.priorReportReferences),
    },
    knownToolNames: uniqueSorted(input.knownToolNames),
  };
}

function normalizePriorReportReferences(
  references: BehaviorImprovementPriorReportReference[],
): BehaviorImprovementPriorReportReference[] {
  const uniqueReferences = new Map<string, BehaviorImprovementPriorReportReference>();
  for (const reference of references) {
    const normalizedReference = {
      reportId: reference.reportId,
      candidateIds: uniqueSorted(reference.candidateIds),
    };
    uniqueReferences.set(`${normalizedReference.reportId}\0${normalizedReference.candidateIds.join("\0")}`, normalizedReference);
  }
  return [...uniqueReferences.values()].sort((left, right) =>
    compareStrings(
      `${left.reportId}\0${left.candidateIds.join("\0")}`,
      `${right.reportId}\0${right.candidateIds.join("\0")}`,
    ),
  );
}

function createTopLevelBlockers(input: NormalizedInput): BehaviorImprovementNotice[] {
  const blockers: BehaviorImprovementNotice[] = [];
  if (input.runtime.status === "blocker") {
    blockers.push(notice("RUNTIME_BLOCKER", "runtime", "blocker", "Runtime behavior audit reported blocker status."));
  }
  if (input.relations.errorCount > 0) {
    blockers.push(
      notice("RELATION_ERRORS", "capability-relations", "blocker", "Capability relation audit reported error gaps."),
    );
  }
  blockers.push(...workflowGateBlockers(input.gates));
  return blockers;
}

function createTopLevelWarnings(input: NormalizedInput, totalTraceCount: number): BehaviorImprovementNotice[] {
  const warnings: BehaviorImprovementNotice[] = [];
  if (input.runtime.status === "warning") {
    warnings.push(notice("RUNTIME_WARNING", "runtime", "warning", "Runtime behavior audit reported warning status."));
  }
  if (input.relations.warningCount > 0) {
    warnings.push(
      notice(
        "RELATION_WARNINGS",
        "capability-relations",
        "warning",
        "Capability relation audit reported warning gaps.",
      ),
    );
  }
  warnings.push(...contextEvidenceWarnings(input.gates, totalTraceCount));
  return warnings;
}

function workflowGateBlockers(gates: BehaviorImprovementGateSummary): BehaviorImprovementNotice[] {
  const blockers: BehaviorImprovementNotice[] = [];
  if (gates.sourceConflictCount > 0) {
    blockers.push(
      notice("SOURCE_CONFLICTS", "source-conflicts", "blocker", "Source conflict summary reported conflicts."),
    );
  }
  if (gates.freshnessStatus === "stale") {
    blockers.push(notice("FRESHNESS_STALE", "freshness", "blocker", "Freshness summary is stale."));
  }
  if (gates.verificationStatus === "failed") {
    blockers.push(
      notice("VERIFICATION_FAILED", "verification", "blocker", "Verification summary reported failure."),
    );
  }
  if (gates.unsafeScope) {
    blockers.push(notice("UNSAFE_SCOPE", "scope", "blocker", "Scope gate marked this review unsafe."));
  }
  return blockers;
}

function contextEvidenceWarnings(
  gates: BehaviorImprovementGateSummary,
  totalTraceCount: number,
): BehaviorImprovementNotice[] {
  const warnings: BehaviorImprovementNotice[] = [];
  if (gates.freshnessStatus === "unknown") {
    warnings.push(notice("FRESHNESS_UNKNOWN", "freshness", "warning", "Freshness summary is unknown."));
  }
  if (gates.verificationStatus === "unknown") {
    warnings.push(notice("VERIFICATION_UNKNOWN", "verification", "warning", "Verification summary is unknown."));
  }
  if (totalTraceCount < MIN_TRACE_COUNT) {
    warnings.push(notice("LOW_TRACE_COUNT", "traces", "warning", "Trace count is below review evidence threshold."));
  }
  return warnings;
}

function workflowRecommendedTools(gates: BehaviorImprovementGateSummary): string[] {
  const toolNames = ["gate_request", "state_maintenance_run"];
  if (gates.sourceConflictCount > 0) {
    toolNames.push("source_conflicts_analyze");
  }
  if (gates.verificationStatus === "failed") {
    toolNames.push("verification_run");
  }
  return toolNames;
}

function hasRuntimeGap(runtime: BehaviorImprovementRuntimeSummary): boolean {
  return (
    runtime.status !== "ok" ||
    runtime.missingToolCount > 0 ||
    runtime.failedToolCount > 0 ||
    runtime.skippedToolCount > 0 ||
    runtime.orderingViolationCount > 0 ||
    runtime.missingToolNames.length > 0 ||
    runtime.failedToolNames.length > 0 ||
    runtime.skippedToolNames.length > 0 ||
    runtime.orderingViolationToolNames.length > 0
  );
}

function hasRelationGap(relations: BehaviorImprovementRelationSummary): boolean {
  return relations.errorCount > 0 || relations.warningCount > 0 || relations.gapKinds.length > 0;
}

function hasWorkflowGateGap(gates: BehaviorImprovementGateSummary): boolean {
  return (
    gates.sourceConflictCount > 0 ||
    gates.freshnessStatus === "stale" ||
    gates.verificationStatus === "failed" ||
    gates.unsafeScope
  );
}

function isHighImpactCategory(category: BehaviorImprovementCandidateCategory): boolean {
  return category === "workflow-guidance" || category === "context-pack-rule";
}

function hasUnsafeToolNameToken(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return UNSAFE_TOOL_NAME_TOKENS.some((token) => normalized.includes(token));
}

function traceTotal(traceCounts: BehaviorImprovementTraceCounts): number {
  return (
    traceCounts.runtimeAudits +
    traceCounts.reasoningTraces +
    traceCounts.orchestrationTraces +
    traceCounts.modelProfileTraces
  );
}

function notice(
  code: string,
  subject: string,
  severity: Exclude<BehaviorImprovementSeverity, "info">,
  message: string,
): BehaviorImprovementNotice {
  return {
    code,
    subject,
    severity,
    message: truncateMessage(message),
  };
}

function sortedNotices(notices: BehaviorImprovementNotice[], limit: number): BehaviorImprovementNotice[] {
  return [...notices]
    .sort((left, right) => {
      const leftKey = `${left.code}|${left.subject}|${left.message}`;
      const rightKey = `${right.code}|${right.subject}|${right.message}`;
      return compareStrings(leftKey, rightKey);
    })
    .slice(0, limit);
}

function sortedCandidatesWithinBounds(candidates: BehaviorImprovementCandidate[]): BehaviorImprovementCandidate[] {
  return [...candidates]
    .sort((left, right) => {
      const severityDiff = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      if (severityDiff !== 0) {
        return severityDiff;
      }
      const stateDiff = STATE_RANK[left.state] - STATE_RANK[right.state];
      if (stateDiff !== 0) {
        return stateDiff;
      }
      const leftKey = `${left.category}|${left.target}|${left.id}`;
      const rightKey = `${right.category}|${right.target}|${right.id}`;
      return compareStrings(leftKey, rightKey);
    })
    .slice(0, MAX_CANDIDATES);
}

function truncateMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_CHARS) {
    return message;
  }
  return `${message.slice(0, MAX_MESSAGE_CHARS - 3)}...`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareStrings)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function validatePriorReportReferences(value: unknown): void {
  if (!Array.isArray(value)) {
    throw invalidInput("gates.priorReportReferences must be an array.");
  }
  value.forEach((entry, index) => {
    const reference = requireObject(entry, `gates.priorReportReferences.${index}`);
    if (typeof reference.reportId !== "string") {
      throw invalidInput(`gates.priorReportReferences.${index}.reportId must be a string.`);
    }
    requireStringArray(reference.candidateIds, `gates.priorReportReferences.${index}.candidateIds`);
  });
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidInput(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireEnum<T extends string>(value: unknown, allowed: Set<T>, path: string): void {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw invalidInput(`${path} has an invalid value.`);
  }
}

function requireCount(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw invalidInput(`${path} must be a non-negative finite integer.`);
  }
}

function requireStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw invalidInput(`${path} must be an array.`);
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      throw invalidInput(`${path}.${index} must be a string.`);
    }
  });
}

function invalidInput(message: string): Error {
  return new Error(`Invalid behavior improvement review input: ${message}`);
}
