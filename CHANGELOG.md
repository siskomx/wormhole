# Changelog

## Unreleased

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
