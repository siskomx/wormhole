# Capability Manifest Contract

Wormhole exposes its current and planned surface through `createDefaultCapabilityManifest()` in `src/capabilities.ts`.

The manifest is intentionally client-neutral. Codex, Claude Code, and future connectors can inspect the same shape.

## Top-Level Fields

- `name`: always `wormhole`
- `version`: package/runtime version
- `maxOrchestrationDepth`: hard ceiling, currently `4`
- `layers`: supported orchestration layers
- `connectors`: client integration targets
- `capabilities`: implemented or planned behavior by version track

## Status Values

- `implemented`: available in the current repo implementation
- `planned`: documented contract, not yet executable

## Connector Targets

- `generic-mcp`: local MCP stdio server
- `claude-code`: Claude Code using the generic MCP server
- `codex`: Codex plugin manifest and MCP config

## Version Semantics

V1 capabilities must be executable and tested.

V2 capabilities can be implemented incrementally. Implemented v2 capabilities include:

- `v2.first-party-optimization-primitives`: deterministic local command-output compaction, context compression, dense summaries, and minimality review.
- `v2.live-sub-orchestrator-control`: task registration, heartbeat/status reporting, mailbox messages, direction-change pause/ack, and immediate interrupts.

V3 capabilities may be planned, but they must have stable names, scope boundaries, and compatibility expectations so implementation can proceed without redesigning the architecture.
