# Changelog

## Unreleased

## 0.4.0 - 2026-06-28

- Added shared `indexHealth` metadata across repo index summaries/queries, durable index status/query results, project intelligence, context packs, and agent routing.
- Added gate signal handling for index health: stale/missing indexes can block under enforcement, while degraded/truncated indexes remain warning-only.
- Made `repo_graph_refresh_incremental` explicitly report that it is a full-rebuild compatibility alias, not a partial graph mutation engine.
- Added durable repo-index `requireFresh` behavior for callers that want stale/missing durable results refused instead of warning-only.
- Added opt-in repo-index `preset: "large_repo"` caps for native and durable index builds while preserving existing default caps.
- Added SQLite FTS-backed durable repo-index retrieval when available, plus `ftsAvailable`, `retrievalModes`, and query `retrievalMode` metadata with LIKE/JSON fallback paths.
- Bounded Python sidecar output capture with truncation metadata, preserved corrupt runtime-state JSON, and added opt-in tolerant trailing-corruption replay for JSONL event logs.

## 0.3.0 - 2026-06-28

- Added a first-class app lifecycle lane covering environment, data migration, CI, deployment, and release readiness.
- Wired lifecycle into app-process compilation, context rendering, validation, progressive lane summaries, and generated `.wormhole/lanes/lifecycle.md` artifacts.
- Added lifecycle artifact relation coverage for the app-process compiler.
- Documented lifecycle as part of the project intelligence sequencing layer.

## 0.2.0 - 2026-06-28

- Added an inspiration document covering MCP, Codex, Claude Code, RTK, Headroom, Caveman, Ponytail, Graphify, Printing Press, Sakana Fugu, and Wormhole's operating principles.
- Added shared gate signal handling so `gate_request`, `blueprint_gate_check`, and `app_process_gate_check` consume source-conflict and freshness signals.
- Blocked app-process continuation when required generated artifacts are missing or stale.
- Wired durable index, ctx-pack, workflow artifact, and freshness metadata into agent-facing routing relations and instructions.
- Expanded capability relation auditing to flag workflow artifact writers that omit artifact and freshness metadata.

## 0.1.0 - 2026-06-28

- Added source-conflict analysis for documentation claims and stale generated `.wormhole` artifact fingerprints.
- Added capability relation metadata and an audit tool for capability, registry, workflow, and test wiring.
- Wired source-conflict and durable freshness checks into `state_maintenance_run`.
- Surfaced source-conflict findings in feature-bound workflows.
