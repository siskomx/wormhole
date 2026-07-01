export const EVIDENCE_REQUIREMENT_IDS = [
  "source_paths",
  "implementation_diff",
  "verification_output",
  "gate_decision",
  "reproduction",
  "diagnostics",
  "changed_files",
  "diff_findings",
  "risk_assessment",
  "impact_analysis",
  "repo_map",
  "entrypoints",
  "project_commands",
  "index_status",
  "semantic_results",
  "domain_results",
  "relation_paths",
  "repo_facts_fresh",
] as const;

export type EvidenceRequirementId = (typeof EVIDENCE_REQUIREMENT_IDS)[number];

export type EvidenceRequirement = {
  readonly id: EvidenceRequirementId;
  readonly label: string;
  readonly description: string;
  readonly evidenceKinds: readonly string[];
  readonly recommendedTools: readonly string[];
  readonly satisfiedByTools: readonly string[];
  readonly requiredFor: readonly string[];
};

export type EvidenceRequirementRecord = {
  readonly kind?: string;
  readonly toolName?: string;
  readonly freshness?: string;
  readonly summary?: string;
  readonly metadata?: Record<string, unknown>;
};

export type EvaluateEvidenceRequirementsInput = {
  readonly required?: readonly EvidenceRequirementId[];
  readonly evidenceKinds?: readonly string[];
  readonly evidence?: readonly EvidenceRequirementRecord[];
  readonly completedTools?: readonly string[];
};

export type EvidenceRequirementEvaluation = {
  readonly id: EvidenceRequirementId;
  readonly requirement: EvidenceRequirement;
  readonly satisfied: boolean;
  readonly satisfiedBy: readonly string[];
  readonly recommendedTools: readonly string[];
  readonly message: string;
};

export type EvidenceRequirementEvaluationResult = {
  readonly satisfied: boolean;
  readonly requirements: readonly EvidenceRequirementEvaluation[];
  readonly missingRequirements: readonly EvidenceRequirementId[];
  readonly recommendedTools: readonly string[];
  readonly satisfiedRequirementIds: readonly EvidenceRequirementId[];
  readonly recommendations: readonly string[];
};

const RELATION_PATH_TOOLS = ["repo_relation_query", "change_impact_analyze"] as const;
const FRESH_REPO_FACT_KINDS = ["repo_facts", "repo_fact_graph", "repo_facts_fresh", "repo_index_facts"] as const;

const REQUIREMENTS = freezeRequirements([
  requirement(
    "source_paths",
    "Source Paths",
    "Current source files or symbols relevant to the task are identified.",
    ["source_paths", "source_path", "symbol_context"],
    ["repo_intelligence_search", "context_pack_generate"],
  ),
  requirement(
    "implementation_diff",
    "Implementation Diff",
    "The proposed code change is captured as an inspectable diff.",
    ["implementation_diff", "patch_diff", "diff"],
    ["patch_checkpoint", "diff_scope_review"],
  ),
  requirement(
    "verification_output",
    "Verification Output",
    "Verification command output is recorded after selecting the relevant test plan.",
    ["verification_output", "test_output", "verification_run"],
    ["test_plan_select", "verification_run"],
  ),
  requirement(
    "gate_decision",
    "Gate Decision",
    "A gate decision has been requested or recorded for the current work.",
    ["gate_decision", "gate_result"],
    ["gate_request"],
  ),
  requirement(
    "reproduction",
    "Reproduction",
    "The failure or target behavior has a concrete reproduction record.",
    ["reproduction", "failing_test", "bug_reproduction"],
    ["diagnostics_from_command", "diagnostics_record"],
  ),
  requirement(
    "diagnostics",
    "Diagnostics",
    "Diagnostic output is captured before applying a fix.",
    ["diagnostics", "lsp_diagnostics", "command_diagnostics"],
    ["diagnostics_from_command", "diagnostics_from_lsp"],
  ),
  requirement(
    "changed_files",
    "Changed Files",
    "The changed file set has been identified for review or impact analysis.",
    ["changed_files", "diff_files"],
    ["diff_scope_review"],
  ),
  requirement(
    "diff_findings",
    "Diff Findings",
    "Review findings or explicit no-findings evidence has been recorded for the diff.",
    ["diff_findings", "review_findings"],
    ["diff_scope_review", "test_quality_review"],
  ),
  requirement(
    "risk_assessment",
    "Risk Assessment",
    "Behavioral and regression risk have been assessed for the change.",
    ["risk_assessment", "impact_risk", "blast_radius"],
    ["change_impact_analyze", "test_impact_analyze_v2"],
  ),
  requirement(
    "impact_analysis",
    "Impact Analysis",
    "Relation-aware changed-file impact analysis has been produced for the task.",
    ["impact_analysis", "change_impact", "blast_radius"],
    ["change_impact_analyze"],
  ),
  requirement(
    "repo_map",
    "Repo Map",
    "Repository structure and primary modules are known.",
    ["repo_map", "architecture_map"],
    ["project_onboard", "architecture_map"],
  ),
  requirement(
    "entrypoints",
    "Entrypoints",
    "Entrypoints or request flows are identified.",
    ["entrypoints", "entrypoint_flow"],
    ["entrypoint_flow_discover"],
  ),
  requirement(
    "project_commands",
    "Project Commands",
    "Build, test, lint, or run commands are known from the repository.",
    ["project_commands", "command_map"],
    ["project_command_map", "project_onboard"],
  ),
  requirement(
    "index_status",
    "Index Status",
    "The durable repository index status is known.",
    ["index_status", "durable_index_status"],
    ["durable_index_status", "durable_repo_index_refresh"],
  ),
  requirement(
    "semantic_results",
    "Semantic Results",
    "Semantic search or graph-node semantic results support the current context.",
    ["semantic_results", "semantic_search_results", "graph_node_semantic_results"],
    ["repo_intelligence_search", "graph_node_semantic_search"],
  ),
  requirement(
    "domain_results",
    "Domain Results",
    "Domain index results support the current context when domain indexing is available.",
    ["domain_results", "domain_slice_results", "domain_api_results", "domain_table_results"],
    ["domain_slice_query", "domain_api_query", "domain_table_query"],
  ),
  requirement(
    "relation_paths",
    "Relation Paths",
    "Repo relation paths connect the target files, symbols, tests, or impacted callers.",
    ["relation_paths", "repo_relations", "change_impact"],
    [...RELATION_PATH_TOOLS],
  ),
  requirement(
    "repo_facts_fresh",
    "Fresh Repo Facts",
    "Repo facts are derived from a durable refresh and are marked fresh.",
    [...FRESH_REPO_FACT_KINDS],
    ["durable_repo_index_refresh"],
  ),
]);

export function listEvidenceRequirements(): EvidenceRequirement[] {
  return REQUIREMENTS.map(cloneRequirement);
}

export function evaluateEvidenceRequirements(
  input: EvaluateEvidenceRequirementsInput,
): EvidenceRequirementEvaluationResult {
  const required = input.required ?? EVIDENCE_REQUIREMENT_IDS;
  const completedTools = new Set(input.completedTools ?? []);
  const evidence = [
    ...(input.evidence ?? []),
    ...(input.evidenceKinds ?? []).map((kind) => ({ kind })),
  ];
  const evaluations = required.map((id) => evaluateRequirement(requirementById(id), evidence, completedTools));
  const missingRequirements = evaluations
    .filter((evaluation) => !evaluation.satisfied)
    .map((evaluation) => evaluation.id);
  const recommendedTools = unique(evaluations.flatMap((evaluation) => evaluation.recommendedTools));

  return {
    satisfied: missingRequirements.length === 0,
    requirements: evaluations,
    missingRequirements,
    recommendedTools,
    satisfiedRequirementIds: evaluations
      .filter((evaluation) => evaluation.satisfied)
      .map((evaluation) => evaluation.id),
    recommendations: recommendedTools,
  };
}

function evaluateRequirement(
  requirementDefinition: EvidenceRequirement,
  evidence: readonly EvidenceRequirementRecord[],
  completedTools: Set<string>,
): EvidenceRequirementEvaluation {
  if (requirementDefinition.id === "relation_paths") {
    return evaluateRelationPaths(requirementDefinition, evidence, completedTools);
  }
  if (requirementDefinition.id === "repo_facts_fresh") {
    return evaluateFreshRepoFacts(requirementDefinition, evidence, completedTools);
  }

  const satisfiedBy = evidence
    .filter((record) => record.kind && requirementDefinition.evidenceKinds.includes(record.kind))
    .map((record) => `evidence:${record.kind}`);
  const satisfied = satisfiedBy.length > 0;

  return {
    id: requirementDefinition.id,
    requirement: cloneRequirement(requirementDefinition),
    satisfied,
    satisfiedBy,
    recommendedTools: satisfied ? [] : [...requirementDefinition.recommendedTools],
    message: satisfied
      ? `${requirementDefinition.id} satisfied by recorded evidence.`
      : `${requirementDefinition.id} is missing required evidence.`,
  };
}

function evaluateRelationPaths(
  requirementDefinition: EvidenceRequirement,
  evidence: readonly EvidenceRequirementRecord[],
  completedTools: Set<string>,
): EvidenceRequirementEvaluation {
  const satisfiedBy = [
    ...RELATION_PATH_TOOLS.filter((toolName) => completedTools.has(toolName)).map((toolName) => `tool:${toolName}`),
    ...evidence.flatMap((record) => {
      const matches: string[] = [];
      if (record.toolName && RELATION_PATH_TOOLS.includes(record.toolName as (typeof RELATION_PATH_TOOLS)[number])) {
        matches.push(`tool:${record.toolName}`);
      }
      if (record.kind && requirementDefinition.evidenceKinds.includes(record.kind)) {
        matches.push(`evidence:${record.kind}`);
      }
      return matches;
    }),
  ];
  const uniqueSatisfiedBy = unique(satisfiedBy);
  const satisfied = uniqueSatisfiedBy.length > 0;

  return {
    id: requirementDefinition.id,
    requirement: cloneRequirement(requirementDefinition),
    satisfied,
    satisfiedBy: uniqueSatisfiedBy,
    recommendedTools: satisfied ? [] : [...requirementDefinition.recommendedTools],
    message: satisfied
      ? "relation_paths satisfied by relation-aware tool evidence."
      : "relation_paths requires repo_relation_query or change_impact_analyze evidence.",
  };
}

function evaluateFreshRepoFacts(
  requirementDefinition: EvidenceRequirement,
  evidence: readonly EvidenceRequirementRecord[],
  completedTools: Set<string>,
): EvidenceRequirementEvaluation {
  const hasDurableRefreshTool =
    completedTools.has("durable_repo_index_refresh") ||
    evidence.some((record) => record.toolName === "durable_repo_index_refresh");
  const freshFactEvidence = evidence.find(
    (record) =>
      record.kind !== undefined &&
      FRESH_REPO_FACT_KINDS.includes(record.kind as (typeof FRESH_REPO_FACT_KINDS)[number]) &&
      isFresh(record.freshness),
  );
  const satisfiedBy = [
    ...(hasDurableRefreshTool ? ["tool:durable_repo_index_refresh"] : []),
    ...(freshFactEvidence?.kind ? [`evidence:${freshFactEvidence.kind}:${freshFactEvidence.freshness}`] : []),
  ];
  const satisfied = hasDurableRefreshTool && freshFactEvidence !== undefined;

  return {
    id: requirementDefinition.id,
    requirement: cloneRequirement(requirementDefinition),
    satisfied,
    satisfiedBy,
    recommendedTools: satisfied ? [] : [...requirementDefinition.recommendedTools],
    message: satisfied
      ? "repo_facts_fresh satisfied by durable refresh and fresh repo fact evidence."
      : "repo_facts_fresh requires durable_repo_index_refresh plus fresh repo fact evidence.",
  };
}

function requirement(
  id: EvidenceRequirementId,
  label: string,
  description: string,
  evidenceKinds: readonly string[],
  recommendedTools: readonly string[],
): EvidenceRequirement {
  return {
    id,
    label,
    description,
    evidenceKinds: [...evidenceKinds],
    recommendedTools: [...recommendedTools],
    satisfiedByTools: [...recommendedTools],
    requiredFor: [],
  };
}

function requirementById(id: EvidenceRequirementId): EvidenceRequirement {
  const definition = REQUIREMENTS.find((requirementDefinition) => requirementDefinition.id === id);
  if (!definition) {
    throw new Error(`Unknown evidence requirement: ${id}`);
  }
  return definition;
}

function cloneRequirement(requirementDefinition: EvidenceRequirement): EvidenceRequirement {
  return {
    ...requirementDefinition,
    evidenceKinds: [...requirementDefinition.evidenceKinds],
    recommendedTools: [...requirementDefinition.recommendedTools],
    satisfiedByTools: [...requirementDefinition.satisfiedByTools],
    requiredFor: [...requirementDefinition.requiredFor],
  };
}

function freezeRequirements(requirements: EvidenceRequirement[]): readonly EvidenceRequirement[] {
  for (const requirementDefinition of requirements) {
    Object.freeze(requirementDefinition.evidenceKinds);
    Object.freeze(requirementDefinition.recommendedTools);
    Object.freeze(requirementDefinition.satisfiedByTools);
    Object.freeze(requirementDefinition.requiredFor);
    Object.freeze(requirementDefinition);
  }
  return Object.freeze(requirements);
}

function isFresh(freshness: string | undefined): boolean {
  return freshness === "fresh" || freshness === "current";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
