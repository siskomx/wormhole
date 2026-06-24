# Wormhole Canonical Plan

Date: 2026-06-23

## Status

This is the canonical merged plan for Wormhole. It supersedes:

- `outputs/wormhole-plan-log.md`
- `outputs/wormhole-final-core-plan.md`

Those files remain useful as discussion history. This document is the implementation baseline.

## Executive Summary

Wormhole is an evidence-first orchestration system for AI coding agents.

The long-term goal is to support new projects, existing repositories, feature expansion, product planning, UI/UX planning, system design, implementation planning, review, and eventually bounded execution through sub-orchestrators.

The core goal is narrower and falsifiable:

> Prove whether an evidence-aware loop with an open-question ledger and batch gate produces better existing-repo design and implementation plans than unaided Claude Code.

The core runtime is a local Claude Code MCP server. In the core runtime, that MCP server is also the kernel. It owns mission state, event logging, evidence records, open questions, and gate enforcement. Claude Code still drives reasoning and tool use; Wormhole enforces workflow order through MCP tool responses.

## Core Thesis

Wormhole should not start as a multi-agent framework.

Wormhole should start as a stateful evidence engine.

The technical moat is:

- Evidence capture
- Open-question tracking
- Provenance
- Gate/stopping criteria
- Durable event logging
- Evaluation against a baseline

Parallel agents, deeper layering, Codex support, UI, and connector ecosystems are useful only if the core evidence loop proves valuable first.

## Product Scope

Wormhole should eventually support:

- New repo or greenfield project planning
- Existing repo or brownfield system planning
- Adding features to existing code
- Expanding an existing product
- Rewriting or migrating a system
- Design-only planning
- Business/product planning
- UI/UX planning
- Technical architecture planning
- Implementation-ready planning
- Verification and review
- Controlled execution after approval

The same generic loop applies across mission types:

1. Gather evidence.
2. Track open questions.
3. Reason over options.
4. Decide whether enough is known.
5. Produce the next useful artifact.
6. Act only when approved.

The evidence sources change by mission type.

For a new project, evidence comes from human answers, business goals, target users, constraints, compliance needs, workflows, and design preferences.

For an existing repo, evidence comes from source files, dependency files, tests, docs, configs, git history, entry points, runtime setup, and existing conventions.

For feature expansion, Wormhole combines user intent with codebase evidence.

## Name And Theme

Project name: Wormhole.

DS9-inspired naming is allowed in documentation and future UI flavor, but formal APIs stay generic.

Allowed flavor terms:

- Mission: top-level run
- Station: local runtime or host
- Runabout: future delegated worker
- Quadrant: bounded context area
- Pylon: future workflow branch or trace span
- Airlock: approval/safety gate
- Promenade: future UI/workbench
- Docking Port: adapter or connector

Do not use franchise-specific names in package IDs, protocol fields, tool names, or formal contracts.

## Architecture Principles

### Evidence First

Evidence, questions, decisions, risks, and artifacts are the core objects. Agents and verbs are secondary.

### Prompt Modules, Not Prompt Monoliths

Wormhole should not become one giant instruction file.

Reusable behavior should live in versioned modules:

- Routing ladders
- Safety policies
- Tool-use policies
- Adapter capability manifests
- Rubrics
- Artifact templates
- Evidence schemas
- Gate/stopping criteria

Routing and policy decisions should be inspectable, testable, and event-logged.

### MCP Is An Interface

Long term, MCP is an interface to Wormhole, not the whole kernel.

For the core runtime, the MCP server is the kernel to avoid premature process boundaries.

### One Parameterized Workflow

Do not create separate hardcoded flows for vague ideas, existing repos, migrations, bugfixes, and new features.

Use one workflow with pluggable evidence sources.

### Thin Payload, Strong Control State

Future master orchestrators should avoid raw payloads, but must keep authoritative control state.

They should not hold raw code dumps, full tool outputs, full artifacts, full diffs, or agent scratch work.

They must hold mission objective, constraints, budgets, task state, gate state, open-question state, evidence indexes, risk state, and event positions.

Summaries are for human display. Gate logic must use structured state.

## Canonical Core Scope

Core includes:

- Claude Code first
- One local MCP server
- MCP server is the core kernel
- Repo-local Codex plugin metadata for local MCP attachment
- Repo-local Claude Desktop MCPB metadata for local MCP attachment
- Existing-repo planning missions only
- Bounded sequential loop
- JSONL append-only event log
- In-memory state projection
- Simple typed evidence records
- Open-question ledger
- Batch gate
- One evidence-cited Markdown plan artifact
- Evaluation against unaided Claude Code

Core excludes:

- Parallel execution
- Dynamic sub-orchestrators
- Codex-specific runtime behavior beyond plugin metadata
- SQLite storage
- Content-addressed cache
- Full evidence graph
- Claim normalization
- Entailment verification
- Reconciliation engine
- UI/workbench
- Runtime DS9-themed API names
- External connector marketplace packaging
- Built-in third-party compression/provider integrations

## Core Runtime Model

### Kernel Boundary

In the core runtime, the local MCP server is the kernel.

There is no separate kernel process, no IPC layer, and no daemon beyond the MCP server process.

The MCP server owns:

- Mission state
- Event log appends
- State projection
- Evidence records
- Open-question records
- Loop round count
- Gate state
- Artifact emission state

Claude Code owns:

- Natural-language reasoning
- Choosing which MCP tool to call next
- Reading repo files through its normal tools
- Supplying evidence observations to Wormhole
- Drafting the final plan through the Wormhole workflow

The core runtime does not invoke the model directly.

### Loop Ownership

The loop is host-driven and kernel-enforced.

Claude Code follows the loop protocol:

1. Start mission.
2. Start round.
3. Gather repo evidence.
4. Record evidence.
5. Reason over gaps.
6. Record open questions.
7. Repeat gather/reason when useful.
8. Request gate.
9. Emit final plan.

The MCP server enforces:

- Mission must exist before evidence is recorded.
- Evidence must be recorded before gate.
- Gate must run before final artifact emission.
- Max gather/reason rounds is 3.
- Early exit is allowed after round 1 if no blocking questions remain.
- Final artifact cannot be emitted while the gate is closed.

If Claude Code calls tools out of order, the MCP server returns a structured refusal with the required next state transition.

## Core State Model

State is stored as a single append-only JSONL event log.

The current mission state is projected in memory from the log.

There is one source of truth: the JSONL log.

### Required Event Types

Core event types:

- `mission.started`
- `mission.updated`
- `round.started`
- `round.completed`
- `evidence.recorded`
- `question.recorded`
- `question.updated`
- `gate.requested`
- `gate.closed`
- `gate.opened`
- `artifact.emitted`
- `error.recorded`

Every event includes:

- `eventId`
- `missionId`
- `type`
- `createdAt`
- `payload`

## Core Evidence Records

Evidence records are intentionally simple.

Each evidence record includes:

- `evidenceId`
- `missionId`
- `sourceType`
- `sourcePath`
- `lineStart`
- `lineEnd`
- `retrievalMethod`
- `summary`
- `recordedAt`

Supported `sourceType` values:

- `file`
- `command_output`
- `user_input`
- `derived_note`

File evidence paths must resolve within the mission `repoRoot`.

Path existence is checked when evidence is recorded, when the gate is requested, and again when the artifact is emitted.

If path verification fails at record time, the evidence record is rejected and an `error.recorded` event is appended.

If path verification fails at gate or artifact time, the record is stale and excluded from plan-supporting citations. A mission cannot open the gate or emit a plan unless at least one fresh evidence record remains.

The core runtime verifies that cited files exist. It does not verify that every cited file semantically entails every claim.

## Open-Question Ledger

Each question record includes:

- `questionId`
- `missionId`
- `question`
- `blocking`
- `rationale`
- `assumptionFallback`
- `status`

Supported statuses:

- `open`
- `answered`
- `accepted_as_assumption`
- `deferred`

A question is blocking when its answer could change:

- The recommended architecture
- The affected implementation area
- The sequence of implementation steps
- The risk level
- The verification strategy

Questions that only refine wording, naming, or low-impact preferences are non-blocking in the core runtime.

## Batch Gate

The core runtime uses a batch gate, not interactive mid-run prompting.

The gate opens when:

- At least one fresh evidence record exists.
- No open blocking questions remain, or every blocking question has an assumption fallback.
- The mission has not exceeded 3 gather/reason rounds.
- The final artifact has not already been emitted.

If blocking questions remain, the final plan must include them with assumption fallbacks. The user can then answer, accept assumptions, or ask for another pass.

The gate closes when:

- No fresh evidence exists.
- Blocking questions exist without assumption fallbacks.
- The loop exceeded the round limit.
- Required state is missing or malformed.

## Core Final Artifact

The core runtime emits one Markdown artifact: an evidence-cited existing-repo plan.

Required sections:

1. Objective
2. Repo evidence summary
3. Open questions and assumptions
4. Recommended approach
5. Implementation steps
6. Risks
7. Verification plan

The artifact should cite evidence records inline using source paths and line ranges where available.

## Current MCP Tool Surface

The runnable server exposes a generic tool surface across the core kernel plus implemented orchestration and adaptive foundations:

- `mission_start`
- `round_start`
- `record_evidence`
- `record_question`
- `update_question`
- `task_register`
- `task_status_report`
- `control_message`
- `control_ack`
- `task_inbox`
- `task_status`
- `gate_request`
- `emit_plan`
- `mission_status`
- `optimize_text`
- `cache_evidence`
- `schedule_tasks`
- `orchestration_plan_local`
- `orchestration_run_local`
- `reconcile_artifacts`
- `route_mission`
- `codex_adapter_config`
- `select_connector`
- `create_artifact`
- `render_workbench`
- `repo_index_build`
- `repo_index_query`
- `repo_index_explain`
- `repo_index_path`
- `agent_register`
- `agent_list`
- `agent_dispatch`
- `agent_status`
- `agent_complete`
- `agent_interrupt`
- `printing_press_register`
- `printing_press_list`
- `printing_press_select`
- `printing_press_register_agent`

DS9-inspired names stay out of tool contracts.

## Core Evaluation Plan

The evaluation answers whether Wormhole is better than unaided Claude Code for existing-repo planning.

### Benchmark Suite

The core repo must include a frozen benchmark suite before claiming success.

The repository stores those fixtures under `benchmarks/fixtures`, with checked-in sample repositories under `benchmarks/repos` and the reviewer rubric at `benchmarks/rubric.json`.

The suite consists of five pinned existing-repo planning tasks stored as data in the repository.

Each task fixture includes:

- Repo source
- Repo commit or fixture hash
- Task prompt
- Allowed files or repo root
- Expected planning concerns
- Reviewer rubric file

Initial benchmark categories:

1. Add a feature to a small web API.
2. Modify behavior in a frontend app.
3. Add integration work to a CLI or service.
4. Improve tests for an existing module.
5. Plan a migration or refactor in a small multi-module repo.

Fixtures can be checked-in sample repos or SHA-pinned public repos copied into a fixture cache. The benchmark runner must not depend on moving branch tips.

### Baseline Protocol

For each benchmark task:

1. Run unaided Claude Code with the same task prompt.
2. Run Wormhole with the same task prompt and repo.
3. Capture both final plans.
4. Remove identifying labels.
5. Review blindly against the rubric.

### Rubric

Use five dimensions:

- Evidence coverage
- Correctness
- Assumption handling
- Risk awareness
- Implementation specificity

Each dimension is scored from 1 to 5.

### Success Criterion

The Wormhole core loop is successful if:

- Wormhole wins or ties unaided Claude Code on at least 4 of 5 dimensions in at least 3 of 5 benchmark tasks.
- Wormhole has no severe correctness regression.

A severe correctness regression means the Wormhole plan recommends an implementation path that is clearly incompatible with the repo evidence, omits a critical blocking risk visible in the repo, or invents a nonexistent core architecture as if it were real.

## Optimization Layer

Wormhole should support token and complexity reduction as capability categories, not hardwired dependencies.

The optimization layer is separate from the evidence source of truth.

Capability categories:

- Tool-output compaction
- Context/evidence compression
- Response style compression
- Minimality/YAGNI policy

Inspired mappings:

- RTK-like behavior: compact command outputs before evidence ingestion.
- Headroom-like behavior: compress context, logs, RAG chunks, and stored views.
- Caveman-like behavior: terse output profile for user-facing responses.
- Ponytail-like behavior: minimality policy/rubric that discourages overbuilding.

Rules:

- Compression must not destroy provenance.
- Raw source handles must remain available.
- Compressed views are aids for the model, not the source of truth.
- Minimality policy can influence planning and review, but must not bypass safety, correctness, or user requirements.

Wormhole includes deterministic first-party versions of these primitives so it is useful without third-party dependencies.

Implemented native primitives:

- `compactCommandOutput`: RTK-like command output compaction.
- `compressContext`: Headroom-like context compression.
- `createDenseSummary`: Caveman-like dense summary generation.
- `reviewMinimality`: Ponytail-like minimality review.

The orchestration area can still add external RTK-like command-output compaction and Headroom-like context compression adapters.

The adaptive area can support a provider registry or marketplace.

Reference projects:

- [rtk-ai/rtk](https://github.com/rtk-ai/rtk)
- [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom)
- [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)
- [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)

## Routing And Policy

Wormhole should use deterministic routing ladders for common decisions:

- Whether to answer directly, gather evidence, or ask a clarifying question
- Whether a visual artifact is needed
- Whether to use an available adapter/tool or fall back to another source
- Whether a request needs current external data
- Whether a task is low-stakes enough for a fast path
- Whether a side effect requires an Airlock approval gate

Routing decisions should be logged as events with the selected route and rejected alternatives.

Tool and MCP results should be ingested by structure, not fragile text parsing. Result blocks, artifacts, citations, and tool outputs should become typed evidence records with provenance.

Capability discovery should happen before tool selection. Codex, Claude Code, future UI clients, and third-party connectors should each declare what they can do. Wormhole should negotiate from those manifests instead of assuming every host supports the same behavior.

External AI agents are treated as registered workers, not as alternate sources of truth. Hermes Agent, Inflection Pi, and similar systems can participate when an adapter declares transport, capabilities, authentication policy, concurrency, and interrupt support. Printing Press generated CLIs can participate when they declare command, capabilities, evidence mode, installation/authentication policy, and concurrency. Wormhole owns the task graph, evidence references, gate state, and artifact provenance.

Gathering depth should scale with ambiguity and stakes. Simple requests should use a fast path; high-impact or ambiguous missions should trigger broader evidence gathering, stronger gates, and more review.

## Explicit Core Deferrals

These are outside the core scope:

- Dynamic DAG mutation beyond declared task inputs
- Autonomous L1/L2/L3 Runabout process spawning without a declared scheduler plan
- Dynamic spawning
- Admission control
- Runtime filesystem lock enforcement beyond scheduler wave separation
- MVCC snapshots
- Full evidence graph
- Claim-level contradiction detection
- Citation entailment verification
- SQLite persistence
- Codex-specific UI behavior beyond adapter config generation
- UI/workbench
- Policy marketplace
- External connector marketplace packaging
- External RTK/Headroom/Caveman/Ponytail adapters
- Learned/model-pool orchestration beyond deterministic routing/model selection

## Orchestration Implemented Direction

The orchestration area implemented:

- Static DAG parallelism
- Domain Runabouts
- Read/write-set declarations
- Basic reconciliation
- Content-addressed evidence cache
- Codex adapter
- Richer policy modules
- Tool-output compaction provider
- Context compression provider
- Native optimization primitives integrated into evidence recording and plan emission
- Live sub-orchestrator control with task heartbeat, mailbox, direction-change pause/ack, and immediate interrupts
- Benchmark comparison runner with anonymized review pairs
- Deterministic adaptive routing and model selection
- Connector registry and capability-based connector selection
- External agent registration, dispatch, status, interrupt, and completion records
- Printing Press generated CLI registration, capability selection, and agent conversion
- Graph-first repo indexing with query, explain, and dependency-path tools
- Adapter-free local orchestration planning and deterministic execution
- Claude Desktop MCPB-compatible extension metadata

Implemented orchestration control-plane tools:

- `task_register`: creates a tracked active task.
- `task_status_report`: records heartbeat, current flow, summary, and touched paths.
- `control_message`: sends query, advisory, direction-change, or interrupt messages.
- `control_ack`: acknowledges a control message and records response.
- `task_inbox`: lists pending or acknowledged task messages.
- `task_status`: returns task state and mailbox counts.
- `orchestration_plan_local`: validates and plans local DAG waves without executing tasks.
- `orchestration_run_local`: executes local DAG semantics from deterministic caller-supplied task outcomes.
- `agent_register`: registers an external AI agent or model provider worker.
- `agent_list`: lists registered external workers.
- `agent_dispatch`: assigns a Wormhole task to a worker by required capability.
- `agent_status`: returns worker run state.
- `agent_complete`: records worker completion or failure with evidence and artifact provenance.
- `agent_interrupt`: interrupts a worker run when the adapter supports interrupts.
- `printing_press_register`: registers a generated CLI or MCP server.
- `printing_press_list`: lists registered generated CLIs.
- `printing_press_select`: selects a generated CLI by required capabilities.
- `printing_press_register_agent`: converts a generated CLI into a dispatchable Wormhole worker.
- `repo_index_build`: builds a local file, symbol, import, and link graph for a repo.
- `repo_index_query`: searches indexed files and symbols before broad grep or raw file reads.
- `repo_index_explain`: explains a file or symbol using graph neighbors.
- `repo_index_path`: finds dependency paths between files or symbols.

Repo-index MCP calls are confined to allowed workspace roots, use option-scoped cache entries, and refresh cached graphs from content fingerprints before query/explain/path operations.

The repo-level orchestration contract is documented in `docs/architecture/orchestration-adaptive-capabilities.md` and `docs/contracts/capability-manifest.md`.

## Adaptive Implemented Direction

The adaptive area implemented:

- Dynamic sub-orchestrators
- Deeper layered execution up to hard max depth 4
- Static UI/workbench rendering
- Connector ecosystem
- Graph-first codebase query workflow
- Provider registry
- More artifact types
- Model/provider and external agent capability manifests
- Balanced vs deep mission modes
- Bounded model-pool orchestration providers with thinker, worker, and verifier roles

Future adaptive work can still add:

- Full evidence graph
- MVCC snapshots
- Lease expiry
- Rich interactive UI/workbench behavior
- Greenfield product discovery templates
- Controlled execution after approval
- Adaptive routing scores from benchmark results
- Learned model-pool orchestration
- External provider marketplaces

The repo-level adaptive contract is documented in `docs/architecture/orchestration-adaptive-capabilities.md`.

## Model-Pool Orchestration

Sakana Fugu validates the long-term direction for Wormhole, but it should not expand the core evidence kernel.

Fugu presents a multi-agent system as one model/API, dynamically coordinating a pool of models for complex coding, reasoning, research, and review tasks. Its public materials describe learned orchestration rather than hand-authored workflows, model/provider opt-outs for compliance, and two operating modes: a balanced default and an ultra/deeper mode for harder tasks.

Wormhole treats this as both an implemented deterministic foundation and a future roadmap signal:

- Keep the core loop focused on evidence-aware existing-repo planning.
- Preserve the longer-term goal of adaptive orchestration.
- Use benchmark results to decide when deeper orchestration is justified.
- Use model/provider capability manifests before using model pools.
- Support allowlists and denylists for provider, model, privacy, and compliance constraints.
- Treat model-pool orchestration as an optional provider, not as the Wormhole kernel.

The first implemented role taxonomy stays small:

- Thinker: reason, decompose, critique plans, and identify gaps.
- Worker: gather evidence, execute scoped steps, or produce concrete artifacts.
- Verifier: review completeness, correctness, risk, and gate readiness.

These roles map to Wormhole's existing operation model:

- Thinker maps to `reason`.
- Worker maps to `gather` and future `act`.
- Verifier maps to `review` and gate checks.

Routing remains bounded:

- Every model-pool run has a turn budget.
- Verification can terminate the run early.
- Budget exhaustion produces a partial result with explicit uncertainty.
- Provider/model choices are logged as events.
- Learned routing can be added later, but Wormhole's evidence, gate, approval, and policy state remain authoritative.

Relevant external references:

- Sakana Fugu: `https://sakana.ai/fugu/`
- Sakana Fugu Technical Report: `https://arxiv.org/abs/2606.21228`
- TRINITY: `https://ar5iv.labs.arxiv.org/html/2512.04695`
- Conductor: `https://arxiv.org/abs/2512.04388`

## Layering Model

Layered orchestration is capability-based, not mandatory.

The implemented model:

- L0 Master: thin payload, strong control state
- L1 Domain Runabouts: codebase, architecture, UX, security, testing, planning, naming
- L2 Task Runabouts: focused jobs within a domain
- L3 Tool/Worker Agents: file reads, tests, commands, artifact drafting, patches

Parallelism must be DAG-based with dependencies, read/write sets, budgets, and admission control.

The repo now includes static DAG scheduling, dynamic child-task expansion guardrails, task status/mailbox control, and reconciliation foundations. Autonomous side-effect execution and richer admission control remain future work.

## Known Failure Modes

Highest-risk issues:

- Building infrastructure before proving product value
- Silent context divergence from stale evidence
- Confident fabrication under citation pressure
- Summary lossiness at orchestration boundaries
- Reconciliation gaps between parallel branches
- Fan-out and budget runaway
- Deadlocks from dynamic dependencies
- Duplicate work across domain workers
- Discovery loops with no convergence gate
- Artifact theater: impressive docs without actionable decisions
- Host capability mismatch between Codex and Claude Code
- Compression hiding evidence needed for correctness

## Guardrails

Core guardrails:

- Sequential loop only
- Max 3 gather/reason rounds
- JSONL as single source of truth
- Fresh evidence before gate
- Gate before artifact
- Repo-contained path existence checks
- Blocking questions surfaced with assumption fallbacks
- Batch review only

Future guardrails:

- Hard depth ceiling, likely 4
- Default depth 1-2
- Fan-out caps
- Per-branch budgets
- Concurrency token bucket
- Verified citations
- Content-addressed evidence cache
- Read/write-set checks
- Idempotency keys
- Snapshot versions
- Stop-and-report failure behavior
- Human approval for risky actions

## Final Architecture Statement

Wormhole core is a local Claude Code MCP server that provides durable evidence-aware planning state for existing repositories. The current repo also includes implemented orchestration and adaptive foundations for parallel task planning, live control, dynamic spawning guardrails, deterministic routing, bounded model-pool roles, typed artifacts, and static workbench rendering.

It does not try to beat general agents by using more agents. It tests whether a small amount of structure, evidence recording, open-question tracking, and gate enforcement can produce better repo-aware plans.

If the core loop wins the benchmark, the larger Wormhole orchestration system is justified. If it does not, parallel sub-orchestration would only make a weak loop more expensive.
