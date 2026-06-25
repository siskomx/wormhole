# Wormhole

Wormhole is an evidence-aware planning and orchestration state server for AI coding agents.

The core kernel is intentionally small: a local MCP server for existing-repo planning with a JSONL event log, evidence records, an open-question ledger, a batch gate, and one evidence-cited Markdown plan artifact.

The repository also includes implemented orchestration and adaptive foundations: native context packs, reversible optimization records, four-layer orchestration, live sub-orchestrator control, adapter-free local orchestration runs, Codex plugin metadata, Claude Desktop extension metadata, graph-first repo indexing with provenance reports, external agent adapters, native printed-tool execution, Printing Press CLI adapters, connector boundaries, first-party optimization primitives, evidence cache, reconciliation, benchmark comparison, deterministic adaptive routing, model-profile learning traces, bounded model-pool roles, dynamic task spawning guardrails, typed artifacts, and a static workbench renderer.

## Current Surface

- Core runnable MCP kernel: `src/cli.ts`
- Core, orchestration, and adaptive tool surface: `mission_start`, `round_start`, `record_evidence`, `record_question`, `update_question`, `task_register`, `task_status_report`, `control_message`, `control_ack`, `task_inbox`, `task_status`, `gate_request`, `emit_plan`, `mission_status`, `optimize_text`, `optimization_apply`, `optimization_retrieve`, `ctx_record`, `ctx_pack_query`, `ctx_pack_create`, `ctx_pack_render`, `cache_evidence`, `schedule_tasks`, `orchestration_plan_local`, `orchestration_run_local`, `reconcile_artifacts`, `route_mission`, `codex_adapter_config`, `select_connector`, `create_artifact`, `render_workbench`, `repo_index_build`, `repo_index_query`, `repo_index_explain`, `repo_index_path`, `repo_index_report`, `agent_register`, `agent_list`, `agent_dispatch`, `agent_status`, `agent_complete`, `agent_interrupt`, `printing_press_register`, `printing_press_list`, `printing_press_select`, `printing_press_register_agent`, `printing_press_verify`, `printing_press_run`, `model_profile_register`, `model_profile_select`, `model_profile_record_outcome`, `model_profile_export_traces`
- JSONL state: `.wormhole/events.jsonl` in the working directory
- Native context and optimization: source-backed context records, budgeted context packs, reversible command/JSON/log optimization records, retrieval handles, dense summaries, and minimality review
- Live control plane: heartbeat/status, mailbox queries, advisory messages, direction-change pause/ack, and immediate interrupts
- Orchestration foundations: static and dynamic DAG scheduling with read/write locks, adapter-free local orchestration planning/execution, content-addressed evidence cache, reconciliation, benchmark comparison runner, repo graph indexing and query/explain/path/report tools, Codex adapter config, Claude Desktop MCPB metadata, external agent dispatch, printed-tool verification/execution/evidence capture, adaptive model routing, model-profile learning traces, bounded model-pool roles, connector registry, typed artifact records, and static workbench HTML rendering
- Repo index safety: MCP-exposed repo index roots must stay under an allowed workspace root. The default allowed root is the server working directory; set `WORMHOLE_ALLOWED_REPO_ROOTS` to a comma- or semicolon-separated list when a host needs additional repo roots.
- Benchmark fixtures: `benchmarks/fixtures` and `benchmarks/repos`
- Codex plugin scaffold: `plugins/wormhole`
- Capability manifest: `src/capabilities.ts`

## Near-Equivalent Runtime Suite

Wormhole implements native runtime equivalents for the practical parts of several systems that influenced its design:

- Graphify-near: `repo_index_*`, `repo_graph_export`, Python graph metrics, and graph communities.
- Headroom/RTK-near: `optimization_apply`, `optimization_retrieve`, `optimized_command_run`, and `optimization_stats`.
- Printing Press-near: `printing_press_*` runtime tools and `tool_factory_generate`.
- Fugu-near: `model_profile_*`, `conductor_plan`, and `conductor_replay`.
- Caveman/Ponytail-near: `behavior_mode_set`, `behavior_mode_get`, `behavior_apply`, and `behavior_minimality_review`.

These features are native Wormhole capabilities. They do not vendor the external projects and do not claim full product parity for multimodal extraction, shell hooks, website crawling, or learned RL orchestration.

## Optional Python Sidecar

Wormhole's core MCP server is TypeScript and does not require Python. When Python 3 is available, Wormhole can run optional sidecar jobs for deterministic graph metrics, graph community analysis, and model-profile trace summaries through `python_sidecar_probe`, `python_graph_metrics`, `python_graph_communities`, and `python_trace_summary`.

Set `WORMHOLE_PYTHON` when the host should use a specific interpreter. Set `WORMHOLE_PYTHONPATH` only when the sidecar package is outside the repo-local `python` directory.

## Acknowledgements

Several open-source projects and research systems influenced Wormhole's native orchestration work:

- [Graphify](https://github.com/safishamsi/graphify) informed the graph-first repo index direction, especially provenance-aware relationships and graph reports.
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
