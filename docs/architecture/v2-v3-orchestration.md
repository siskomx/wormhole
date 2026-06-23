# Wormhole V2/V3 Orchestration

This document defines the final target shape beyond the runnable v1 MCP kernel.

V1 proves the evidence loop. V2 introduces bounded parallel orchestration. V3 introduces adaptive routing and provider ecosystems. All tracks keep the same rule: evidence, questions, gates, and artifacts remain authoritative state.

## Version Tracks

| Track | Status | Purpose |
| --- | --- | --- |
| V1 | Implemented foundation | Local MCP planning kernel, JSONL state, evidence records, question ledger, gate, Markdown plan artifact, benchmark fixtures. |
| V2 | Planned contract | Four-layer sub-orchestration, Codex plugin support, context compression providers, task DAGs, mergeable artifacts. |
| V3 | Planned contract | Adaptive model/provider routing, connector marketplace, UI/workbench, richer artifact types, model-pool providers. |

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

## Parallelism Model

V2 parallelism is static DAG parallelism first.

- Tasks declare dependencies.
- Tasks declare read and write sets.
- Write tasks require Airlock approval before side effects.
- Merge points reconcile artifacts and questions before the next gate.
- Fan-out is capped per layer and per mission.

Dynamic spawning is deferred until after static DAG behavior is benchmarked.

## Connector Model

Wormhole should work through a generic MCP server first.

Client-specific compatibility is expressed as adapters:

- Claude Code: attach to the MCP stdio server.
- Codex: consume `plugins/wormhole/.codex-plugin/plugin.json` and `plugins/wormhole/.mcp.json`.
- Other clients: implement the connector manifest and call the generic MCP tools.

The repo-local Codex plugin points to `../../dist/src/cli.js` from `plugins/wormhole`, so local plugin testing requires `npm run build` first.

## Optimization Providers

V2 can add provider slots without making them mandatory:

- RTK-like command-output compaction
- Headroom-like context compression
- Caveman-style dense response profiles
- Ponytail-style minimality rubrics

Provider output must retain provenance. Compressed text can help the model, but the JSONL event log and source handles remain the source of truth.

## V3 Adaptive Routing

V3 can add Fugu-inspired adaptive routing only after v1/v2 benchmarks exist.

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

Every routing decision is event-logged with selected and rejected options.

## Non-Negotiable Guardrails

- Evidence before gate.
- Gate before final artifact.
- Human approval before risky side effects.
- Maximum depth 4.
- Parents own budgets.
- Children cannot silently expand scope.
- Provider/model choices are logged.
- A partial result must say what is missing.
