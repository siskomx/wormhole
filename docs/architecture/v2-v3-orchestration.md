# Wormhole V2/V3 Orchestration

This document defines the implemented v2/v3 orchestration foundations beyond the runnable v1 MCP kernel, plus the remaining future extension points.

V1 proves the evidence loop. V2 introduces bounded parallel orchestration. V3 introduces adaptive routing and provider ecosystems. All tracks keep the same rule: evidence, questions, gates, and artifacts remain authoritative state.

## Version Tracks

| Track | Status | Purpose |
| --- | --- | --- |
| V1 | Implemented foundation | Local MCP planning kernel, JSONL state, evidence records, question ledger, gate, Markdown plan artifact, benchmark fixtures. |
| V2 | Implemented foundation | First-party optimization primitives, live sub-orchestrator control, four-layer task records, static DAG scheduling, content-addressed evidence cache, reconciliation, Codex adapter config, Claude Desktop extension metadata, external agent adapters, and benchmark comparison runner. |
| V3 | Implemented foundation | Adaptive model/provider routing, connector registry, dynamic DAG spawning guardrails, bounded model-pool roles, typed artifacts, and static workbench rendering. Learned provider orchestration remains a future extension. |

## Four-Layer Ceiling

The maximum orchestration depth is four. A child cannot create a deeper layer than its parent allows.

| Layer | DS9 flavor | Runtime role | Spawn permission |
| --- | --- | --- | --- |
| 1 | Sisko | Mission command, budget owner, gate owner, final artifact owner. | May spawn layer 2. |
| 2 | Dax | Domain sub-orchestrators for repo, architecture, UX, risk, naming, testing, product, and migration planning. | May spawn layer 3. |
| 3 | Kira | Focused investigator or implementation coordinators with bounded context. | May spawn layer 4. |
| 4 | Runabout | Tool workers that read files, run commands, inspect evidence, or draft narrow artifacts. | Cannot spawn. |

Formal protocol names stay generic. DS9 names are documentation and UI flavor only.

## Parent/Child Contract

Every child task receives:

- Mission id
- Parent task id
- Allowed layer
- Objective
- Budget
- Allowed tools or connector capabilities
- Read/write scope
- Required artifact type
- Evidence requirements
- Stop criteria

Every child task returns:

- Status
- Evidence references
- Open questions
- Assumptions
- Risks
- Artifact pointer or structured result
- Event-log position
- Budget used

Parents merge child outputs through structured evidence and artifacts, not raw scratch text.

## Live Control Plane

Active sub-orchestrators communicate through a mailbox and heartbeat protocol.

- `task_register` creates a tracked task at layer 1-4.
- `task_status_report` records heartbeat, current flow, summary, and touched paths.
- `control_message` sends `query`, `advisory`, `direction_change`, or `interrupt` messages.
- `control_ack` acknowledges messages and records the child response.
- `task_inbox` lists pending or acknowledged messages for a task.
- `task_status` reports current task state and mailbox counts.

Message modes have different execution policies:

| Mode | Effective policy | Behavior |
| --- | --- | --- |
| `query` | `next_checkpoint` | Non-blocking; task continues and answers through inbox/checkpoint flow. |
| `advisory` | `next_checkpoint` | Non-blocking; task incorporates context at the next checkpoint. |
| `direction_change` | `pause_until_ack` | Task pauses, acknowledges the new direction, revises local plan, then resumes. |
| `interrupt` | `immediate_stop` | Task stops immediately and must acknowledge before further coordination. |

All task registrations, status reports, control messages, and acknowledgements are appended to the JSONL event log and replay into projected state.

## Parallelism Model

V2 parallelism is static DAG parallelism first and is implemented through `createDagSchedule` and `runDagSchedule`. V3 adds bounded dynamic expansion through `runDynamicDagSchedule`.

- Tasks declare dependencies.
- Tasks declare read and write sets.
- Conflicting write sets are separated into later waves.
- Write tasks can be routed through Airlock approval before side effects.
- Merge points reconcile artifacts and questions before the next gate.
- Dynamic spawning is allowed only when a worker returns declared child tasks.
- Spawned children must be deeper than the parent, cannot exceed depth 4, cannot duplicate task ids, and are capped by the caller's max-task budget.
- Fan-out is capped per layer and per mission by the scheduler caller.

## Reconciliation And Cache

Child artifacts merge through `reconcileArtifacts`, which preserves evidence provenance and surfaces read/write conflicts for parent review.

Raw source content can be stored through `createEvidenceCache`, which writes content-addressed SHA-256 records and allows compressed views to remain separate from the source of truth. The exposed `cache_evidence` MCP tool confines cache roots under the supplied `repoRoot`, or under the server working directory when no `repoRoot` is supplied.

## External Agent Adapters

External AI agents and model providers are registered as bounded Wormhole workers through `agent_register`.

Supported worker shapes include:

- MCP-capable agents such as Hermes Agent through `mcp-stdio` or `mcp-http`.
- HTTP, CLI, SDK, or provider API wrappers for model-style agents such as Inflection Pi.
- Human-controlled clients such as Claude Code, Claude Desktop, and Codex when they call the generic MCP tools.

Wormhole remains the source of truth. External agents receive dispatched task objectives and payloads through `agent_dispatch`, report back through `agent_complete`, expose current state through `agent_status`, and can be interrupted through `agent_interrupt` when the registered adapter supports interrupts.

The adapter contract tracks declared capabilities, installation/authentication policy, concurrency, interrupt support, evidence IDs, artifact IDs, and task run status. It does not assume every external agent can spawn durable work or obey live interrupts; those behaviors must be declared by the adapter.

## Connector Model

Wormhole should work through a generic MCP server first.

Client-specific compatibility is expressed as adapters:

- Claude Code: attach to the MCP stdio server.
- Claude Desktop: install the MCPB-compatible scaffold in `plugins/wormhole-claude-desktop`.
- Codex: consume `plugins/wormhole/.codex-plugin/plugin.json` and `plugins/wormhole/.mcp.json`.
- Hermes Agent, Inflection Pi, and other agents: register through the external agent adapter contract when they expose a controllable MCP, HTTP, CLI, SDK, or provider API boundary.
- Other clients: implement the connector manifest and call the generic MCP tools.

The repo-local Codex plugin points to `../../dist/src/cli.js` from `plugins/wormhole`, so local plugin testing requires `npm run build` first.

The repo-local Claude Desktop extension manifest points to `server/index.js` from `plugins/wormhole-claude-desktop`; the wrapper launches the built `dist/src/cli.js`, so local extension testing also requires `npm run build` first.

## Optimization Providers

V2 now includes deterministic first-party optimization primitives:

- RTK-like command-output compaction through `compactCommandOutput`
- Headroom-like context compression through `compressContext`
- Caveman-style dense response profiles through `createDenseSummary`
- Ponytail-style minimality rubrics through `reviewMinimality`

Provider output must retain provenance. Compressed text can help the model, but the JSONL event log and source handles remain the source of truth.

External RTK, Headroom, Caveman, or Ponytail adapters can be added later. The Wormhole-native primitives remain the baseline behavior.

## V3 Adaptive Routing

V3 includes deterministic Fugu-inspired routing through `selectRoutingPlan` and bounded model-pool orchestration through `runModelPool`.

Routing inputs:

- Task category
- Repo size and complexity
- Ambiguity
- Risk level
- Available connectors
- Provider allowlists and denylists
- Historical benchmark scores
- Budget and latency constraints

Routing outputs:

- Fast path
- Balanced path
- Deep path
- Required verifier count
- Model/provider selection
- Refusal or approval requirement

Every routing decision returns selected and rejected model data so callers can event-log the decision.

`runModelPool` provides the first implemented role taxonomy:

- Thinker: decomposes, critiques, and identifies gaps.
- Worker: drafts scoped work from the thinker output.
- Verifier: checks the worker output and returns a verified or partial result.

Each model-pool run has an explicit turn budget. Budget exhaustion returns a partial result with trace data instead of silently continuing. Learned model-pool routing, external provider marketplaces, and benchmark-trained selection remain future extensions.

## Connector Registry

The connector registry lets Wormhole select a compatible target by declared capabilities rather than assuming every host supports the same tools. `createConnectorRegistry` supports Codex, Claude Code, and future connectors with installation and authentication policy metadata.

## Workbench And Artifacts

V3 includes typed artifact records through `createArtifactRecord` and the `create_artifact` MCP tool.

Supported artifact types:

- `plan`
- `json_report`
- `html_workbench`
- `patch_plan`
- `benchmark_report`

V3 also includes a static Promenade-style workbench view through `createWorkbenchSnapshot`, `renderWorkbenchHtml`, and the `render_workbench` MCP tool. The workbench renders mission, task, gate, and artifact state without becoming the source of truth. The JSONL event log and typed state records remain authoritative.

## Non-Negotiable Guardrails

- Fresh evidence before gate.
- Gate before final artifact.
- Human approval before risky side effects.
- Maximum depth 4.
- Parents own budgets.
- Children cannot silently expand scope.
- Provider/model choices are logged.
- A partial result must say what is missing.
