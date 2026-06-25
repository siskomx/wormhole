# Runtime Tooling Gaps Design

## Goal

Make Wormhole more useful as tooling for AI coding agents by closing the highest-value runtime gaps found in source inspection, while leaving browser capture unchanged.

## Scope

- Persist runtime registries and stores that currently live only in memory.
- Persist context packs and optimization stats that agents use across turns.
- Improve graph discovery enough for coding-agent workflows without introducing a graph database.
- Make generated tool scaffolds writable and structurally validatable.
- Add bounded CLI/HTTP transport execution for external agent dispatch.
- Persist learned policy state and keep conductor behavior deterministic.
- Harden media dependency reporting and failure modes.

## Non-Scope

- Browser automation or browser-capture work.
- Full source compatibility with external projects.
- Embeddings, vector search, or a persistent graph database.
- Full provider SDK integrations.

## Design

Add small focused modules rather than expanding `tools.ts` further:

- `runtime-state.ts`: JSON-backed state store with atomic writes for handler-owned state.
- `agent-transport.ts`: bounded CLI/HTTP execution for external agent dispatch.
- Extend existing stores to accept optional snapshots and expose snapshots.
- Wire default MCP launches to `.wormhole/runtime-state.json` alongside the existing JSONL event log.
- Extend `tool-factory.ts` with file write and structural validation helpers.
- Extend `repo-index.ts` with better language extraction for Python plus call-reference edges for JS/TS/Python.

Runtime state stays under `.wormhole/runtime-state.json` by default. It is local, deterministic, and not a replacement for the event log. Tool operations that can perform side effects remain explicit.

## Verification

Implementation must add failing tests first and then pass:

- Persistent state survives handler recreation.
- Default runtime options point MCP sessions at `.wormhole/runtime-state.json`.
- Tool factory writes safe scaffolds and rejects path traversal.
- Repo index extracts Python symbols/imports and basic call/reference edges.
- Agent dispatch can execute CLI/HTTP transports and capture evidence hashes.
- Policy activation survives handler recreation and feeds conductor plans.
- Media dependency reports are structured and stable when optional dependencies are missing.
