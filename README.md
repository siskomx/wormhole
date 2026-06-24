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
