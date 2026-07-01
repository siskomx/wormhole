import type { AgentToolCall } from "./agent-routing.js";

export type WorkflowIntent =
  | "repo_onboarding"
  | "feature_implementation"
  | "bug_fix"
  | "code_review"
  | "large_repo_query"
  | "feature"
  | "bug"
  | "review";

export type ToolContract = {
  toolName: string;
  consumes: string[];
  produces: string[];
  sideEffect: "none" | "repo_write" | "runtime_write" | "command";
  requiresEvidence?: string[];
};

export type PlannedWorkflowStage = {
  name: string;
  purpose: string;
  tools: ToolContract[];
  toolCalls: AgentToolCall[];
  produces: string[];
  requiredEvidence: string[];
};

export type PlannedWorkflow = {
  intent: WorkflowIntent;
  reviewOnly: boolean;
  stages: PlannedWorkflowStage[];
  missingInputs: string[];
  stopRules: string[];
};

export type PlanWorkflowInput = {
  objective: string;
  repoRoot?: string;
  query?: string;
  changedFiles?: string[];
  observedFailure?: boolean | string;
  reviewOnly?: boolean;
  intent?: WorkflowIntent;
};

const TOOL_CONTRACTS: Record<string, ToolContract> = {
  project_onboard: contract("project_onboard", [], ["repo_map", "project_commands", "index_status"], "none", [
    "repo_map",
    "project_commands",
  ]),
  repo_intelligence_search: contract(
    "repo_intelligence_search",
    ["objective", "query"],
    ["source_paths", "semantic_results"],
    "none",
    ["source_paths", "semantic_results"],
  ),
  repo_relation_query: contract("repo_relation_query", ["source_paths"], ["relation_paths"], "none", [
    "relation_paths",
  ]),
  change_impact_analyze: contract("change_impact_analyze", ["changed_files"], ["impact_analysis", "relation_paths"], "none", [
    "impact_analysis",
    "relation_paths",
  ]),
  context_pack_generate: contract("context_pack_generate", ["source_paths", "objective"], ["context_pack"], "none", [
    "source_paths",
  ]),
  diagnostics_from_command: contract("diagnostics_from_command", ["observed_failure"], ["diagnostics"], "command", [
    "diagnostics",
    "reproduction",
  ]),
  test_plan_select: contract("test_plan_select", ["impact_analysis"], ["test_plan"], "none", ["impact_analysis"]),
  verification_run: contract("verification_run", ["test_plan"], ["verification_output"], "command", [
    "verification_output",
  ]),
  record_evidence: contract("record_evidence", ["source_paths", "verification_output"], ["evidence_record"], "runtime_write", [
    "source_paths",
  ]),
  gate_request: contract("gate_request", ["evidence_record"], ["gate_decision"], "runtime_write", ["gate_decision"]),
  patch_checkpoint: contract("patch_checkpoint", ["context_pack"], ["patch_checkpoint"], "runtime_write", [
    "implementation_diff",
  ]),
  patch_apply: contract("patch_apply", ["patch_checkpoint"], ["implementation_diff"], "repo_write", [
    "implementation_diff",
  ]),
  diff_scope_review: contract("diff_scope_review", ["implementation_diff"], ["diff_findings"], "none", [
    "diff_findings",
  ]),
  test_quality_review: contract("test_quality_review", ["verification_output"], ["test_quality_findings"], "none", [
    "verification_output",
  ]),
};

export function planWorkflow(input: PlanWorkflowInput): PlannedWorkflow {
  const intent = normalizeIntent(input);
  const reviewOnly = input.reviewOnly === true || intent === "code_review" || intent === "review";
  const missingInputs = input.repoRoot ? [] : ["repoRoot"];
  const changedFiles = normalizeChangedFiles(input.changedFiles);
  const baseInput = routeInput(input, changedFiles);

  const stages =
    intent === "large_repo_query"
      ? largeRepoQueryStages(baseInput)
      : intent === "bug" || intent === "bug_fix"
        ? bugStages(baseInput, input.observedFailure)
        : reviewOnly
          ? reviewStages(baseInput)
          : featureStages(baseInput);

  return {
    intent,
    reviewOnly,
    stages,
    missingInputs,
    stopRules: [
      "Stop when required inputs are missing and no safe assumption exists.",
      "Stop when verification fails unless the next step is an explicit debugging loop.",
      "Stop when gate_request reports missing evidence that cannot be produced by the planned tools.",
    ],
  };
}

function bugStages(input: AgentToolCall["input"], observedFailure: boolean | string | undefined): PlannedWorkflowStage[] {
  const diagnosticsInput = {
    ...input,
    ...(typeof observedFailure === "string" ? { commandOutput: observedFailure } : {}),
  };
  return [
    stage("diagnostics", "Capture the observed failure before changing code.", ["diagnostics_from_command"], diagnosticsInput),
    stage("change_impact", "Find relation-backed impact and likely tests.", ["change_impact_analyze"], input),
    stage("context", "Build bounded task context from source-backed results.", ["context_pack_generate"], input),
    stage("verification", "Select and run focused verification.", ["test_plan_select", "verification_run"], input),
    stage("evidence", "Record the evidence needed for final claims.", ["record_evidence"], input),
    stage("gate", "Ask the Wormhole gate to validate evidence sufficiency.", ["gate_request"], input),
  ];
}

function reviewStages(input: AgentToolCall["input"]): PlannedWorkflowStage[] {
  return [
    stage("impact", "Constrain the review surface using relation-backed impact.", ["change_impact_analyze"], input),
    stage("context", "Build bounded review context.", ["context_pack_generate"], input),
    stage("review", "Review diff scope and test quality without applying patches.", ["diff_scope_review", "test_quality_review"], input),
    stage("evidence", "Record review findings and source evidence.", ["record_evidence"], input),
    stage("gate", "Check evidence sufficiency before final review claims.", ["gate_request"], input),
  ];
}

function largeRepoQueryStages(input: AgentToolCall["input"]): PlannedWorkflowStage[] {
  return [
    stage("search", "Use hybrid and relation-aware search before broad context.", [
      "repo_intelligence_search",
      "repo_relation_query",
    ], input),
    stage("context", "Render a bounded context pack from search evidence.", ["context_pack_generate"], input),
    stage("evidence", "Record the search and context evidence.", ["record_evidence"], input),
    stage("gate", "Check evidence sufficiency before answering.", ["gate_request"], input),
  ];
}

function featureStages(input: AgentToolCall["input"]): PlannedWorkflowStage[] {
  return [
    stage("orient", "Collect repo facts and task-specific search context.", ["project_onboard", "repo_intelligence_search"], input),
    stage("impact", "Find relation-backed impact before editing.", ["change_impact_analyze"], input),
    stage("context", "Build bounded implementation context.", ["context_pack_generate"], input),
    stage("patch", "Create and apply an auditable patch.", ["patch_checkpoint", "patch_apply"], input),
    stage("verification", "Select and run focused verification.", ["test_plan_select", "verification_run"], input),
    stage("evidence", "Record implementation and verification evidence.", ["record_evidence"], input),
    stage("gate", "Check evidence sufficiency before final claims.", ["gate_request"], input),
  ];
}

function stage(
  name: string,
  purpose: string,
  toolNames: string[],
  input: AgentToolCall["input"],
): PlannedWorkflowStage {
  const tools = toolNames.map((toolName) => {
    const tool = TOOL_CONTRACTS[toolName];
    if (!tool) {
      throw new Error(`Unknown workflow tool contract: ${toolName}`);
    }
    return cloneContract(tool);
  });
  return {
    name,
    purpose,
    tools,
    toolCalls: tools.map((tool) => toolCall(tool, input)),
    produces: unique(tools.flatMap((tool) => tool.produces)),
    requiredEvidence: unique(tools.flatMap((tool) => tool.requiresEvidence ?? [])),
  };
}

function toolCall(tool: ToolContract, input: AgentToolCall["input"]): AgentToolCall {
  return {
    toolName: tool.toolName,
    priority: tool.sideEffect === "repo_write" ? 70 : 85,
    reason: `Workflow planner selected ${tool.toolName} to produce ${tool.produces.join(", ")}.`,
    input,
  };
}

function normalizeIntent(input: PlanWorkflowInput): WorkflowIntent {
  if (input.intent) {
    if (input.intent === "bug_fix") {
      return "bug";
    }
    if (input.intent === "feature_implementation") {
      return "feature";
    }
    if (input.intent === "code_review") {
      return "review";
    }
    return input.intent;
  }
  if (input.reviewOnly === true || /\b(review|audit|inspect)\b/i.test(input.objective)) {
    return "review";
  }
  if (input.observedFailure || /\b(bug|fix|failure|failing|regression|timeout|crash)\b/i.test(input.objective)) {
    return "bug";
  }
  if (/\b(where|find|map|explain|trace|locate|search)\b/i.test(input.objective)) {
    return "large_repo_query";
  }
  if (/\b(onboard|orientation|repo map)\b/i.test(input.objective)) {
    return "repo_onboarding";
  }
  return "feature";
}

function routeInput(input: PlanWorkflowInput, changedFiles: string[]): AgentToolCall["input"] {
  return {
    ...(input.repoRoot ? { repoRoot: input.repoRoot } : {}),
    objective: input.objective,
    query: input.query ?? input.objective,
    changedFiles,
  };
}

function contract(
  toolName: string,
  consumes: string[],
  produces: string[],
  sideEffect: ToolContract["sideEffect"],
  requiresEvidence: string[],
): ToolContract {
  return {
    toolName,
    consumes,
    produces,
    sideEffect,
    requiresEvidence,
  };
}

function cloneContract(tool: ToolContract): ToolContract {
  return {
    ...tool,
    consumes: [...tool.consumes],
    produces: [...tool.produces],
    ...(tool.requiresEvidence ? { requiresEvidence: [...tool.requiresEvidence] } : {}),
  };
}

function normalizeChangedFiles(changedFiles: string[] | undefined): string[] {
  return [...new Set((changedFiles ?? []).map((file) => file.replace(/\\/g, "/").replace(/^\.\//, "")))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
