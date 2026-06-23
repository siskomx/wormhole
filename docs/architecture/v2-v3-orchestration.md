# Wormhole V2/V3 Orchestration

This document defines the final target shape beyond the runnable v1 MCP kernel.

V1 proves the evidence loop. V2 introduces bounded parallel orchestration. V3 introduces adaptive routing and provider ecosystems. All tracks keep the same rule: evidence, questions, gates, and artifacts remain authoritative state.

## Version Tracks

| Track | Status | Purpose |
| --- | --- | --- |
| V1 | Implemented foundation | Local MCP planning kernel, JSONL state, evidence records, question ledger, gate, Markdown plan artifact, benchmark fixtures. |
| V2 | Implemented foundation | First-party optimization primitives, live sub-orchestrator control, four-layer task records, static DAG scheduling, content-addressed evidence cache, reconciliation, Codex adapter config, and benchmark comparison runner. |
| V3 | Implemented foundation | Adaptive model/provider routing and connector registry. UI/workbench, richer artifact types, and learned model-pool providers remain future extensions. |

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

V2 parallelism is static DAG parallelism first and is implemented through `createDagSchedule` and `runDagSchedule`.

- Tasks declare dependencies.
- Tasks declare read and write sets.
- Conflicting write sets are separated into later waves.
- Write tasks can be routed through Airlock approval before side effects.
- Merge points reconcile artifacts and questions before the next gate.
- Fan-out is capped per layer and per mission by the scheduler caller.

Dynamic spawning beyond declared DAG inputs remains a future extension.

## Reconciliation And Cache

Child artifacts merge through `reconcileArtifacts`, which preserves evidence provenance and surfaces read/write conflicts for parent review.

Raw source content can be stored through `createEvidenceCache`, which writes content-addressed SHA-256 records and allows compressed views to remain separate from the source of truth.

## Connector Model

Wormhole should work through a generic MCP server first.

Client-specific compatibility is expressed as adapters:

- Claude Code: attach to the MCP stdio server.
- Codex: consume `plugins/wormhole/.codex-plugin/plugin.json` and `plugins/wormhole/.mcp.json`.
- Other clients: implement the connector manifest and call the generic MCP tools.

The repo-local Codex plugin points to `../../dist/src/cli.js` from `plugins/wormhole`, so local plugin testing requires `npm run build` first.

## Optimization Providers

V2 now includes deterministic first-party optimization primitives:

- RTK-like command-output compaction through `compactCommandOutput`
- Headroom-like context compression through `compressContext`
- Caveman-style dense response profiles through `createDenseSummary`
- Ponytail-style minimality rubrics through `reviewMinimality`

Provider output must retain provenance. Compressed text can help the model, but the JSONL event log and source handles remain the source of truth.

External RTK, Headroom, Caveman, or Ponytail adapters can be added later. The Wormhole-native primitives remain the baseline behavior.

## V3 Adaptive Routing

V3 includes deterministic Fugu-inspired routing through `selectRoutingPlan`.

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

## Connector Registry

The connector registry lets Wormhole select a compatible target by declared capabilities rather than assuming every host supports the same tools. `createConnectorRegistry` supports Codex, Claude Code, and future connectors with installation and authentication policy metadata.

## Non-Negotiable Guardrails

- Evidence before gate.
- Gate before final artifact.
- Human approval before risky side effects.
- Maximum depth 4.
- Parents own budgets.
- Children cannot silently expand scope.
- Provider/model choices are logged.
- A partial result must say what is missing.
