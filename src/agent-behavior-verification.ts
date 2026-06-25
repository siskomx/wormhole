import { createHash } from "node:crypto";

export type AgentRemitRuleStatus = "verified" | "gap" | "partial" | "vague" | "enforcement_not_possible";

export type AgentBehaviorSeverity = "Critical" | "High" | "Medium" | "Low" | "Informational";

export type AgentBehaviorRiskLevel = "low" | "medium" | "high" | "critical";

export type AgentRemitRuleKind =
  | "capability_baseline"
  | "approval_required"
  | "forbidden_capability"
  | "approved_channel"
  | "authorized_counterparty"
  | "allowed_data_source"
  | "allowed_outbound_destination"
  | "never_allowed_action";

export type AgentKnownGoodBaseline = {
  typicalToolInventory?: string[];
  typicalChannelsUsed?: string[];
  typicalOutboundDestinations?: string[];
  typicalFilePathsAccessed?: string[];
};

export type AgentRemitInput = {
  workerName: string;
  mission: string;
  owner?: string;
  version?: string;
  updatedBy?: string;
  allowedCapabilities?: string[];
  restrictedCapabilities?: string[];
  forbiddenCapabilities?: string[];
  approvedChannels?: string[];
  authorizedCounterparties?: string[];
  allowedDataSources?: string[];
  allowedOutboundDestinations?: string[];
  approvalRequiredActions?: string[];
  neverAllowedActions?: string[];
  escalationRules?: {
    halt?: string[];
    alert?: string[];
    logOnly?: string[];
  };
  knownGoodBaseline?: AgentKnownGoodBaseline;
};

export type AgentRemitRule = {
  ruleId: string;
  section: string;
  kind: AgentRemitRuleKind;
  text: string;
  values: string[];
};

export type AgentRemit = Required<
  Pick<AgentRemitInput, "workerName" | "mission">
> & {
  remitId: string;
  owner?: string;
  version: string;
  updatedBy?: string;
  allowedCapabilities: string[];
  restrictedCapabilities: string[];
  forbiddenCapabilities: string[];
  approvedChannels: string[];
  authorizedCounterparties: string[];
  allowedDataSources: string[];
  allowedOutboundDestinations: string[];
  approvalRequiredActions: string[];
  neverAllowedActions: string[];
  escalationRules: {
    halt: string[];
    alert: string[];
    logOnly: string[];
  };
  knownGoodBaseline: AgentKnownGoodBaseline;
  rules: AgentRemitRule[];
};

export type ObservedAgentAction = {
  action: string;
  approvalObserved?: boolean;
  source?: string;
  line?: number;
  summary?: string;
};

export type ObservedAgentPrompt = {
  path: string;
  sessionLoaded?: boolean;
  writable?: boolean;
  grantsCapabilities?: string[];
};

export type ObservedAgentLog = {
  path: string;
  kind: string;
};

export type AgentCapabilityInventoryInput = {
  agentId: string;
  repoRoot?: string;
  capabilities?: string[];
  channels?: string[];
  counterparties?: string[];
  dataSources?: string[];
  outboundDestinations?: string[];
  mcpServers?: string[];
  actions?: ObservedAgentAction[];
  prompts?: ObservedAgentPrompt[];
  logs?: ObservedAgentLog[];
};

export type AgentCapabilityInventory = Required<
  Pick<AgentCapabilityInventoryInput, "agentId">
> & {
  repoRoot?: string;
  capabilities: string[];
  channels: string[];
  counterparties: string[];
  dataSources: string[];
  outboundDestinations: string[];
  mcpServers: string[];
  actions: ObservedAgentAction[];
  prompts: ObservedAgentPrompt[];
  logs: ObservedAgentLog[];
};

export type AgentBehaviorEvidence = {
  source: string;
  line?: number;
  summary: string;
};

export type AgentBehaviorFinding = {
  findingId: string;
  severity: AgentBehaviorSeverity;
  summary: string;
  description: string;
  ruleIds: string[];
  evidence: AgentBehaviorEvidence[];
  recommendedActions: string[];
  confidence: "High" | "Medium" | "Low";
  tags: string[];
  relatedFindingIds: string[];
  escalation: "alert" | "log_only";
};

export type AgentBehaviorPositive = {
  title: string;
  description: string;
  evidence: string;
};

export type AgentRemitCoverageRule = AgentRemitRule & {
  status: AgentRemitRuleStatus;
  findingIds: string[];
  rationale: string;
};

export type AgentRemitCoverage = {
  statCounts: Record<AgentRemitRuleStatus, number> & { total: number };
  rules: AgentRemitCoverageRule[];
};

export type AgentBehaviorVerificationReport = {
  schemaVersion: "1.0";
  remit: Pick<AgentRemit, "remitId" | "workerName" | "mission" | "version">;
  inventory: Pick<
    AgentCapabilityInventory,
    "agentId" | "capabilities" | "channels" | "counterparties" | "dataSources" | "outboundDestinations"
  >;
  summary: {
    riskLevel: AgentBehaviorRiskLevel;
    findingCount: number;
    verifiedRuleCount: number;
    gapRuleCount: number;
  };
  remitCoverage: AgentRemitCoverage;
  findings: AgentBehaviorFinding[];
  positives: AgentBehaviorPositive[];
};

export type AgentDriftReport = {
  remitId: string;
  agentId: string;
  addedCapabilities: string[];
  removedCapabilities: string[];
  addedChannels: string[];
  removedChannels: string[];
  addedOutboundDestinations: string[];
  removedOutboundDestinations: string[];
  findings: AgentBehaviorFinding[];
};

type FindingDraft = Omit<AgentBehaviorFinding, "findingId">;

const SEVERITY_ORDER: Record<AgentBehaviorSeverity, number> = {
  Informational: 0,
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

export function createAgentRemit(input: AgentRemitInput): AgentRemit {
  const remitSeed = JSON.stringify({
    workerName: input.workerName,
    mission: input.mission,
    version: input.version ?? "1.0.0",
  });
  const remit: Omit<AgentRemit, "rules"> = {
    remitId: `remit:${createHash("sha256").update(remitSeed).digest("hex").slice(0, 16)}`,
    workerName: input.workerName,
    mission: input.mission,
    owner: input.owner,
    version: input.version ?? "1.0.0",
    updatedBy: input.updatedBy,
    allowedCapabilities: normalizeList(input.allowedCapabilities),
    restrictedCapabilities: normalizeList(input.restrictedCapabilities),
    forbiddenCapabilities: normalizeList(input.forbiddenCapabilities),
    approvedChannels: normalizeList(input.approvedChannels),
    authorizedCounterparties: normalizeList(input.authorizedCounterparties),
    allowedDataSources: normalizeList(input.allowedDataSources),
    allowedOutboundDestinations: normalizeList(input.allowedOutboundDestinations),
    approvalRequiredActions: normalizeList([
      ...(input.approvalRequiredActions ?? []),
      ...(input.restrictedCapabilities ?? []),
    ]),
    neverAllowedActions: normalizeList([
      ...(input.neverAllowedActions ?? []),
      ...(input.forbiddenCapabilities ?? []),
    ]),
    escalationRules: {
      halt: normalizeList(input.escalationRules?.halt),
      alert: normalizeList(input.escalationRules?.alert),
      logOnly: normalizeList(input.escalationRules?.logOnly),
    },
    knownGoodBaseline: {
      typicalToolInventory: normalizeList(input.knownGoodBaseline?.typicalToolInventory),
      typicalChannelsUsed: normalizeList(input.knownGoodBaseline?.typicalChannelsUsed),
      typicalOutboundDestinations: normalizeList(input.knownGoodBaseline?.typicalOutboundDestinations),
      typicalFilePathsAccessed: normalizeList(input.knownGoodBaseline?.typicalFilePathsAccessed),
    },
  };
  return { ...remit, rules: createRules(remit) };
}

export function inventoryAgentCapabilities(
  input: AgentCapabilityInventoryInput,
): AgentCapabilityInventory {
  return {
    agentId: input.agentId,
    repoRoot: input.repoRoot,
    capabilities: normalizeList(input.capabilities),
    channels: normalizeList(input.channels),
    counterparties: normalizeList(input.counterparties),
    dataSources: normalizeList(input.dataSources),
    outboundDestinations: normalizeList(input.outboundDestinations),
    mcpServers: normalizeList(input.mcpServers),
    actions: [...(input.actions ?? [])].sort(compareAction),
    prompts: [...(input.prompts ?? [])].sort((left, right) => left.path.localeCompare(right.path)),
    logs: [...(input.logs ?? [])].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function verifyAgentBehavior(input: {
  remit: AgentRemit;
  inventory: AgentCapabilityInventory;
}): AgentBehaviorVerificationReport {
  const drafts: FindingDraft[] = [];
  const coverageRules: AgentRemitCoverageRule[] = [];
  const findingKeys = new Set<string>();

  const addFinding = (key: string, draft: FindingDraft): string => {
    if (findingKeys.has(key)) {
      const existing = drafts.find((finding) => finding.summary === draft.summary);
      return existing ? provisionalFindingId(drafts.indexOf(existing)) : provisionalFindingId(drafts.length - 1);
    }
    findingKeys.add(key);
    drafts.push(draft);
    return provisionalFindingId(drafts.length - 1);
  };

  for (const rule of input.remit.rules) {
    const result = evaluateRule(rule, input.remit, input.inventory);
    const findingIds = result.findings.map((finding) =>
      addFinding(`${rule.ruleId}:${finding.summary}`, { ...finding, ruleIds: [rule.ruleId] }),
    );
    coverageRules.push({
      ...rule,
      status: result.status,
      findingIds,
      rationale: result.rationale,
    });
  }

  for (const prompt of input.inventory.prompts) {
    const granted = normalizeList(prompt.grantsCapabilities);
    const unauthorized = granted.filter((capability) => !authorizedCapabilities(input.remit).has(capability));
    for (const capability of unauthorized) {
      addFinding(`prompt:${prompt.path}:${capability}`, {
        severity: prompt.writable ? "High" : "Medium",
        summary: `Session-loaded prompt grants unauthorized capability: ${capability}`,
        description: `${prompt.path} is session-loaded and grants a capability outside the remit baseline.`,
        ruleIds: [],
        evidence: [
          {
            source: prompt.path,
            summary: prompt.writable
              ? "session-loaded writable prompt declares unauthorized capability"
              : "session-loaded prompt declares unauthorized capability",
          },
        ],
        recommendedActions: [
          "Remove the capability grant from the session-loaded prompt or add an explicit operator-approved remit rule.",
        ],
        confidence: "High",
        tags: ["secondary-prompt", "capability-drift"],
        relatedFindingIds: [],
        escalation: "alert",
      });
    }
  }

  const findings = assignFindingIds(drafts);
  addCompoundFindings(findings);
  const finalFindings = assignFindingIds(findings.map(({ findingId: _findingId, ...finding }) => finding));
  const coverage = createCoverage(coverageRules);
  const positives = createPositives(input.inventory, finalFindings);
  const riskLevel = riskLevelFor(finalFindings);

  return {
    schemaVersion: "1.0",
    remit: {
      remitId: input.remit.remitId,
      workerName: input.remit.workerName,
      mission: input.remit.mission,
      version: input.remit.version,
    },
    inventory: {
      agentId: input.inventory.agentId,
      capabilities: input.inventory.capabilities,
      channels: input.inventory.channels,
      counterparties: input.inventory.counterparties,
      dataSources: input.inventory.dataSources,
      outboundDestinations: input.inventory.outboundDestinations,
    },
    summary: {
      riskLevel,
      findingCount: finalFindings.length,
      verifiedRuleCount: coverage.statCounts.verified,
      gapRuleCount: coverage.statCounts.gap,
    },
    remitCoverage: coverage,
    findings: finalFindings,
    positives,
  };
}

export function analyzeAgentDrift(input: {
  remit: AgentRemit;
  currentInventory: AgentCapabilityInventory;
}): AgentDriftReport {
  const baseline = input.remit.knownGoodBaseline;
  const addedCapabilities = difference(
    input.currentInventory.capabilities,
    normalizeList(baseline.typicalToolInventory),
  );
  const removedCapabilities = difference(
    normalizeList(baseline.typicalToolInventory),
    input.currentInventory.capabilities,
  );
  const addedChannels = difference(
    input.currentInventory.channels,
    normalizeList(baseline.typicalChannelsUsed),
  );
  const removedChannels = difference(
    normalizeList(baseline.typicalChannelsUsed),
    input.currentInventory.channels,
  );
  const addedOutboundDestinations = difference(
    input.currentInventory.outboundDestinations,
    normalizeList(baseline.typicalOutboundDestinations),
  );
  const removedOutboundDestinations = difference(
    normalizeList(baseline.typicalOutboundDestinations),
    input.currentInventory.outboundDestinations,
  );
  const drafts: FindingDraft[] = [];

  if (addedCapabilities.length > 0) {
    drafts.push(createDriftFinding("High", `Capability drift from known-good baseline: ${addedCapabilities.join(", ")}`));
  }
  if (addedChannels.length > 0) {
    drafts.push(createDriftFinding("Medium", `Channel drift from known-good baseline: ${addedChannels.join(", ")}`));
  }
  if (addedOutboundDestinations.length > 0) {
    drafts.push(
      createDriftFinding(
        "Medium",
        `Outbound destination drift from known-good baseline: ${addedOutboundDestinations.join(", ")}`,
      ),
    );
  }

  return {
    remitId: input.remit.remitId,
    agentId: input.currentInventory.agentId,
    addedCapabilities,
    removedCapabilities,
    addedChannels,
    removedChannels,
    addedOutboundDestinations,
    removedOutboundDestinations,
    findings: assignFindingIds(drafts, "WH-DRIFT"),
  };
}

export function createRemitCoverageReport(report: AgentBehaviorVerificationReport): {
  statCounts: AgentRemitCoverage["statCounts"];
  markdown: string;
} {
  const lines = [
    "# Remit Coverage",
    "",
    `Verified: ${report.remitCoverage.statCounts.verified}`,
    `Gaps: ${report.remitCoverage.statCounts.gap}`,
    `Partial: ${report.remitCoverage.statCounts.partial}`,
    `Vague: ${report.remitCoverage.statCounts.vague}`,
    `Enforcement not possible: ${report.remitCoverage.statCounts.enforcement_not_possible}`,
    "",
    ...report.remitCoverage.rules.map(
      (rule) => `- ${rule.ruleId} [${rule.status}] ${rule.text}`,
    ),
  ];
  return {
    statCounts: report.remitCoverage.statCounts,
    markdown: lines.join("\n"),
  };
}

export function renderBehaviorFindings(report: AgentBehaviorVerificationReport): string {
  const lines = [
    "# Agent Behavior Verification Report",
    "",
    `Agent: ${report.inventory.agentId}`,
    `Remit: ${report.remit.workerName} (${report.remit.version})`,
    `Risk: ${report.summary.riskLevel}`,
    "",
    "## Remit Coverage",
    "",
    `- Verified: ${report.remitCoverage.statCounts.verified}`,
    `- Gaps: ${report.remitCoverage.statCounts.gap}`,
    `- Partial: ${report.remitCoverage.statCounts.partial}`,
    `- Vague: ${report.remitCoverage.statCounts.vague}`,
    `- Enforcement not possible: ${report.remitCoverage.statCounts.enforcement_not_possible}`,
    "",
    ...report.remitCoverage.rules.map(
      (rule) => `- ${rule.ruleId} [${rule.status}] ${rule.text}`,
    ),
    "",
    "## Findings",
    "",
    ...(report.findings.length > 0
      ? report.findings.flatMap((finding) => [
          `### ${finding.findingId} ${finding.severity}`,
          "",
          finding.summary,
          "",
          `Evidence: ${finding.evidence.map(formatEvidence).join("; ")}`,
          `Recommended: ${finding.recommendedActions.join(" ")}`,
          "",
        ])
      : ["No findings.", ""]),
    "## Positives",
    "",
    ...(report.positives.length > 0
      ? report.positives.map((positive) => `- ${positive.title}: ${positive.description}`)
      : ["No verified positives recorded."]),
    "",
  ];
  return lines.join("\n");
}

function createRules(remit: Omit<AgentRemit, "rules">): AgentRemitRule[] {
  const rules: Omit<AgentRemitRule, "ruleId">[] = [];
  const capabilityBaseline = normalizeList([...remit.allowedCapabilities, ...remit.restrictedCapabilities]);
  if (capabilityBaseline.length > 0) {
    rules.push({
      section: "Tools and Capabilities",
      kind: "capability_baseline",
      text: `Runtime capabilities must stay within the approved baseline: ${capabilityBaseline.join(", ")}.`,
      values: capabilityBaseline,
    });
  }
  if (remit.approvalRequiredActions.length > 0) {
    rules.push({
      section: "Action Boundaries",
      kind: "approval_required",
      text: `These actions require human approval before execution: ${remit.approvalRequiredActions.join(", ")}.`,
      values: remit.approvalRequiredActions,
    });
  }
  if (remit.forbiddenCapabilities.length > 0) {
    rules.push({
      section: "Tools and Capabilities",
      kind: "forbidden_capability",
      text: `These capabilities are forbidden: ${remit.forbiddenCapabilities.join(", ")}.`,
      values: remit.forbiddenCapabilities,
    });
  }
  if (remit.approvedChannels.length > 0) {
    rules.push({
      section: "Approved Communication Channels",
      kind: "approved_channel",
      text: `Communication channels must stay within: ${remit.approvedChannels.join(", ")}.`,
      values: remit.approvedChannels,
    });
  }
  if (remit.authorizedCounterparties.length > 0) {
    rules.push({
      section: "Authorized Counterparties",
      kind: "authorized_counterparty",
      text: `Counterparties must stay within: ${remit.authorizedCounterparties.join(", ")}.`,
      values: remit.authorizedCounterparties,
    });
  }
  if (remit.allowedDataSources.length > 0) {
    rules.push({
      section: "Data Boundaries",
      kind: "allowed_data_source",
      text: `Data sources must stay within: ${remit.allowedDataSources.join(", ")}.`,
      values: remit.allowedDataSources,
    });
  }
  if (remit.allowedOutboundDestinations.length > 0) {
    rules.push({
      section: "Known Good Baseline",
      kind: "allowed_outbound_destination",
      text: `Outbound destinations must stay within: ${remit.allowedOutboundDestinations.join(", ")}.`,
      values: remit.allowedOutboundDestinations,
    });
  }
  if (remit.neverAllowedActions.length > 0) {
    rules.push({
      section: "Action Boundaries",
      kind: "never_allowed_action",
      text: `These actions are never allowed: ${remit.neverAllowedActions.join(", ")}.`,
      values: remit.neverAllowedActions,
    });
  }
  return rules.map((rule, index) => ({
    ...rule,
    ruleId: `R-${String(index + 1).padStart(3, "0")}`,
  }));
}

function evaluateRule(
  rule: AgentRemitRule,
  remit: AgentRemit,
  inventory: AgentCapabilityInventory,
): {
  status: AgentRemitRuleStatus;
  rationale: string;
  findings: FindingDraft[];
} {
  if (rule.values.length === 0) {
    return { status: "vague", rationale: "Rule has no concrete values to verify.", findings: [] };
  }

  switch (rule.kind) {
    case "capability_baseline":
      return evaluateAllowedSet(rule, inventory.capabilities, "capability", "Undeclared capability observed");
    case "approval_required":
      return evaluateApprovalRule(rule, inventory);
    case "forbidden_capability":
      return evaluateForbiddenSet(rule, inventory.capabilities, "capability", "Forbidden capability observed");
    case "approved_channel":
      return evaluateAllowedSet(rule, inventory.channels, "channel", "Undeclared channel observed");
    case "authorized_counterparty":
      return evaluateAllowedSet(rule, inventory.counterparties, "counterparty", "Unauthorized counterparty observed");
    case "allowed_data_source":
      return evaluateAllowedSet(rule, inventory.dataSources, "data source", "Unauthorized data source observed");
    case "allowed_outbound_destination":
      return evaluateAllowedSet(
        rule,
        inventory.outboundDestinations,
        "outbound destination",
        "Undeclared outbound destination observed",
      );
    case "never_allowed_action":
      return evaluateForbiddenSet(
        rule,
        inventory.actions.map((action) => action.action),
        "action",
        "Never-allowed action observed",
      );
    default:
      return { status: "enforcement_not_possible", rationale: "Unknown rule kind.", findings: [] };
  }
}

function evaluateAllowedSet(
  rule: AgentRemitRule,
  observed: string[],
  label: string,
  summaryPrefix: string,
): {
  status: AgentRemitRuleStatus;
  rationale: string;
  findings: FindingDraft[];
} {
  if (observed.length === 0) {
    return {
      status: "enforcement_not_possible",
      rationale: `No observed ${label} inventory was supplied.`,
      findings: [],
    };
  }
  const unexpected = difference(observed, rule.values);
  const missing = difference(rule.values, observed);
  const findings = unexpected.map((value) =>
    createFinding("High", `${summaryPrefix}: ${value}`, `${value} is outside the declared remit.`),
  );
  if (unexpected.length > 0) {
    return {
      status: "gap",
      rationale: `Observed ${label} values outside the remit: ${unexpected.join(", ")}.`,
      findings,
    };
  }
  if (missing.length > 0) {
    return {
      status: "partial",
      rationale: `Approved ${label} values were not observed: ${missing.join(", ")}.`,
      findings: [],
    };
  }
  return {
    status: "verified",
    rationale: `Observed ${label} values match the remit.`,
    findings: [],
  };
}

function evaluateForbiddenSet(
  rule: AgentRemitRule,
  observed: string[],
  label: string,
  summaryPrefix: string,
): {
  status: AgentRemitRuleStatus;
  rationale: string;
  findings: FindingDraft[];
} {
  const present = intersection(observed, rule.values);
  if (present.length === 0) {
    return {
      status: "verified",
      rationale: `No forbidden ${label} values were observed.`,
      findings: [],
    };
  }
  return {
    status: "gap",
    rationale: `Forbidden ${label} values were observed: ${present.join(", ")}.`,
    findings: present.map((value) =>
      createFinding("Critical", `${summaryPrefix}: ${value}`, `${value} is explicitly forbidden by the remit.`),
    ),
  };
}

function evaluateApprovalRule(
  rule: AgentRemitRule,
  inventory: AgentCapabilityInventory,
): {
  status: AgentRemitRuleStatus;
  rationale: string;
  findings: FindingDraft[];
} {
  const relevantActions = inventory.actions.filter((action) => rule.values.includes(action.action));
  const unapproved = relevantActions.filter((action) => action.approvalObserved !== true);
  if (unapproved.length === 0) {
    return {
      status: "verified",
      rationale:
        relevantActions.length > 0
          ? "Restricted actions include approval evidence."
          : "No unapproved restricted action was observed.",
      findings: [],
    };
  }
  return {
    status: "gap",
    rationale: `Restricted actions ran without approval evidence: ${unapproved.map((action) => action.action).join(", ")}.`,
    findings: unapproved.map((action) => ({
      severity: "High",
      summary: `Restricted action ran without approval: ${action.action}`,
      description: `${action.action} requires human approval before execution.`,
      ruleIds: [],
      evidence: [
        {
          source: action.source ?? "action-observation",
          line: action.line,
          summary: action.summary ?? "restricted action lacks approval evidence",
        },
      ],
      recommendedActions: [
        `Require explicit approval evidence before ${action.action} can run, or remove it from the restricted action list.`,
      ],
      confidence: "High",
      tags: ["approval-gap"],
      relatedFindingIds: [],
      escalation: "alert",
    })),
  };
}

function createFinding(
  severity: AgentBehaviorSeverity,
  summary: string,
  description: string,
): FindingDraft {
  return {
    severity,
    summary,
    description,
    ruleIds: [],
    evidence: [{ source: "capability-inventory", summary }],
    recommendedActions: ["Align the implementation with the remit or update the remit with explicit operator approval."],
    confidence: "High",
    tags: ["remit-divergence"],
    relatedFindingIds: [],
    escalation: severity === "Critical" || severity === "High" ? "alert" : "log_only",
  };
}

function createDriftFinding(severity: AgentBehaviorSeverity, summary: string): FindingDraft {
  return {
    severity,
    summary,
    description: "The current inventory differs from the remit known-good baseline.",
    ruleIds: [],
    evidence: [{ source: "known-good-baseline", summary }],
    recommendedActions: ["Review whether this is intentional drift, then update the remit or remove the capability."],
    confidence: "High",
    tags: ["drift"],
    relatedFindingIds: [],
    escalation: severity === "High" || severity === "Critical" ? "alert" : "log_only",
  };
}

function addCompoundFindings(findings: AgentBehaviorFinding[]): void {
  const unapprovedExec = findings.find((finding) =>
    finding.summary.startsWith("Restricted action ran without approval"),
  );
  const externalExpansion = findings.find(
    (finding) =>
      finding.summary.startsWith("Undeclared channel observed") ||
      finding.summary.startsWith("Undeclared outbound destination observed") ||
      finding.summary.startsWith("Session-loaded prompt grants unauthorized capability"),
  );
  if (!unapprovedExec || !externalExpansion) {
    return;
  }
  findings.push({
    findingId: provisionalFindingId(findings.length),
    severity: "Critical",
    summary: "Compound behavior chain: unapproved execution plus external expansion",
    description:
      "The inventory shows both unapproved execution and expansion into an undeclared communication or outbound surface.",
    ruleIds: [...new Set([...unapprovedExec.ruleIds, ...externalExpansion.ruleIds])],
    evidence: [
      ...unapprovedExec.evidence,
      ...externalExpansion.evidence,
    ],
    recommendedActions: [
      "Block unapproved execution until approval evidence is enforced and remove undeclared external surfaces.",
    ],
    confidence: "High",
    tags: ["compound-risk", "approval-gap", "capability-drift"],
    relatedFindingIds: [unapprovedExec.findingId, externalExpansion.findingId],
    escalation: "alert",
  });
}

function createCoverage(rules: AgentRemitCoverageRule[]): AgentRemitCoverage {
  const statCounts: AgentRemitCoverage["statCounts"] = {
    verified: 0,
    gap: 0,
    partial: 0,
    vague: 0,
    enforcement_not_possible: 0,
    total: rules.length,
  };
  for (const rule of rules) {
    statCounts[rule.status] += 1;
  }
  return { statCounts, rules };
}

function createPositives(
  inventory: AgentCapabilityInventory,
  findings: AgentBehaviorFinding[],
): AgentBehaviorPositive[] {
  const positives: AgentBehaviorPositive[] = [];
  if (inventory.logs.length > 0) {
    positives.push({
      title: "Action log discovered",
      description: "The inventory includes logs that can support runtime behavior review.",
      evidence: inventory.logs.map((log) => log.path).join(", "),
    });
  }
  if (!findings.some((finding) => finding.summary.startsWith("Forbidden capability observed"))) {
    positives.push({
      title: "No forbidden capability observed",
      description: "The current capability inventory does not include explicitly forbidden capabilities.",
      evidence: "capability-inventory",
    });
  }
  return positives;
}

function assignFindingIds(drafts: FindingDraft[], prefix = "WH-ABV"): AgentBehaviorFinding[] {
  return drafts.map((draft, index) => ({
    ...draft,
    findingId: `${prefix}-${String(index + 1).padStart(3, "0")}`,
  }));
}

function provisionalFindingId(index: number): string {
  return `WH-ABV-${String(index + 1).padStart(3, "0")}`;
}

function riskLevelFor(findings: AgentBehaviorFinding[]): AgentBehaviorRiskLevel {
  const maxSeverity = findings.reduce<AgentBehaviorSeverity>(
    (max, finding) =>
      SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[max] ? finding.severity : max,
    "Informational",
  );
  if (maxSeverity === "Critical") {
    return "critical";
  }
  if (maxSeverity === "High") {
    return "high";
  }
  if (maxSeverity === "Medium") {
    return "medium";
  }
  return "low";
}

function authorizedCapabilities(remit: AgentRemit): Set<string> {
  return new Set([...remit.allowedCapabilities, ...remit.restrictedCapabilities]);
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return normalizeList(left.filter((value) => !rightSet.has(value)));
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return normalizeList(left.filter((value) => rightSet.has(value)));
}

function compareAction(left: ObservedAgentAction, right: ObservedAgentAction): number {
  const actionCompare = left.action.localeCompare(right.action);
  if (actionCompare !== 0) {
    return actionCompare;
  }
  return (left.source ?? "").localeCompare(right.source ?? "");
}

function formatEvidence(evidence: AgentBehaviorEvidence): string {
  const location = evidence.line ? `${evidence.source}:${evidence.line}` : evidence.source;
  return `${location} - ${evidence.summary}`;
}
