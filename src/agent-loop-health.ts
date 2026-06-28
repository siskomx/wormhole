import type {
  RuntimeBehaviorAudit,
  RuntimeObservedToolCall,
  RuntimeRecommendedTool,
} from "./runtime-behavior-audit.js";

export const AGENT_LOOP_HEALTH_VERSION = "agent-loop-health.v1";

const MAX_TOP_LEVEL_NOTICES = 8;
const MAX_STOP_CONDITIONS = 8;
const MAX_PHASE_NEXT_TOOLS = 4;
const MAX_NEXT_TOOLS = 8;

const LOOP_PHASES = ["perceive", "reason", "plan", "act", "observe", "maintain"] as const;

const PHASE_OVERRIDES: Record<string, AgentLoopPhaseName> = {
  agent_context_prepare: "plan",
  ctx_pack_refresh: "maintain",
  durable_index_manifest_status: "maintain",
  durable_index_status: "maintain",
  gate_request: "observe",
  mission_route: "plan",
  next_best_tool: "plan",
  runtime_behavior_audit: "observe",
  state_maintenance_run: "maintain",
  verification_run: "observe",
};

const PHASE_MAP: Record<string, AgentLoopPhaseName> = {
  act: "act",
  context: "perceive",
  gather: "perceive",
  gate: "observe",
  impact: "perceive",
  maintain: "maintain",
  orient: "perceive",
  plan: "plan",
  research: "plan",
  verify: "observe",
};

const UNSAFE_NAME_PARTS = ["activation", "command", "diff", "filepath", "patch", "registryentry"];

export type AgentLoopMode = "planned" | "observed";
export type AgentLoopStatus = "ok" | "warning" | "blocked";
export type AgentLoopPhaseName = (typeof LOOP_PHASES)[number];
export type AgentLoopFreshnessStatus = "fresh" | "stale" | "unknown";
export type AgentLoopVerificationStatus = "passed" | "failed" | "unknown";
export type AgentLoopIndexHealthStatus = "ok" | "degraded" | "stale" | "missing" | "unknown";
export type AgentLoopNoticeSeverity = "warning" | "blocker";

export type AgentLoopGateSignals = {
  sourceConflictCount: number;
  freshnessStatus: AgentLoopFreshnessStatus;
  verificationStatus: AgentLoopVerificationStatus;
  indexHealthStatus: AgentLoopIndexHealthStatus;
};

export type AgentLoopBudgets = {
  currentIteration: number;
  maxIterations: number;
  estimatedTokenMultiplier: number;
  maxTokenMultiplier: number;
  noProgressIterations: number;
  maxNoProgressIterations: number;
};

export type AgentLoopNotice = {
  code: string;
  severity: AgentLoopNoticeSeverity;
  subject: string;
  message: string;
};

export type AgentLoopStopCondition = {
  code: string;
  status: Exclude<AgentLoopStatus, "ok">;
  subject: string;
  message: string;
};

export type AgentLoopPhaseSummary = {
  phase: AgentLoopPhaseName;
  status: AgentLoopStatus;
  recommendedToolNames: string[];
  observedToolNames: string[];
  missingToolNames: string[];
  failedToolNames: string[];
  skippedToolNames: string[];
  blockers: AgentLoopNotice[];
  warnings: AgentLoopNotice[];
  nextExistingTools: string[];
};

export type AgentLoopHealthInput = {
  mode: AgentLoopMode;
  recommendedTools: RuntimeRecommendedTool[];
  observedToolCalls: RuntimeObservedToolCall[];
  runtimeAudit: RuntimeBehaviorAudit;
  knownToolNames: string[];
  gateSignals: AgentLoopGateSignals;
  budgets: AgentLoopBudgets;
};

export type AgentLoopHealthReport = {
  reportVersion: typeof AGENT_LOOP_HEALTH_VERSION;
  advisoryOnly: true;
  mode: AgentLoopMode;
  status: AgentLoopStatus;
  phases: AgentLoopPhaseSummary[];
  stopConditions: AgentLoopStopCondition[];
  blockers: AgentLoopNotice[];
  warnings: AgentLoopNotice[];
  nextExistingTools: string[];
};

type NamedTool = {
  toolName: string;
  phase?: string;
};

type NormalizedRecommendedTool = RuntimeRecommendedTool & {
  toolName: string;
  phase?: string;
};

type NormalizedObservedToolCall = RuntimeObservedToolCall & {
  toolName: string;
};

type PhaseBuckets = {
  recommendedToolNames: string[];
  observedToolNames: string[];
  missingToolNames: string[];
  failedToolNames: string[];
  skippedToolNames: string[];
};

export function createAgentLoopHealth(input: AgentLoopHealthInput): AgentLoopHealthReport {
  validateInput(input);

  const knownToolNames = uniqueSorted(input.knownToolNames.map((toolName) => normalizeName(toolName)));
  const knownNameSet = new Set(knownToolNames);
  const recommendedTools = normalizeRecommendedTools(input.recommendedTools);
  const observedToolCalls = normalizeObservedToolCalls(input.observedToolCalls);
  const runtimeAudit = input.runtimeAudit;
  const unsafeNameOmitted = hasUnsafeToolName([
    ...recommendedTools.map((tool) => tool.toolName),
    ...observedToolCalls.map((tool) => tool.toolName),
    ...runtimeAudit.missingTools.map((tool) => tool.toolName),
    ...runtimeAudit.uncoveredRequiredTools.map((tool) => tool.toolName),
    ...runtimeAudit.failedTools.map((tool) => tool.toolName),
    ...runtimeAudit.skippedTools.map((tool) => tool.toolName),
  ]);

  const safeRecommendedTools = recommendedTools.filter((tool) => !isUnsafeToolName(tool.toolName));
  const safeObservedToolCalls = observedToolCalls.filter((tool) => !isUnsafeToolName(tool.toolName));
  const safeMissingTools = normalizeRecommendedTools(runtimeAudit.missingTools).filter(
    (tool) => !isUnsafeToolName(tool.toolName),
  );
  const safeUncoveredRequiredTools = normalizeRecommendedTools(runtimeAudit.uncoveredRequiredTools).filter(
    (tool) => !isUnsafeToolName(tool.toolName),
  );
  const safeFailedTools = normalizeObservedToolCalls(runtimeAudit.failedTools).filter(
    (tool) => !isUnsafeToolName(tool.toolName),
  );
  const safeSkippedTools = normalizeObservedToolCalls(runtimeAudit.skippedTools).filter(
    (tool) => !isUnsafeToolName(tool.toolName),
  );
  const safeUnexpectedTools = normalizeObservedToolCalls(runtimeAudit.unexpectedTools).filter(
    (tool) => !isUnsafeToolName(tool.toolName),
  );

  const phases = createPhaseSummaries({
    recommendedTools: safeRecommendedTools,
    observedToolCalls: safeObservedToolCalls,
    missingTools: uniqueToolsByName([...safeMissingTools, ...safeUncoveredRequiredTools]),
    failedTools: safeFailedTools,
    skippedTools: safeSkippedTools,
    knownNameSet,
  });

  const stopConditions = createStopConditions(input);
  const blockers = createTopLevelBlockers(input, runtimeAudit, stopConditions);
  const warnings = createTopLevelWarnings({
    input,
    runtimeAudit,
    safeMissingTools,
    safeFailedTools,
    safeSkippedTools,
    safeUnexpectedTools,
    knownNameSet,
    unsafeNameOmitted,
  });
  const nextExistingTools = createNextExistingTools({
    toolNames: [
      ...safeUncoveredRequiredTools.map((tool) => tool.toolName),
      ...safeMissingTools.map((tool) => tool.toolName),
      ...safeFailedTools.map((tool) => tool.toolName),
      ...safeSkippedTools.map((tool) => tool.toolName),
    ],
    knownNameSet,
    limit: MAX_NEXT_TOOLS,
  });

  return {
    reportVersion: AGENT_LOOP_HEALTH_VERSION,
    advisoryOnly: true,
    mode: input.mode,
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 || phases.some((phase) => phase.status !== "ok") ? "warning" : "ok",
    phases,
    stopConditions,
    blockers,
    warnings,
    nextExistingTools,
  };
}

function createPhaseSummaries(input: {
  recommendedTools: NormalizedRecommendedTool[];
  observedToolCalls: NormalizedObservedToolCall[];
  missingTools: NormalizedRecommendedTool[];
  failedTools: NormalizedObservedToolCall[];
  skippedTools: NormalizedObservedToolCall[];
  knownNameSet: Set<string>;
}): AgentLoopPhaseSummary[] {
  const buckets = new Map<AgentLoopPhaseName, PhaseBuckets>(
    LOOP_PHASES.map((phase) => [
      phase,
      {
        recommendedToolNames: [],
        observedToolNames: [],
        missingToolNames: [],
        failedToolNames: [],
        skippedToolNames: [],
      },
    ]),
  );

  for (const tool of input.recommendedTools) {
    buckets.get(classifyToolPhase(tool))?.recommendedToolNames.push(tool.toolName);
  }
  for (const tool of input.observedToolCalls) {
    buckets.get(classifyToolPhase(tool))?.observedToolNames.push(tool.toolName);
  }
  for (const tool of input.missingTools) {
    buckets.get(classifyToolPhase(tool))?.missingToolNames.push(tool.toolName);
  }
  for (const tool of input.failedTools) {
    buckets.get(classifyToolPhase(tool))?.failedToolNames.push(tool.toolName);
  }
  for (const tool of input.skippedTools) {
    buckets.get(classifyToolPhase(tool))?.skippedToolNames.push(tool.toolName);
  }

  return LOOP_PHASES.map((phase) => {
    const bucket = buckets.get(phase);
    if (!bucket) {
      throw new Error(`Invalid agent loop health input: missing phase bucket ${phase}.`);
    }
    const recommendedToolNames = uniqueSorted(bucket.recommendedToolNames);
    const observedToolNames = orderedUnique(bucket.observedToolNames);
    const missingToolNames = uniqueSorted(bucket.missingToolNames);
    const failedToolNames = uniqueSorted(bucket.failedToolNames);
    const skippedToolNames = uniqueSorted(bucket.skippedToolNames);
    const warnings = createPhaseWarnings({ missingToolNames, failedToolNames, skippedToolNames });
    const blockers: AgentLoopNotice[] = [];
    return {
      phase,
      status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ok",
      recommendedToolNames,
      observedToolNames,
      missingToolNames,
      failedToolNames,
      skippedToolNames,
      blockers,
      warnings,
      nextExistingTools: createNextExistingTools({
        toolNames: [...missingToolNames, ...failedToolNames, ...skippedToolNames],
        knownNameSet: input.knownNameSet,
        limit: MAX_PHASE_NEXT_TOOLS,
      }),
    };
  });
}

function createPhaseWarnings(input: {
  missingToolNames: string[];
  failedToolNames: string[];
  skippedToolNames: string[];
}): AgentLoopNotice[] {
  const warnings: AgentLoopNotice[] = [];
  if (input.missingToolNames.length > 0) {
    warnings.push(
      createNotice(
        "PHASE_MISSING_RECOMMENDED_TOOLS",
        "warning",
        "Loop phase is missing recommendations",
        "One or more recommended tools were not observed for this phase.",
      ),
    );
  }
  if (input.failedToolNames.length > 0) {
    warnings.push(
      createNotice(
        "PHASE_FAILED_TOOLS",
        "warning",
        "Loop phase has failed tools",
        "One or more observed tools failed in this phase.",
      ),
    );
  }
  if (input.skippedToolNames.length > 0) {
    warnings.push(
      createNotice(
        "PHASE_SKIPPED_TOOLS",
        "warning",
        "Loop phase has skipped tools",
        "One or more observed tools were skipped in this phase.",
      ),
    );
  }
  return warnings;
}

function createTopLevelBlockers(
  input: AgentLoopHealthInput,
  runtimeAudit: RuntimeBehaviorAudit,
  stopConditions: AgentLoopStopCondition[],
): AgentLoopNotice[] {
  const blockers = stopConditions.map((condition) =>
    createNotice(condition.code, "blocker", condition.subject, condition.message),
  );

  if (input.mode === "observed" && runtimeAudit.summary.status === "blocker") {
    blockers.push(
      createNotice(
        "RUNTIME_AUDIT_BLOCKER",
        "blocker",
        "Runtime audit is blocking",
        "The supplied runtime audit found required runtime coverage gaps.",
      ),
    );
  }

  return uniqueNotices(blockers).slice(0, MAX_TOP_LEVEL_NOTICES);
}

function createTopLevelWarnings(input: {
  input: AgentLoopHealthInput;
  runtimeAudit: RuntimeBehaviorAudit;
  safeMissingTools: NormalizedRecommendedTool[];
  safeFailedTools: NormalizedObservedToolCall[];
  safeSkippedTools: NormalizedObservedToolCall[];
  safeUnexpectedTools: NormalizedObservedToolCall[];
  knownNameSet: Set<string>;
  unsafeNameOmitted: boolean;
}): AgentLoopNotice[] {
  const warnings: AgentLoopNotice[] = [];

  if (input.input.mode === "planned" && input.input.observedToolCalls.length === 0) {
    warnings.push(
      createNotice(
        "PLANNED_NO_OBSERVATIONS",
        "warning",
        "Planned loop has no observations",
        "This report is based on intended tool flow only.",
      ),
    );
  }

  if (input.input.mode === "observed" && input.runtimeAudit.summary.status === "warning") {
    warnings.push(
      createNotice(
        "RUNTIME_AUDIT_WARNING",
        "warning",
        "Runtime audit has warnings",
        "The supplied runtime audit found runtime coverage concerns.",
      ),
    );
  }

  if (input.safeMissingTools.length > 0 || input.runtimeAudit.summary.missingToolCount > 0) {
    warnings.push(
      createNotice(
        "MISSING_RECOMMENDED_TOOLS",
        "warning",
        "Recommended tools are missing",
        "One or more recommended tools were not observed.",
      ),
    );
  }

  if (input.safeFailedTools.length > 0 || input.runtimeAudit.summary.failedToolCount > 0) {
    warnings.push(
      createNotice("FAILED_TOOLS", "warning", "Observed tools failed", "One or more observed tools failed."),
    );
  }

  if (input.safeSkippedTools.length > 0 || input.runtimeAudit.summary.skippedToolCount > 0) {
    warnings.push(
      createNotice("SKIPPED_TOOLS", "warning", "Observed tools were skipped", "One or more observed tools were skipped."),
    );
  }

  if (input.safeUnexpectedTools.length > 0 || input.runtimeAudit.summary.unexpectedToolCount > 0) {
    warnings.push(
      createNotice(
        "UNEXPECTED_WORMHOLE_TOOLS",
        "warning",
        "Unexpected Wormhole tools were observed",
        "One or more Wormhole tools were observed outside the recommended flow.",
      ),
    );
  }

  if (input.input.mode === "observed" && input.runtimeAudit.summary.coverageRatio < 0.5) {
    warnings.push(
      createNotice(
        "LOW_RUNTIME_COVERAGE",
        "warning",
        "Runtime coverage is low",
        "Observed tool coverage is below the recommended loop threshold.",
      ),
    );
  }

  if (input.input.gateSignals.freshnessStatus === "unknown") {
    warnings.push(
      createNotice(
        "FRESHNESS_UNKNOWN",
        "warning",
        "Freshness is unknown",
        "Artifact freshness was not available for this loop health report.",
      ),
    );
  }

  if (input.input.gateSignals.verificationStatus === "unknown") {
    warnings.push(
      createNotice(
        "VERIFICATION_UNKNOWN",
        "warning",
        "Verification is unknown",
        "Verification results were not available for this loop health report.",
      ),
    );
  }

  if (input.input.gateSignals.indexHealthStatus === "unknown") {
    warnings.push(
      createNotice(
        "INDEX_HEALTH_UNKNOWN",
        "warning",
        "Index health is unknown",
        "Durable index health was not available for this loop health report.",
      ),
    );
  }

  if (input.input.gateSignals.indexHealthStatus === "degraded") {
    warnings.push(
      createNotice(
        "INDEX_HEALTH_DEGRADED",
        "warning",
        "Index health is degraded",
        "Durable index health is degraded for this loop health report.",
      ),
    );
  }

  if (input.input.gateSignals.indexHealthStatus === "stale") {
    warnings.push(
      createNotice(
        "INDEX_HEALTH_STALE",
        "warning",
        "Index health is stale",
        "Durable index health is stale for this loop health report.",
      ),
    );
  }

  if (hasUnknownNextTool(input, input.knownNameSet)) {
    warnings.push(
      createNotice(
        "UNKNOWN_TOOL_NAME_OMITTED",
        "warning",
        "Unknown tool omitted",
        "A tool not present in the registry was omitted from next suggestions.",
      ),
    );
  }

  if (input.unsafeNameOmitted) {
    warnings.push(
      createNotice(
        "UNSAFE_TOOL_NAME_OMITTED",
        "warning",
        "Sensitive tool omitted",
        "A sensitive tool name was omitted from next suggestions.",
      ),
    );
  }

  return uniqueNotices(warnings).slice(0, MAX_TOP_LEVEL_NOTICES);
}

function hasUnknownNextTool(
  input: {
    safeMissingTools: NormalizedRecommendedTool[];
    safeFailedTools: NormalizedObservedToolCall[];
    safeSkippedTools: NormalizedObservedToolCall[];
  },
  knownNameSet: Set<string>,
): boolean {
  return [
    ...input.safeMissingTools.map((tool) => tool.toolName),
    ...input.safeFailedTools.map((tool) => tool.toolName),
    ...input.safeSkippedTools.map((tool) => tool.toolName),
  ].some((toolName) => !knownNameSet.has(toolName));
}

function createStopConditions(input: AgentLoopHealthInput): AgentLoopStopCondition[] {
  const stopConditions: AgentLoopStopCondition[] = [];
  if (input.gateSignals.freshnessStatus === "stale") {
    stopConditions.push({
      code: "FRESHNESS_STALE",
      status: "blocked",
      subject: "Freshness is stale",
      message: "Artifact freshness is stale.",
    });
  }
  if (input.gateSignals.indexHealthStatus === "missing") {
    stopConditions.push({
      code: "INDEX_MISSING",
      status: "blocked",
      subject: "Durable index is missing",
      message: "Durable index health is missing.",
    });
  }
  if (input.budgets.currentIteration >= input.budgets.maxIterations) {
    stopConditions.push({
      code: "ITERATION_LIMIT",
      status: "blocked",
      subject: "Iteration limit reached",
      message: "The loop iteration budget has been reached.",
    });
  }
  if (input.budgets.noProgressIterations >= input.budgets.maxNoProgressIterations) {
    stopConditions.push({
      code: "NO_PROGRESS_LIMIT",
      status: "blocked",
      subject: "No-progress limit reached",
      message: "The no-progress budget has been reached.",
    });
  }
  if (input.gateSignals.sourceConflictCount > 0) {
    stopConditions.push({
      code: "SOURCE_CONFLICTS",
      status: "blocked",
      subject: "Source conflicts exist",
      message: "Source authority conflicts must be resolved before continuing.",
    });
  }
  if (input.budgets.estimatedTokenMultiplier > input.budgets.maxTokenMultiplier) {
    stopConditions.push({
      code: "TOKEN_MULTIPLIER_LIMIT",
      status: "blocked",
      subject: "Token multiplier limit exceeded",
      message: "The estimated token multiplier is above the loop budget.",
    });
  }
  if (input.gateSignals.verificationStatus === "failed") {
    stopConditions.push({
      code: "VERIFICATION_FAILED",
      status: "blocked",
      subject: "Verification failed",
      message: "Verification must pass before continuing.",
    });
  }
  return stopConditions.slice(0, MAX_STOP_CONDITIONS);
}

function createNextExistingTools(input: {
  toolNames: string[];
  knownNameSet: Set<string>;
  limit: number;
}): string[] {
  return uniqueSorted(input.toolNames)
    .filter((toolName) => input.knownNameSet.has(toolName))
    .filter((toolName) => !isUnsafeToolName(toolName))
    .slice(0, input.limit);
}

function classifyToolPhase(tool: NamedTool): AgentLoopPhaseName {
  const toolName = normalizeName(tool.toolName);
  const override = PHASE_OVERRIDES[toolName];
  if (override) {
    return override;
  }
  const phase = typeof tool.phase === "string" ? tool.phase.trim() : "";
  return PHASE_MAP[phase] ?? "reason";
}

function createNotice(
  code: string,
  severity: AgentLoopNoticeSeverity,
  subject: string,
  message: string,
): AgentLoopNotice {
  return { code, severity, subject, message };
}

function uniqueNotices(notices: AgentLoopNotice[]): AgentLoopNotice[] {
  const seen = new Set<string>();
  const unique: AgentLoopNotice[] = [];
  for (const notice of notices) {
    const key = `${notice.severity}\u0000${notice.code}\u0000${notice.subject}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(notice);
  }
  return unique.sort((left, right) => compareStrings(left.code, right.code));
}

function uniqueToolsByName<Tool extends { toolName: string }>(tools: Tool[]): Tool[] {
  const seen = new Set<string>();
  const unique: Tool[] = [];
  for (const tool of tools) {
    if (seen.has(tool.toolName)) {
      continue;
    }
    seen.add(tool.toolName);
    unique.push(tool);
  }
  return unique.sort((left, right) => compareStrings(left.toolName, right.toolName));
}

function normalizeRecommendedTools(tools: RuntimeRecommendedTool[]): NormalizedRecommendedTool[] {
  return tools
    .filter((tool): tool is RuntimeRecommendedTool => typeof tool?.toolName === "string")
    .map((tool) => ({
      ...tool,
      toolName: normalizeName(tool.toolName),
      ...(typeof tool.phase === "string" ? { phase: tool.phase.trim() } : {}),
    }))
    .filter((tool) => tool.toolName.length > 0);
}

function normalizeObservedToolCalls(tools: RuntimeObservedToolCall[]): NormalizedObservedToolCall[] {
  return tools
    .filter((tool): tool is RuntimeObservedToolCall => typeof tool?.toolName === "string")
    .map((tool) => ({
      ...tool,
      toolName: normalizeName(tool.toolName),
    }))
    .filter((tool) => tool.toolName.length > 0);
}

function orderedUnique(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function uniqueSorted(values: string[]): string[] {
  return orderedUnique(values.filter(Boolean)).sort(compareStrings);
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

function normalizeName(toolName: string): string {
  return toolName.trim();
}

function isUnsafeToolName(toolName: string): boolean {
  const normalized = normalizeName(toolName).toLowerCase();
  return UNSAFE_NAME_PARTS.some((part) => normalized.includes(part));
}

function hasUnsafeToolName(toolNames: string[]): boolean {
  return toolNames.some((toolName) => typeof toolName === "string" && isUnsafeToolName(toolName));
}

function validateInput(input: AgentLoopHealthInput): void {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    throw new Error("Invalid agent loop health input: input must be an object.");
  }
  if (input.mode !== "planned" && input.mode !== "observed") {
    errors.push("mode must be planned or observed");
  }
  if (!Array.isArray(input.recommendedTools)) {
    errors.push("recommendedTools must be an array");
  }
  if (!Array.isArray(input.observedToolCalls)) {
    errors.push("observedToolCalls must be an array");
  }
  if (!Array.isArray(input.knownToolNames)) {
    errors.push("knownToolNames must be an array");
  }
  if (!input.runtimeAudit || typeof input.runtimeAudit !== "object" || !input.runtimeAudit.summary) {
    errors.push("runtimeAudit must be supplied by the caller");
  }
  validateGateSignals(input.gateSignals, errors);
  validateBudgets(input.budgets, errors);

  if (errors.length > 0) {
    throw new Error(`Invalid agent loop health input: ${errors.join("; ")}.`);
  }
}

function validateGateSignals(gateSignals: AgentLoopGateSignals, errors: string[]): void {
  if (!gateSignals || typeof gateSignals !== "object") {
    errors.push("gateSignals must be an object");
    return;
  }
  if (!isNonNegativeFinite(gateSignals.sourceConflictCount)) {
    errors.push("sourceConflictCount must be finite and nonnegative");
  }
  if (!["fresh", "stale", "unknown"].includes(gateSignals.freshnessStatus)) {
    errors.push("freshnessStatus is invalid");
  }
  if (!["passed", "failed", "unknown"].includes(gateSignals.verificationStatus)) {
    errors.push("verificationStatus is invalid");
  }
  if (!["ok", "degraded", "stale", "missing", "unknown"].includes(gateSignals.indexHealthStatus)) {
    errors.push("indexHealthStatus is invalid");
  }
}

function validateBudgets(budgets: AgentLoopBudgets, errors: string[]): void {
  if (!budgets || typeof budgets !== "object") {
    errors.push("budgets must be an object");
    return;
  }
  for (const field of ["currentIteration", "estimatedTokenMultiplier", "noProgressIterations"] as const) {
    if (!isNonNegativeFinite(budgets[field])) {
      errors.push(`${field} must be finite and nonnegative`);
    }
  }
  for (const field of ["maxIterations", "maxTokenMultiplier", "maxNoProgressIterations"] as const) {
    if (!isPositiveFinite(budgets[field])) {
      errors.push(`${field} must be finite and positive`);
    }
  }
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
