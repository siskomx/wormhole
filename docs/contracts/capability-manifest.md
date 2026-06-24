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
- `claude-desktop`: Claude Desktop using the MCPB-compatible extension scaffold
- `codex`: Codex plugin manifest and MCP config
- `printing-press`: Printing Press generated CLIs and MCP servers through the CLI adapter contract
- `graphify`: native graph-first repo index tools or an external Graphify-compatible graph connector
- `hermes-agent`: Hermes Agent through the external agent adapter contract
- `inflection-pi`: Inflection Pi through the provider API adapter contract

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
- `v2.external-agent-adapters`: generic external agent registration, dispatch, status, interrupt, and completion records for systems such as Hermes Agent and Inflection Pi.
- `v2.printing-press-cli-adapters`: Printing Press generated CLI registration, capability selection, and conversion into Wormhole external agent workers.
- `v2.repo-index-graph`: deterministic repo-local file, symbol, import, link, query, explain, and dependency-path index.

Implemented v3 capabilities include:

- `v3.adaptive-routing-model-selection`: fast/balanced/deep mode selection and model choice from provider manifests.
- `v3.connector-registry`: capability-based connector discovery and selection.
- `v3.graph-first-codebase-query`: query-first codebase discovery workflow that asks the repo graph before broad grep or raw file-reading passes.
- `v3.dynamic-task-spawning`: dynamic DAG task expansion with max-depth and max-task guardrails.
- `v3.model-pool-orchestration`: bounded thinker, worker, and verifier provider orchestration.
- `v3.workbench-artifacts`: static mission/task/gate/artifact workbench snapshots and HTML rendering.
- `v3.rich-artifact-types`: typed artifact records for plans, reports, workbench HTML, patch plans, and benchmark reports.

Future v3 extensions may still add learned model-pool routing, external provider marketplaces, richer interactive UI behavior, and persistent evidence graphs.
