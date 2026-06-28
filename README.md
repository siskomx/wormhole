# Wormhole

Wormhole is an evidence-aware MCP operating layer for AI coding agents. It is not an autonomous agent by itself; it is the local control plane that gives agents mission state, repo intelligence, context routing, evidence gates, verification guidance, and safer write/execute workflows.

## What It Provides

- Mission kernel: mission rounds, evidence records, open questions, gate checks, and evidence-cited plan artifacts.
- Agent routing: `agent_context_prepare`, `mission_route`, `next_best_tool`, `tool_layer_map`, `tool_exposure_profile`, and `tool_catalog_query`.
- Repo intelligence: SQLite-backed durable repo indexes, JSON compatibility exports, project contracts, architecture maps, entrypoint discovery, blast-radius analysis, context packs, repo blueprint/constraint artifacts, app-process/product/roadmap/backlog artifacts, progressive blueprint lane artifacts, and cached project models/derived intelligence for repeated large-repo calls.
- State maintenance: `state_maintenance_run`, `state_maintenance_status`, and `state_maintenance_retry` coordinate graph refresh, context refresh, source-conflict analysis, durable freshness checks, evidence capture, route refresh, and workspace updates.
- Verification and safety: focused test planning, command/LSP diagnostics, dependency and secret scans, action policy review, privileged tool admission review, and patch transactions with rollback.
- Agent collaboration: task registration, control messages, shared workspace memory, external agent adapters, behavior/remit verification, generated-tool validation, and static workbench artifacts.
- Optional advanced surfaces: Python-backed graph/media/policy jobs, discovery imports, shell-hook planning, adaptive routing, model profiles, and policy research traces.

The authoritative tool/capability list lives in `src/capabilities.ts`; the README intentionally stays concise.

## Runtime State

- MCP entrypoint: `src/cli.ts`
- Event log: `.wormhole/events.jsonl`
- Handler runtime state: `.wormhole/runtime-state.json`
- App-process run state: `.wormhole/app-process/run-state.json` and `.wormhole/app-process/events.jsonl`
- Durable indexes: `.wormhole/indexes` stores SQLite repo indexes plus JSON compatibility exports/manifests.
- Codex plugin metadata: `plugins/wormhole/.codex-plugin/plugin.json`
- Claude Desktop extension metadata: `plugins/wormhole-claude-desktop`

The `.wormhole` directory is local runtime state and is ignored by git.

## Agent Workflow

For coding agents, the intended path is:

1. Start with `app_process_compile`, `app_process_write_artifacts`, `blueprint_compile_repo`, `blueprint_write_artifacts` (`progressive: true` for a fast large-repo bootstrap), `agent_context_prepare`, or `project_intelligence_snapshot`.
2. Use `app_process_status`, `app_process_accept_section`, `app_process_continue`, and `app_process_record_verification` to resume app-process work from durable state before broad implementation.
3. Follow `mission_route` and `next_best_tool` instead of browsing the full MCP surface.
4. Use `tool_layer_map` and `tool_catalog_query` for focused tool discovery.
5. Use `state_maintenance_run` for coordinated graph, context, source-conflict, freshness, evidence, and workspace refresh.
6. Record source-backed evidence before implementation claims.
7. Run focused verification and ask the Wormhole gate before final artifacts.

Tool layering is guided by metadata and routing; Wormhole does not hide the full registered MCP tool surface by default.

## Python Runtime

Wormhole uses TypeScript as the MCP control plane and requires Python 3 for Python-backed sidecar jobs such as graph metrics, graph communities, media extraction, trace summaries, and offline policy evaluation.

Install Python dependencies during setup:

```bash
python -m pip install -r python/requirements.txt
```

Use these environment variables when needed:

- `WORMHOLE_PYTHON`: explicit Python interpreter.
- `WORMHOLE_PYTHONPATH`: sidecar package path when it is outside the repo-local `python` directory.
- `WORMHOLE_PYTHON_STARTUP_TIMEOUT_MS`: startup probe timeout.
- `WORMHOLE_ALLOWED_REPO_ROOTS`: comma- or semicolon-separated allowed repo roots for MCP repo tools.

## Local Commands

Requires Node.js 22.5.0 or newer for the built-in SQLite durable index backend.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run benchmarks:validate
npm run benchmarks:run
```

## Client Setup

Build first:

```bash
npm run build
```

For Claude Code or direct MCP attachment, run:

```bash
node dist/src/cli.js
```

For Claude Desktop, install the unpacked extension from `plugins/wormhole-claude-desktop` in developer settings. The extension launches `dist/src/cli.js` through `plugins/wormhole-claude-desktop/server/index.js`.

For Codex, use the repo-local plugin metadata in `plugins/wormhole/.codex-plugin/plugin.json`. The plugin MCP config points to `../../dist/src/cli.js` from `plugins/wormhole`.

## Maintained Docs

- [Canonical plan](docs/planning/wormhole-canonical-plan.md)
- [Orchestration and adaptive architecture](docs/architecture/orchestration-adaptive-capabilities.md)
- [Capability manifest contract](docs/contracts/capability-manifest.md)
- [Changelog](CHANGELOG.md)

Dated implementation plans, generated tool inventories, and one-off analysis reports are intentionally not maintained as current documentation. Use git history for implementation archaeology.
