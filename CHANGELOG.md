# Changelog

## Unreleased

## 0.5.2 - 2026-06-28

- Added an internal deterministic agent-loop health primitive for the perceive, reason, plan, act, observe, and maintain phases without adding a new MCP tool surface.
- Wired loop health to consume existing runtime behavior audit output, gate freshness, verification, source-conflict, durable-index health, and loop budget signals.
- Added advisory safeguards for planned-mode empty observations, observed-mode runtime blockers, stale/failed/missing stop conditions, unknown tool omission, and sensitive next-tool suppression.

## 0.5.1 - 2026-06-28

- Added an internal deterministic behavior-improvement review primitive that consumes existing runtime behavior, capability relation, gate, freshness, trace, and registry summaries without adding a new MCP tool surface.
- Added advisory-only report safeguards for bounded notices, circular recommendation detection, evidence-required states, and unsafe-looking tool recommendation omission.
- Added conformance tests proving the review remains library-only and is not exposed through the registry, handlers, or MCP server listing.

## 0.5.0 - 2026-06-28

- Added language-profile detection and coverage reporting so repo indexes, project contracts, project intelligence, gate signals, agent routing, and verification plans can surface language-specific guidance and gaps.
- Added `runtime_behavior_audit` as a pure audit primitive plus MCP/tool-handler/registry wiring to compare recommended Wormhole tools against observed runtime calls.
- Wired prepared agent contexts to include machine-readable runtime audit input with required evidence, verification, and gate tools plus full registry scope for unexpected Wormhole tool detection.
- Added call-level runtime behavior coverage for repeated recommendations, failed/skipped calls, required tools outside the route, ordering violations, and non-Wormhole tool noise.

## 0.4.1 - 2026-06-28

- Seeded agent context preparation from fresh durable repo-index query results so ctx packs can start with persisted large-repo evidence.
- Preserved durable repo-index build options across state maintenance, watch, and source-conflict paths.
- Extended app-process status and gate wiring to consume objective-scoped freshness, stale artifact, source-conflict, and index-health signals.
- Added index-health coverage for skipped generated and OpenAPI contract artifacts.

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
