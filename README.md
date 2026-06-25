# Wormhole

Wormhole is an evidence-aware planning and orchestration state server for AI coding agents.

The core kernel is intentionally small: a local MCP server for existing-repo planning with a JSONL event log, evidence records, an open-question ledger, a batch gate, and one evidence-cited Markdown plan artifact. Handler-owned runtime state is stored separately so agent registries, context packs, optimization records, model profiles, policies, and generated-tool metadata can survive MCP restarts.

The repository also includes implemented orchestration and adaptive foundations: durable native context packs, context-pack budget review and refresh, reversible optimization records and stats, four-layer orchestration, live sub-orchestrator control, adapter-free local orchestration runs, Codex plugin metadata, Claude Desktop extension metadata, graph-first repo indexing with JS/TS/Python symbols and call edges, project contract detection, structured diagnostics, impact-aware verification planning, safety scanning, deterministic semantic fallback search, safe LSP probes, LSP feedback replanning, one-shot project onboarding, process-local LSP sessions, durable repo/semantic indexes, diff-aware test impact, dependency security reports, action admission policy, external optimization adapters, external agent adapters with bounded CLI/HTTP execution, shared agent workspace memory, native printed-tool execution, Printing Press CLI adapters, validated writable tool scaffolds, connector boundaries, first-party optimization primitives, evidence cache, reconciliation, benchmark comparison, deterministic adaptive routing, model-profile learning traces, bounded model-pool roles, dynamic task spawning guardrails, native media ingestion, shell hook management, discovery-driven tool generation, learned orchestration policy gates, safe live policy feedback, orchestration policy baseline comparison, reasoning strategy research, typed artifacts, and a static workbench renderer.

## Current Surface

- Core runnable MCP kernel: `src/cli.ts`
- Persistent local state: `.wormhole/events.jsonl` stores the append-only mission event log; `.wormhole/runtime-state.json` stores handler-owned runtime state such as agents, context packs, diagnostics, optimization records/stats, model profiles, policies, reasoning traces, and Printing Press registrations.
- Core planning tools: `mission_start`, `round_start`, `record_evidence`, `record_question`, `update_question`, `gate_request`, `emit_plan`, `mission_status`
- Task/control/orchestration tools: `task_register`, `task_status_report`, `control_message`, `control_ack`, `task_inbox`, `task_status`, `schedule_tasks`, `orchestration_plan_local`, `orchestration_run_local`, `reconcile_artifacts`
- Context and optimization tools: `ctx_record`, `ctx_pack_query`, `ctx_pack_create`, `ctx_pack_budget_review`, `ctx_pack_refresh`, `ctx_pack_render`, `optimize_text`, `optimization_apply`, `optimization_retrieve`, `optimized_command_run`, `optimization_stats`
- Repo graph tools: `repo_index_build`, `repo_index_query`, `repo_index_explain`, `repo_index_path`, `repo_index_report`, `repo_graph_export`
- Project ground-truth tools: `project_contract_detect`, `dependency_inventory`, `project_command_map`, `diagnostics_from_command`, `diagnostics_from_lsp`, `diagnostics_record`, `diagnostics_query`, `impact_analyze`, `test_plan_select`, `verification_run`, `secret_scan`, `operation_risk_review`, `semantic_index_build`, `semantic_search`, `lsp_probe`, `lsp_server_configs`, `lsp_normalize_location`
- Project intelligence sequencing tools: `project_onboard`, `durable_repo_index_refresh`, `durable_index_status`, `durable_semantic_index_refresh`, `durable_semantic_search`, `test_impact_analyze_v2`, `mission_delta_replan`, `lsp_feedback_replan`, `dependency_security_report`, `action_policy_review`, `lsp_session_start`, `lsp_session_list`, `lsp_session_status`, `lsp_session_request`, `lsp_session_stop`, `optimization_adapter_register`, `optimization_adapter_list`, `optimization_adapter_select`, `optimization_adapter_run`
- Native project intelligence spine tools: `architecture_map`, `entrypoint_flow_discover`, `blast_radius_analyze`, `context_pack_generate`
- Agent-facing routing tools: `project_intelligence_snapshot`, `next_best_tool`, `mission_route`, `agent_context_prepare`
- Native agent behavior verification tools: `agent_remit_create`, `agent_capability_inventory`, `agent_behavior_verify`, `remit_coverage_report`, `agent_drift_analyze`, `behavior_findings_render`
- Agent and generated-tool tools: `agent_register`, `agent_list`, `agent_dispatch`, `agent_dispatch_execute`, `agent_status`, `agent_complete`, `agent_interrupt`, `agent_workspace_create`, `agent_workspace_write`, `agent_workspace_read`, `agent_workspace_merge`, `printing_press_register`, `printing_press_list`, `printing_press_select`, `printing_press_register_agent`, `printing_press_verify`, `printing_press_run`, `tool_factory_generate`, `tool_factory_validate`, `tool_factory_write`
- Adaptive/model/policy tools: `route_mission`, `model_profile_register`, `model_profile_select`, `model_profile_record_outcome`, `model_profile_export_traces`, `conductor_plan`, `conductor_replay`, `behavior_mode_set`, `behavior_mode_get`, `behavior_apply`, `behavior_minimality_review`, `orchestration_trace_record`, `orchestration_dataset_export`, `orchestration_policy_train`, `orchestration_policy_evaluate`, `orchestration_policy_compare_baselines`, `orchestration_policy_activate`, `orchestration_policy_get`, `orchestration_policy_live_feedback`, `reasoning_trace_record`, `reasoning_dataset_export`, `reasoning_strategy_evaluate`
- Media, shell, discovery, Python, and artifact tools: `media_dependency_report`, `media_ingest_pdf`, `media_ingest_image`, `shell_hook_discover`, `shell_hook_plan`, `shell_hook_install`, `shell_hook_uninstall`, `shell_hook_verify`, `discovery_har_import`, `discovery_openapi_import`, `discovery_http_crawl`, `discovery_browser_capture`, `discovery_tool_spec_generate`, `python_sidecar_probe`, `python_graph_metrics`, `python_graph_communities`, `python_trace_summary`, `cache_evidence`, `codex_adapter_config`, `select_connector`, `create_artifact`, `render_workbench`
- Native context and optimization: source-backed durable context records, budgeted context packs, explicit context-pack eviction review, reversible command/JSON/log optimization records, retrieval handles, dense summaries, minimality review, optimized command execution, and persisted aggregate savings stats
- Live control plane: heartbeat/status, mailbox queries, advisory messages, direction-change pause/ack, and immediate interrupts
- Orchestration foundations: static and dynamic DAG scheduling with read/write locks, adapter-free local orchestration planning/execution, content-addressed evidence cache, reconciliation, benchmark comparison runner, repo graph indexing and query/explain/path/report/export tools, project contract/diagnostic/impact/verification/safety/semantic/LSP probe tools, one-shot onboarding, native architecture maps, entrypoint flow discovery, blast-radius analysis, task-scoped project context packs, automatic mission-delta replanning, LSP feedback replanning, agent-facing routing and next-tool recommendations, shared agent workspace memory, native remit-to-behavior verification, durable indexes, process-local LSP sessions, dependency security reports, action policy, optimization adapters, Codex adapter config, Claude Desktop MCPB metadata, external agent dispatch and CLI/HTTP execution, printed-tool verification/execution/evidence capture, safe generated-tool scaffold validation/writes, adaptive model routing, safe live policy feedback, model-profile learning traces, bounded model-pool roles, connector registry, typed artifact records, and static workbench HTML rendering
- Repo index safety: MCP-exposed repo index roots must stay under an allowed workspace root. The default allowed root is the server working directory; set `WORMHOLE_ALLOWED_REPO_ROOTS` to a comma- or semicolon-separated list when a host needs additional repo roots.
- Benchmark fixtures: `benchmarks/fixtures` and `benchmarks/repos`
- Codex plugin scaffold: `plugins/wormhole`
- Capability manifest: `src/capabilities.ts`

## Native Runtime Suite

Wormhole implements these runtime surfaces as first-class native capabilities:

- Repo graph artifacts: `repo_index_*`, `repo_graph_export`, JS/TS/Python symbol and import extraction, basic call-reference edges, Python graph metrics, and graph communities.
- Project ground truth: `project_contract_detect`, `diagnostics_*`, `impact_analyze`, `test_plan_select`, `verification_run`, `secret_scan`, `operation_risk_review`, `semantic_*`, and `lsp_*`.
- Project-intelligence sequencing: `project_onboard`, durable index tools, LSP session tools, `test_impact_analyze_v2`, `mission_delta_replan`, `dependency_security_report`, `action_policy_review`, and `optimization_adapter_*`.
- Coordination feedback loop: `ctx_pack_budget_review`, `ctx_pack_refresh`, `lsp_feedback_replan`, `agent_workspace_*`, and `orchestration_policy_live_feedback`.
- Native project-intelligence spine: `architecture_map`, `entrypoint_flow_discover`, `blast_radius_analyze`, and `context_pack_generate`.
- Agent-facing routing: `project_intelligence_snapshot`, `next_best_tool`, `mission_route`, and `agent_context_prepare`.
- Agent behavior verification: `agent_remit_create`, `agent_capability_inventory`, `agent_behavior_verify`, `remit_coverage_report`, `agent_drift_analyze`, and `behavior_findings_render` implement native declared-intent versus observed-capability checks.
- Optimized command runner: `optimization_apply`, `optimization_retrieve`, `optimized_command_run`, and `optimization_stats`.
- Native tool factory: `printing_press_*` runtime tools plus `tool_factory_generate`, `tool_factory_validate`, and `tool_factory_write`.
- Deterministic conductor: `model_profile_*`, `conductor_plan`, and `conductor_replay`.
- Durable behavior policy: `behavior_mode_set`, `behavior_mode_get`, `behavior_apply`, and `behavior_minimality_review`.
- Agent dispatch runtime: `agent_dispatch_execute` runs configured local CLI or HTTP agents with bounded execution and evidence hashes.
- Advanced native capabilities: `media_*`, `shell_hook_*`, `discovery_*`, `orchestration_policy_*`, and `reasoning_*`.

These features are native Wormhole capabilities. Runtime state is local JSON and not a replacement for the mission event log; repo index caches and shell-hook apply tokens remain process-local by design. Media extraction uses repo-confined realpath checks, byte hashing, and optional Python dependencies; shell hooks are opt-in, marker-based, planned with a token, and backed up before writes; discovery redacts secrets before tool generation and denies private-network crawling unless explicitly enabled; browser capture is complementary input rather than Wormhole's core runtime; learned policy remains offline-trained, baseline-compared, stored-evaluation-gated, and safety-clamped; reasoning research traces score plan, critique, revision, and verifier strategies.

## Optional Python Sidecar

Wormhole's core MCP server is TypeScript and does not require Python. When Python 3 is available, Wormhole can run optional sidecar jobs for deterministic graph metrics, graph community analysis, media extraction, model-profile trace summaries, and offline policy training/evaluation through `python_sidecar_probe`, `python_graph_metrics`, `python_graph_communities`, `media_dependency_report`, `media_ingest_pdf`, `media_ingest_image`, `python_trace_summary`, `orchestration_policy_train`, and `orchestration_policy_evaluate`.

Set `WORMHOLE_PYTHON` when the host should use a specific interpreter. Set `WORMHOLE_PYTHONPATH` only when the sidecar package is outside the repo-local `python` directory.

Optional richer media extraction packages are listed in `python/requirements-media.txt`. Without them, media tools return structured dependency warnings rather than making Python required.

## Acknowledgements

Several open-source projects and research systems influenced Wormhole's native orchestration work:

- [Graphify](https://github.com/safishamsi/graphify) informed the graph-first repo index direction, especially provenance-aware relationships and graph reports.
- [Praxen](https://github.com/open-agent-ai-security/praxen) informed the declared-remit versus observed-behavior verification direction, especially rule coverage, capability drift, and deterministic findings reports.
- [Headroom](https://github.com/headroomlabs-ai/headroom) and [RTK](https://github.com/rtk-ai/rtk) informed reversible context optimization, retrieval handles, and deterministic output compaction.
- [Printing Press](https://printingpress.dev/) informed the printed-tool registry, verification, execution, and evidence-capture model.
- [Sakana Fugu](https://sakana.ai/fugu/) informed the model-profile routing and trace-first learning direction.
- [Caveman](https://github.com/JuliusBrussee/caveman) and [Ponytail](https://github.com/DietrichGebert/ponytail) informed the dense-output and minimality-review primitives.

These are acknowledgements of design influence; Wormhole implements its current runtime capabilities natively.

## Local Commands

```bash
npm install
npm test
npm run typecheck
npm run build
npm run benchmarks:validate
npm run benchmarks:run
```

## Claude Code

Build first, then attach Claude Code to the MCP server command:

```bash
node dist/src/cli.js
```

## Claude Desktop

Build first, then install the unpacked extension from `plugins/wormhole-claude-desktop` in Claude Desktop developer settings:

```bash
npm run build
```

The extension manifest follows the MCPB `manifest_version` 0.3 shape and launches `dist/src/cli.js` through `plugins/wormhole-claude-desktop/server/index.js`.

## Codex

The repo-local plugin metadata is in `plugins/wormhole/.codex-plugin/plugin.json`.

The plugin MCP config points to `../../dist/src/cli.js` from `plugins/wormhole`, so run `npm run build` before local plugin testing.

## Planning Docs

- Canonical plan: [docs/planning/wormhole-canonical-plan.md](docs/planning/wormhole-canonical-plan.md)
- Orchestration and adaptive architecture: [docs/architecture/orchestration-adaptive-capabilities.md](docs/architecture/orchestration-adaptive-capabilities.md)
- Capability contract: [docs/contracts/capability-manifest.md](docs/contracts/capability-manifest.md)
