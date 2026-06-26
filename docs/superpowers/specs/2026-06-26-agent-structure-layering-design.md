# Agent Structure And Layering Design

## Goal

Make Wormhole usable as a complete coding-agent operating layer without forcing agents to reason over 160 peer MCP tools at startup.

The design must preserve Wormhole's broad capability surface while giving agents a small deterministic path for entering a repo, discovering capabilities, maintaining mission state, updating context and graph state, performing edits, verifying work, and stopping.

## Context

The current inventory shows:

- Runtime MCP tools: 160.
- Runtime handler methods: 160.
- TypeScript exported declarations: 482.
- TypeScript exported functions/classes: 135.
- Claude Desktop manifest tools: 136.
- Codex plugin explicit tools: 0.

Wormhole covers the right areas for coding agents: mission state, evidence, orchestration, context packs, repo graph, durable indexes, repo activity, project intelligence, impact analysis, verification, LSP diagnostics, patch transactions, external agents, model routing, policy learning, generated tools, media ingestion, and workbench artifacts.

The problem is structural. Agents should not encounter those capabilities as one flat menu.

## Decision

Use a hybrid structure:

- `guided` is the default compatibility mode.
- `layered` is an opt-in enforced mode for smaller models, local agents, and clients that suffer from tool-list overload.
- Discovery tools are always visible in every mode.

This follows Claude's warning that pure enforced layering can make capabilities invisible, while preserving Ollama's point that prompt-only discipline is too weak. The architecture should be enforcement-ready, but discovery must ship first.

## Non-Goals

- Do not remove existing tools.
- Do not depend on dynamic MCP tool-list mutation as the first implementation step.
- Do not make one generic string-dispatch tool that hides schemas and causes malformed calls.
- Do not require all clients to support identical MCP discovery behavior.
- Do not make policy learning or external agents part of the startup path.

## Agent Operating Structure

Wormhole should be presented as planes plus phases.

### Always-Visible Startup Spine

These tools are always visible and promoted in prompts:

- `mission_start`
- `mission_status`
- `mission_route`
- `agent_context_prepare`
- `next_best_tool`
- `tool_layer_map`
- `tool_catalog_query`
- `gate_request`

`tool_layer_map` and `tool_catalog_query` do not exist yet. They are the highest-priority structural tools because they let agents answer "what exists?" and "how do I reveal or use it?" without reading all schemas.

### Control Plane

The control plane owns orchestration and team coordination:

- task state
- control messages
- local task scheduling
- conductor scaffolds
- external agent dispatch
- shared agent workspace memory
- policy feedback

Representative tools:

- `task_register`
- `task_status_report`
- `control_message`
- `control_ack`
- `task_inbox`
- `task_status`
- `schedule_tasks`
- `orchestration_plan_local`
- `orchestration_run_local`
- `conductor_plan`
- `conductor_replay`
- `agent_dispatch`
- `agent_dispatch_execute`
- `agent_workspace_create`
- `agent_workspace_write`
- `agent_workspace_read`
- `agent_workspace_merge`

### State Plane

The state plane owns context, graph, evidence cache, repo activity, and freshness:

- context records
- context packs
- context-pack budget and refresh decisions
- repo graph
- durable repo and semantic indexes
- repo watch sessions
- repo activity log
- evidence cache

Representative tools:

- `ctx_record`
- `ctx_pack_query`
- `ctx_pack_create`
- `ctx_pack_budget_review`
- `ctx_pack_refresh`
- `ctx_pack_render`
- `cache_evidence`
- `repo_index_build`
- `repo_index_query`
- `repo_index_explain`
- `repo_index_path`
- `repo_index_report`
- `repo_watch_start`
- `repo_watch_scan`
- `repo_change_scan`
- `repo_activity_record`
- `repo_graph_refresh_incremental`
- `durable_repo_index_refresh`
- `durable_index_status`
- `durable_semantic_index_refresh`
- `durable_semantic_search`

The route phases consume state, but they do not own state freshness. `mission_route` and `agent_context_prepare` should report state-maintenance recommendations separately from phase recommendations.

### Route Phases

The main coding workflow remains:

```text
orient -> impact -> context -> edit -> verify -> gate
```

Each phase has a small expected tool family:

- `orient`: `project_onboard`, `architecture_map`, `entrypoint_flow_discover`, `project_contract_detect`, `repo_index_report`.
- `impact`: `blast_radius_analyze`, `test_impact_analyze_v2`, `repo_index_explain`, `repo_index_path`, `impact_analyze`.
- `context`: `context_pack_generate`, `ctx_pack_budget_review`, `ctx_pack_refresh`, `ctx_pack_render`.
- `edit`: `action_policy_review`, `patch_checkpoint`, `patch_apply`, `patch_status`, `patch_rollback`, `diagnostics_query`, `lsp_feedback_replan`.
- `verify`: `test_plan_select`, `verification_run`, `diagnostics_from_command`, `dependency_security_report`, `secret_scan`.
- `gate`: `record_evidence`, `record_question`, `update_question`, `gate_request`, `emit_plan`.

### Specialist Packs

Specialist packs remain available but should not be startup guidance:

- external agents
- generated tools and Printing Press CLIs
- media ingestion
- shell hooks
- discovery-driven API tooling
- optimization adapters
- policy learning
- reasoning research
- model profiles
- workbench artifacts

Specialist packs are discovered through `tool_catalog_query` and recommended through `mission_route`, not dumped into the first prompt.

## Exposure Modes

### Guided Mode

All tools remain registered. The agent-facing prompt and route output require use of the startup spine first.

Guided mode is the default because it works across clients even when they cache tool lists or do not support dynamic tool registration.

### Layered Mode

Only the startup spine and discovery tools are registered at first. Route and catalog calls reveal phase, control-plane, state-plane, or specialist capabilities.

Layered mode is opt-in until discovery and client behavior are proven reliable.

### Full Mode

Full mode leaves the existing behavior available for compatibility and debugging. It registers the entire runtime surface and does not attempt to hide tools.

## Discovery Contract

`tool_layer_map` returns the static operating model:

```ts
type ToolLayerMap = {
  startupSpine: string[];
  planes: Array<{
    name: "startup" | "control" | "state" | "route" | "specialist";
    purpose: string;
    packs: string[];
  }>;
  phases: Array<{
    name: "orient" | "impact" | "context" | "edit" | "verify" | "gate";
    purpose: string;
    defaultTools: string[];
  }>;
  exposureModes: Array<"full" | "guided" | "layered">;
};
```

`tool_catalog_query` returns filtered tool metadata:

```ts
type ToolCatalogQuery = {
  plane?: string;
  phase?: string;
  pack?: string;
  risk?: "read-only" | "write" | "execute" | "external";
  cost?: "low" | "medium" | "high";
  toolName?: string;
  query?: string;
};

type ToolCatalogResult = {
  tools: Array<{
    toolName: string;
    plane: string;
    phase?: string;
    pack: string;
    risk: string;
    cost: string;
    summary: string;
    requiredInputs: string[];
    revealMode: "already-visible" | "route-recommended" | "requires-layered-transition";
  }>;
  nextRecommendedCall?: {
    toolName: string;
    input: Record<string, unknown>;
    reason: string;
  };
};
```

The catalog must always answer for all 160 runtime tools, even in layered mode. A hidden tool can be unavailable for direct invocation, but it must never be undiscoverable.

## Route Output Contract

`mission_route` and `agent_context_prepare` should grow these fields:

```ts
type AgentOperatingState = {
  exposureMode: "full" | "guided" | "layered";
  currentPhase: "orient" | "impact" | "context" | "edit" | "verify" | "gate";
  activePlaneRecommendations: Array<{
    plane: "control" | "state" | "route" | "specialist";
    reason: string;
    tools: string[];
  }>;
  stateMaintenance: {
    graphFreshness: "missing" | "stale" | "fresh";
    contextPackStatus: "missing" | "stale" | "overflowing" | "ready";
    recommendedRefreshTools: string[];
  };
  orchestration: {
    mode: "single-agent" | "task-wave" | "external-agent" | "policy-guided";
    reason: string;
    recommendedTools: string[];
  };
  avoidUntilRecommended: string[];
};
```

This keeps orchestration and state maintenance first-class instead of burying them in route phases.

## Transition Contract

After discovery is reliable, add a transition primitive:

```ts
type TransitionPhaseInput = {
  missionId?: string;
  repoRoot: string;
  fromPhase: string;
  toPhase: string;
  completedTools: string[];
  evidenceIds?: string[];
  changedFiles?: string[];
};

type TransitionPhaseResult = {
  allowed: boolean;
  reasons: string[];
  visibleTools: string[];
  hiddenButDiscoverableTools: string[];
  nextRequiredTools: string[];
  stateMaintenance: AgentOperatingState["stateMaintenance"];
};
```

The transition tool should be idempotent. It should not assume every MCP client can dynamically mutate tool lists. If dynamic mutation is unsupported, it still returns an enforceable recommended surface and the host remains in guided behavior.

## Manifest And Documentation Alignment

Before enforcing layers, reconcile the inventory mismatch:

- Runtime MCP tools: 160.
- Claude Desktop manifest tools: 136.
- Codex plugin explicit tools: 0.

The implementation should either:

- make manifests intentionally compact and mark runtime discovery as authoritative, or
- generate manifest tool lists from the same registry used by `tool_catalog_query`.

Silent mismatch is not acceptable. It makes agent behavior client-dependent.

## Safety And Failure Modes

The main risks are:

- Hidden tool invisibility: the agent needs a tool but cannot discover it.
- MCP schema caching: clients may not reflect dynamic tool changes.
- Generic dispatcher misuse: collapsing too much into one string-based invoker can cause malformed calls.
- State drift: graph, context pack, changed files, and mission evidence can fall out of sync.
- Manifest drift: runtime, Claude Desktop, and Codex surfaces can diverge.

Mitigations:

- Keep `tool_layer_map` and `tool_catalog_query` always visible.
- Treat catalog discovery as authoritative over manifests.
- Keep real named tools and schemas for phase tools.
- Add freshness fields to route output.
- Add tests comparing runtime registration, handler registry, and manifest coverage.

## Testing Strategy

Add tests for:

- `tool_layer_map` includes startup, control, state, route, and specialist planes.
- `tool_catalog_query` can find every runtime MCP tool.
- Runtime tool count equals handler count.
- Claude manifest gaps are either eliminated or explicitly accepted by generated compact-manifest policy.
- `mission_route` includes state-maintenance and orchestration recommendations.
- `agent_context_prepare` promotes the startup spine and avoids specialist packs unless recommended.
- Layered exposure mode never hides discovery tools.
- Transition calls are idempotent and return stable visible/hidden tool sets.

## Migration Order

1. Build a single tool registry that names all runtime tools and their plane, phase, pack, risk, cost, and input summary.
2. Add `tool_layer_map`.
3. Add `tool_catalog_query`.
4. Extend `mission_route` and `agent_context_prepare` with state-maintenance and orchestration fields.
5. Reconcile Claude and Codex manifest behavior against the registry.
6. Add guided-mode prompt updates.
7. Add opt-in layered exposure mode.
8. Add transition-phase enforcement after layered discovery works.

## Success Criteria

- Agents can start with fewer than 10 promoted tools.
- Agents can discover any runtime capability without reading all schemas.
- Large-repo workflows route through orient, impact, context, edit, verify, and gate.
- Orchestration and state freshness are explicit in route output.
- Runtime, handler, and manifest surfaces no longer silently disagree.
- Existing full-tool behavior remains available for compatibility.
