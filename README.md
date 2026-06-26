# Wormhole

Wormhole is an evidence-aware MCP operating layer for AI coding agents. It is not an autonomous agent by itself; it is the local control plane that gives agents mission state, repo intelligence, context routing, evidence gates, verification guidance, and safer write/execute workflows.

## What It Provides

- Mission kernel: mission rounds, evidence records, open questions, gate checks, and evidence-cited plan artifacts.
- Agent routing: `agent_context_prepare`, `mission_route`, `next_best_tool`, `tool_layer_map`, `tool_exposure_profile`, and `tool_catalog_query`.
- Repo intelligence: durable repo indexes, project contracts, architecture maps, entrypoint discovery, blast-radius analysis, context packs, and cached project models/derived intelligence for repeated large-repo calls.
- State maintenance: `state_maintenance_run`, `state_maintenance_status`, and `state_maintenance_retry` coordinate graph refresh, context refresh, evidence capture, and workspace updates.
- Verification and safety: focused test planning, command/LSP diagnostics, dependency and secret scans, action policy review, privileged tool admission review, and patch transactions with rollback.
- Agent collaboration: task registration, control messages, shared workspace memory, external agent adapters, behavior/remit verification, generated-tool validation, and static workbench artifacts.
- Optional advanced surfaces: Python-backed graph/media/policy jobs, discovery imports, shell-hook planning, adaptive routing, model profiles, and policy research traces.

The authoritative tool/capability list lives in `src/capabilities.ts`; the README intentionally stays concise.

## Runtime State

- MCP entrypoint: `src/cli.ts`
- Event log: `.wormhole/events.jsonl`
- Handler runtime state: `.wormhole/runtime-state.json`
- Durable indexes: `.wormhole/indexes`
- Codex plugin metadata: `plugins/wormhole/.codex-plugin/plugin.json`
- Claude Desktop extension metadata: `plugins/wormhole-claude-desktop`

The `.wormhole` directory is local runtime state and is ignored by git.

## Agent Workflow

For coding agents, the intended path is:

1. Start with `agent_context_prepare` or `project_intelligence_snapshot`.
2. Follow `mission_route` and `next_best_tool` instead of browsing the full MCP surface.
3. Use `tool_layer_map` and `tool_catalog_query` for focused tool discovery.
4. Use `state_maintenance_run` for coordinated graph/context/evidence/workspace refresh.
5. Record source-backed evidence before implementation claims.
6. Run focused verification and ask the Wormhole gate before final artifacts.

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

Dated implementation plans, generated tool inventories, and one-off analysis reports are intentionally not maintained as current documentation. Use git history for implementation archaeology.
