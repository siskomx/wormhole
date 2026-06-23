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
- `v2.parallel-sub-orchestrators`: four-layer task records plus static DAG scheduling with read/write lock separation.
- `v2.content-addressed-evidence-cache`: SHA-256 addressed raw evidence storage.
- `v2.reconciliation-engine`: provenance merge and read/write conflict detection.
- `v2.benchmark-runner`: unaided versus Wormhole run capture and anonymized review-pair generation.
- `v2.codex-runtime-adapter`: Codex plugin/runtime adapter config generation and validation.

Implemented v3 capabilities include:

- `v3.adaptive-routing-model-selection`: fast/balanced/deep mode selection and model choice from provider manifests.
- `v3.connector-registry`: capability-based connector discovery and selection.

Future v3 extensions may still add UI/workbench behavior, richer artifact types, and learned model-pool providers.
