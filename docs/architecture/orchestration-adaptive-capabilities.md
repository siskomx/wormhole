# Wormhole Orchestration And Adaptive Capabilities

This document defines the implemented orchestration and adaptive foundations beyond the runnable core MCP kernel, plus the remaining future extension points.

The core area proves the evidence loop. The orchestration area adds bounded parallel work, local runs, live control, caches, reconciliation, adapters, and repo graph indexing. The adaptive area adds routing, connector selection, model-pool roles, dynamic spawning, typed artifacts, and workbench surfaces. All areas keep the same rule: evidence, questions, gates, and artifacts remain authoritative state.

## Capability Areas

| Area | Status | Purpose |
| --- | --- | --- |
| Core | Implemented foundation | Local MCP planning kernel, JSONL state, evidence records, question ledger, gate, Markdown plan artifact, benchmark fixtures. |
| Orchestration | Implemented foundation | First-party optimization primitives, live sub-orchestrator control, four-layer task records, static DAG scheduling, adapter-free local orchestration runs, content-addressed evidence cache, reconciliation, repo graph indexing, Codex adapter config, Claude Desktop extension metadata, external agent adapters, Printing Press CLI adapters, and benchmark comparison runner. |
| Adaptive | Implemented foundation | Adaptive model/provider routing, graph-first codebase query workflow, connector registry, dynamic DAG spawning guardrails, bounded model-pool roles, native media ingestion, shell hooks, discovery-driven tool generation, learned policy gates, orchestration policy lab, reasoning strategy research, typed artifacts, and static workbench rendering. |

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

Orchestration parallelism is static DAG parallelism first and is implemented through `createDagSchedule` and `runDagSchedule`. Adaptive scheduling adds bounded dynamic expansion through `runDynamicDagSchedule`.

- Tasks declare dependencies.
- Tasks declare read and write sets.
- Conflicting write sets are separated into later waves.
- Write tasks can be routed through Airlock approval before side effects.
- Merge points reconcile artifacts and questions before the next gate.
- Dynamic spawning is allowed only when a worker returns declared child tasks.
- Spawned children must be deeper than the parent, cannot exceed depth 4, cannot duplicate task ids, and are capped by the caller's max-task budget.
- Fan-out is capped per layer and per mission by the scheduler caller.

## Local Orchestration Runner

Wormhole includes an adapter-free local orchestration runner for hosts that want first-party planning and deterministic execution without invoking external agents.

- `orchestration_plan_local` validates task ids, dependencies, max depth, max task budget, and read/write lock waves without executing work.
- `orchestration_run_local` executes the same local DAG semantics from caller-supplied deterministic task outcomes. It tracks completed, failed, blocked, and dynamically spawned local tasks.
- Spawned local tasks must be deeper than their parent layer, within `maxDepth`, and inside the `maxTasks` budget.

This runner is not a process supervisor and does not spawn Claude, Codex, Hermes, Pi, Printing Press, or provider APIs. It turns the existing scheduler and dynamic-spawn guardrails into a first-party run record that can be used by a host or test harness.

## Reconciliation And Cache

Child artifacts merge through `reconcileArtifacts`, which preserves evidence provenance and surfaces read/write conflicts for parent review.

Raw source content can be stored through `createEvidenceCache`, which writes content-addressed SHA-256 records and allows compressed views to remain separate from the source of truth. The exposed `cache_evidence` MCP tool confines cache roots under the supplied `repoRoot`, or under the server working directory when no `repoRoot` is supplied.

## Repo Index And Graph Query

Wormhole includes a native Graphify-style repo index for codebase discovery. It is intentionally deterministic and local: it walks supported text/source files, skips generated/vendor directories, extracts TypeScript/JavaScript symbols and Markdown sections, resolves local imports and links, and exposes graph query primitives through MCP.

The tools are:

- `repo_index_build`: build or rebuild an in-memory file, symbol, import, link, and reference graph for a repo root.
- `repo_index_query`: search the graph and indexed snippets before broad grep or raw file reads.
- `repo_index_explain`: explain a file or symbol using indexed symbols plus inbound and outbound edges.
- `repo_index_path`: find a graph path between two files or symbols.
- `repo_index_report`: render a deterministic native graph report with edge provenance counts and top connected files.

Edges carry explicit provenance and confidence: source-backed definitions/imports/links are `extracted` with confidence `1`, while text references are `inferred` with lower confidence. This is not a replacement for source evidence. Query results are discovery hints; important claims still need `record_evidence` entries with source paths and line ranges before the gate opens. The capability model also declares a `graphify` connector target so a full external Graphify graph or MCP server can be registered later without changing the Wormhole mission loop.

The MCP-exposed repo index tools are confined to allowed workspace roots. By default, the only allowed root is the server working directory. Hosts can set `WORMHOLE_ALLOWED_REPO_ROOTS` to a comma- or semicolon-separated allowlist when they need multiple repo roots. Index caches are keyed by repo root plus build options and refreshed from a content fingerprint before query, explain, or path operations. `include` and `exclude` are path patterns: plain names match path segments, slash-containing values match exact paths or descendants, and `*`/`**`/`?` provide glob-style matching.

## Project Ground Truth Suite

Wormhole includes first-party project-onboarding tools for agents entering a new or changed repository:

- `project_contract_detect`, `dependency_inventory`, and `project_command_map` detect package-manager state, scripts, lockfiles, dependencies, env hints, and ports.
- `diagnostics_from_command`, `diagnostics_from_lsp`, `diagnostics_record`, and `diagnostics_query` normalize and persist compiler, test, command, and LSP diagnostics.
- `impact_analyze` combines changed files with repo graph edges and test-file heuristics.
- `test_plan_select` creates focused verification commands from project contracts and impact analysis.
- `verification_run` executes selected checks through the optimized command runner, preserving hashes and compacted output.
- `secret_scan` and `operation_risk_review` provide lightweight preflight safety checks before agents run risky actions.
- `semantic_index_build` and `semantic_search` provide a deterministic local fallback when an embedding provider is unavailable.
- `lsp_probe`, `lsp_server_configs`, and `lsp_normalize_location` provide safe language-server startup config discovery and protocol normalization. This slice does not start or supervise long-lived language-server processes.

These tools are repo-root confined where they read project files. They complement the repo graph; source-backed claims still need evidence records before the gate opens.

## Project Intelligence Sequencing

Project intelligence sequencing composes the ground-truth tools into a higher-level onboarding and admission layer:

- `project_onboard` runs contract detection, durable repo indexing, LSP probe, safety scan, diff/test impact, verification-plan selection, dependency security, action policy, and optional semantic search in one report.
- `durable_repo_index_refresh`, `durable_index_status`, `durable_semantic_index_refresh`, and `durable_semantic_search` persist index data under `.wormhole/indexes`.
- `test_impact_analyze_v2` maps unified diff hunks to changed symbols and confidence-scored test recommendations.
- `mission_delta_replan` and `lsp_feedback_replan` re-scope missions from changed files, diagnostics, stale evidence, and LSP/typecheck feedback.
- `dependency_security_report` summarizes package/lockfile metadata, direct and transitive counts, license data, and local-only vulnerability-provider status.
- `action_policy_review` classifies proposed commands, file writes, deletes, tool writes, and network actions with approval and rollback guidance.
- `patch_checkpoint`, `patch_apply`, `patch_status`, and `patch_rollback` provide repo-confined unified-diff transactions with before-content snapshots and rollback metadata.
- `lsp_session_start`, `lsp_session_request`, `lsp_session_status`, `lsp_session_list`, and `lsp_session_stop` provide bounded process-local JSON-RPC session management for installed language servers.
- `optimization_adapter_register`, `optimization_adapter_select`, `optimization_adapter_list`, and `optimization_adapter_run` implement native, CLI, and HTTP optimization adapter contracts.

These tools still keep TypeScript authoritative for gates, schemas, process bounds, and repo-root confinement. Live LSP behavior depends on installed server binaries; unavailable commands return structured unavailable results.

## Native Coordination Feedback Loop

Wormhole now has native coordination tools for the mid-session states that usually cause large-agent drift:

- `ctx_pack_budget_review` explains which context records will be retained or evicted from a budgeted pack using pinned records, stale-record ids, changed-file relevance, query score, and explicit eviction reasons.
- `ctx_pack_refresh` creates a refreshed context pack from that review instead of silently truncating context.
- `lsp_feedback_replan` normalizes LSP diagnostics, records them in runtime diagnostics, infers repo-relative changed files, and feeds `mission_delta_replan`.
- `agent_workspace_create`, `agent_workspace_write`, `agent_workspace_read`, and `agent_workspace_merge` provide shared mission workspace memory for concurrent agents, with run attribution, provenance, snapshot persistence, and conflict detection.
- `orchestration_policy_live_feedback` records live outcomes and returns bounded advisory hints. It does not train or activate learned policies; activation remains replay-gated through `orchestration_policy_evaluate` and `orchestration_policy_activate`.

## Native Project Intelligence Spine

Wormhole now exposes a native project-intelligence spine above the repo index and project ground-truth tools. The spine treats architecture, entrypoints, blast radius, and context packs as typed Wormhole observations instead of external-tool summaries.

The tools are:

- `architecture_map`: groups indexed files into modules, attaches CODEOWNERS-style ownership, summarizes symbols, entrypoint counts, dependencies, dependents, and evidence.
- `entrypoint_flow_discover`: detects API, CLI, worker, and package-script entrypoints and links them to downstream repo files through the native repo graph.
- `blast_radius_analyze`: maps changed files and diff hunks to changed symbols, impacted files, impacted modules, impacted entrypoints, and confidence-scored likely tests.
- `context_pack_generate`: renders a task-scoped context pack from architecture, entrypoints, blast radius, and relevant source snippets within a caller-supplied character budget.

External tools can still sync observations into future versions of this model, but Wormhole's native tools remain the default source of project intelligence. Imported observations should carry provenance, confidence, source tool identity, and repo fingerprint metadata before they influence gates or context packs.

## Agent-Facing Routing

Wormhole now exposes a curated routing layer above the broad MCP tool surface. These tools are for agents that need to know what to call next without choosing manually from every low-level capability.

The tools are:

- `project_intelligence_snapshot`: returns a compact orientation snapshot, route recommendation, and default tool sequence.
- `next_best_tool`: recommends the next Wormhole tool call from completed tools, task objective, and changed files.
- `mission_route`: creates an ordered route through orientation, impact, context, verification, and gate stages.
- `agent_context_prepare`: prepares a route, snapshot, context pack, immediate next calls, and agent instructions for the task.

The routing layer is advisory. It does not bypass evidence recording, verification, action policy, or gate requirements; it narrows the default path so agents start from the most useful Wormhole tools before falling back to lower-level graph, diagnostic, discovery, or adapter tools.

## External Agent Adapters

External AI agents and model providers are registered as bounded Wormhole workers through `agent_register`.

Supported worker shapes include:

- MCP-capable agents such as Hermes Agent through `mcp-stdio` or `mcp-http`.
- HTTP, CLI, SDK, or provider API wrappers for model-style agents such as Inflection Pi.
- Human-controlled clients such as Claude Code, Claude Desktop, and Codex when they call the generic MCP tools.

Wormhole remains the source of truth. External agents receive dispatched task objectives and payloads through `agent_dispatch`, report back through `agent_complete`, expose current state through `agent_status`, and can be interrupted through `agent_interrupt` when the registered adapter supports interrupts.

The adapter contract tracks declared capabilities, installation/authentication policy, concurrency, interrupt support, evidence IDs, artifact IDs, and task run status. It does not assume every external agent can spawn durable work or obey live interrupts; those behaviors must be declared by the adapter.

## Printing Press CLI Adapters

Printing Press generated CLIs and MCP servers are registered through `printing_press_register`.

The Printing Press contract tracks:

- CLI id, display name, command, and default args.
- Declared capabilities such as `project-management`, `evidence`, `sqlite-query`, `research`, or `commerce`.
- Installation and authentication policy.
- Evidence mode: `compact`, `raw`, or `sqlite`.
- Whether the printed tool also provides an MCP server.
- Concurrency and interrupt support.

Wormhole can select a printed CLI with `printing_press_select`, verify it with `printing_press_verify`, run it with `printing_press_run`, and convert it into a dispatchable external worker with `printing_press_register_agent`. Native runs capture stdout, stderr, exit code, timeout status, and immutable evidence hashes. Printing Press tools therefore remain subordinate to Wormhole's task graph and evidence gate instead of becoming separate orchestrators.

Wormhole's tool factory is implemented as a bounded native tool-spec pipeline: HAR/OpenAPI imports, HTTP crawl observations, optional browser-capture observations, and deterministic generated tool specs feed the Wormhole `tool_factory_generate` path. Generated tools remain subordinate to Wormhole's task graph and evidence gate.

## Native Runtime Suite

Wormhole implements these runtime surfaces as first-class native capabilities:

- Repo graph artifacts: `repo_index_*`, `repo_graph_export`, `python_graph_metrics`, and `python_graph_communities`.
- Repo activity watch layer: `repo_watch_*`, `repo_change_scan`, `repo_activity_record`, and `repo_graph_refresh_incremental`.
- Project ground truth: `project_contract_detect`, `diagnostics_*`, `impact_analyze`, `test_plan_select`, `verification_run`, `secret_scan`, `operation_risk_review`, `semantic_*`, and `lsp_*`.
- Project-intelligence sequencing: `project_onboard`, durable index tools, LSP session tools, `test_impact_analyze_v2`, `dependency_security_report`, `action_policy_review`, patch transaction tools, and `optimization_adapter_*`.
- Coordination feedback loop: `ctx_pack_budget_review`, `ctx_pack_refresh`, `lsp_feedback_replan`, `agent_workspace_*`, and `orchestration_policy_live_feedback`.
- Optimized command runner: `optimization_apply`, `optimization_retrieve`, `optimized_command_run`, and `optimization_stats`.
- Native tool factory: `printing_press_*` runtime tools and `tool_factory_generate`.
- Deterministic conductor: `model_profile_*`, `conductor_plan`, and `conductor_replay`.
- Durable behavior policy: `behavior_mode_set`, `behavior_mode_get`, `behavior_apply`, and `behavior_minimality_review`.

TypeScript remains authoritative for MCP schemas, state projection, gates, evidence, routing policy, and plugin packaging. Python is required from startup and receives one JSON request at a time for graph metrics, graph communities, media extraction, trace summaries, and offline policy jobs. Python results are treated as derived analysis and do not decide whether a gate opens.

The native runtime suite includes advanced capability tracks for media ingestion, shell hooks, discovery-driven tool generation, and learned orchestration policy. These tracks are constrained by the same evidence, path, and approval boundaries as the rest of Wormhole.

Repo activity watching is opt-in per session. A watch session stores a baseline snapshot, detects added/modified/deleted files on scan, captures git status and diff text when the repo has `.git`, records factual activity events, can record mission evidence for observed changes, and can refresh the durable repo graph after changes. The layer records what changed or what command/verification was explicitly reported; it does not infer agent intent from file diffs alone.

```mermaid
flowchart LR
  "PDF/Image" --> "TypeScript path gate"
  "TypeScript path gate" --> "Python media sidecar"
  "HAR/OpenAPI/HTTP" --> "Discovery observations"
  "Discovery observations" --> "Tool factory"
  "Conductor traces" --> "Policy trainer"
  "Policy trainer" --> "Policy evaluator"
  "Policy evaluator" --> "Safety-clamped activation"
```

## Advanced Native Tracks

Media ingestion exposes `media_dependency_report`, `media_ingest_pdf`, and `media_ingest_image`. TypeScript validates repo roots and file size limits before Python sees a path. The Python runtime is required; media packages such as `pypdf`, `Pillow`, and OCR support are reported independently, with missing package or system dependencies becoming structured warnings unless OCR is explicitly required.

Shell hooks expose `shell_hook_discover`, `shell_hook_plan`, `shell_hook_install`, `shell_hook_uninstall`, and `shell_hook_verify`. Plans are dry-run-first and return a plan token tied to file hashes. Installs use marker blocks, backups, and idempotent replacement, and reject stale plans. Cmd AutoRun support is guarded behind explicit registry permission.

Discovery exposes `discovery_har_import`, `discovery_openapi_import`, `discovery_http_crawl`, `discovery_browser_capture`, and `discovery_tool_spec_generate`. Sensitive headers are redacted before hashing or returning observations. Crawls are bounded and deny loopback/private/link-local hosts unless private-network crawling is explicitly enabled. Mutating API methods are marked side-effecting in generated specs.

Learned orchestration exposes `orchestration_trace_record`, `orchestration_dataset_export`, `orchestration_policy_train`, `orchestration_policy_evaluate`, `orchestration_policy_compare_baselines`, `orchestration_policy_activate`, `orchestration_policy_get`, and `orchestration_policy_live_feedback`. Policies train offline from traces, compare against deterministic safe baselines, produce stored evaluation IDs, replay before activation, and are clamped at runtime. Live feedback records outcomes and returns advisory hints only. A learned policy cannot bypass max depth, budgets, evidence gates, shell apply requirements, or approvals.

The orchestration policy lab expands the learned action space beyond worker/verifier/depth/model selection. Policy actions can also describe split strategy, context budget, evidence mode, and stop rule. These fields stay bounded to safe enums and are advisory: the TypeScript runtime still owns conductor decisions, task budgets, gates, and approvals.

Reasoning research exposes `reasoning_trace_record`, `reasoning_dataset_export`, and `reasoning_strategy_evaluate`. Traces score plan, critique, revision, and verifier behavior from evidence coverage, open-question resolution, outcome labels, and user corrections. Strategy evaluation is for research and routing guidance; it does not replace the evidence gate or claim proof of correctness.

Browser and HAR/API discovery remain complementary inputs. `discovery_browser_capture` can provide network observations for tool generation and evidence gathering, but Wormhole does not make a full browser agent its core runtime.

## Connector Model

Wormhole should work through a generic MCP server first.

Client-specific compatibility is expressed as adapters:

- Claude Code: attach to the MCP stdio server.
- Claude Desktop: install the MCPB-compatible scaffold in `plugins/wormhole-claude-desktop`.
- Codex: consume `plugins/wormhole/.codex-plugin/plugin.json` and `plugins/wormhole/.mcp.json`.
- Printing Press: register generated CLIs and MCP servers through `printing_press_register`, verify and run them through the native printed-tool runtime, then convert them into Wormhole workers when useful.
- Graphify: use the native `repo_index_*` graph tools by default, or represent an external Graphify graph through the `graphify` connector target when one is available.
- Hermes Agent, Inflection Pi, and other agents: register through the external agent adapter contract when they expose a controllable MCP, HTTP, CLI, SDK, or provider API boundary.
- Other clients: implement the connector manifest and call the generic MCP tools.

The repo-local Codex plugin points to `../../dist/src/cli.js` from `plugins/wormhole`, so local plugin testing requires `npm run build` first.

The repo-local Claude Desktop extension manifest points to `server/index.js` from `plugins/wormhole-claude-desktop`; the wrapper launches the built `dist/src/cli.js`, so local extension testing also requires `npm run build` first.

## Optimization Providers

Orchestration includes deterministic first-party optimization primitives:

- RTK-like command-output compaction through `compactCommandOutput`
- Headroom-like context compression through `compressContext`
- Caveman-style dense response profiles through `createDenseSummary`
- Ponytail-style minimality rubrics through `reviewMinimality`
- Reversible optimization records through `optimization_apply` and `optimization_retrieve`
- Source-backed context packs through `ctx_record`, `ctx_pack_query`, `ctx_pack_create`, and `ctx_pack_render`

Provider output must retain provenance. Compressed text can help the model, but the JSONL event log, context record handles, retrieval IDs, and source handles remain the source of truth.

External RTK, Headroom, Caveman, or Ponytail adapters can be added later. The Wormhole-native primitives remain the baseline behavior.

## Adaptive Routing

Adaptive routing includes deterministic Fugu-inspired routing through `selectRoutingPlan` and bounded model-pool orchestration through `runModelPool`.

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

The native model-profile layer adds deterministic small-model profile learning through `model_profile_register`, `model_profile_select`, `model_profile_record_outcome`, and `model_profile_export_traces`. This records routing traces and outcomes for later replay without claiming learned Fugu-style orchestration.

`runModelPool` provides the first implemented role taxonomy:

- Thinker: decomposes, critiques, and identifies gaps.
- Worker: drafts scoped work from the thinker output.
- Verifier: checks the worker output and returns a verified or partial result.

Each model-pool run has an explicit turn budget. Budget exhaustion returns a partial result with trace data instead of silently continuing. External provider marketplaces and benchmark-trained model-pool selection can be added as separate connector and policy layers.

## Connector Registry

The connector registry lets Wormhole select a compatible target by declared capabilities rather than assuming every host supports the same tools. `createConnectorRegistry` supports Codex, Claude Code, and future connectors with installation and authentication policy metadata.

## Workbench And Artifacts

Adaptive artifacts include typed artifact records through `createArtifactRecord` and the `create_artifact` MCP tool.

Supported artifact types:

- `plan`
- `json_report`
- `html_workbench`
- `patch_plan`
- `benchmark_report`

Adaptive workbench support also includes a static Promenade-style view through `createWorkbenchSnapshot`, `renderWorkbenchHtml`, and the `render_workbench` MCP tool. The workbench renders mission, task, gate, and artifact state without becoming the source of truth. The JSONL event log and typed state records remain authoritative.

## Non-Negotiable Guardrails

- Fresh evidence before gate.
- Gate before final artifact.
- Human approval before risky side effects.
- Maximum depth 4.
- Parents own budgets.
- Children cannot silently expand scope.
- Provider/model choices are logged.
- A partial result must say what is missing.
