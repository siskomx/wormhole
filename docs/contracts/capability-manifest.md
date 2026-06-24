# Capability Manifest Contract

Wormhole exposes its current and planned surface through `createDefaultCapabilityManifest()` in `src/capabilities.ts`.

The manifest is intentionally client-neutral. Codex, Claude Code, and future connectors can inspect the same shape.

## Top-Level Fields

- `name`: always `wormhole`
- `version`: package/runtime version
- `maxOrchestrationDepth`: hard ceiling, currently `4`
- `layers`: supported orchestration layers
- `connectors`: client integration targets
- `capabilities`: implemented or planned behavior by capability area

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

## Capability Areas

`core` capabilities are the authoritative evidence-gated planning loop and must be executable and tested.

Implemented `orchestration` capabilities include:

- `orchestration.first-party-optimization-primitives`: deterministic local command-output compaction, context compression, dense summaries, and minimality review.
- `orchestration.live-sub-orchestrator-control`: task registration, heartbeat/status reporting, mailbox messages, direction-change pause/ack, and immediate interrupts.
- `orchestration.parallel-sub-orchestrators`: four-layer task records plus static DAG scheduling with read/write lock separation.
- `orchestration.content-addressed-evidence-cache`: SHA-256 addressed raw evidence storage.
- `orchestration.reconciliation-engine`: provenance merge and read/write conflict detection.
- `orchestration.benchmark-runner`: unaided versus Wormhole run capture and anonymized review-pair generation.
- `orchestration.codex-runtime-adapter`: Codex plugin/runtime adapter config generation and validation.
- `orchestration.external-agent-adapters`: generic external agent registration, dispatch, status, interrupt, and completion records for systems such as Hermes Agent and Inflection Pi.
- `orchestration.printing-press-cli-adapters`: Printing Press generated CLI registration, capability selection, and conversion into Wormhole external agent workers.
- `orchestration.repo-index-graph`: deterministic repo-local file, symbol, import, link, query, explain, and dependency-path index.
- `orchestration.local-runner`: adapter-free local orchestration planning and deterministic execution over DAG waves, depth limits, task budgets, and spawned local tasks.

The repo-index MCP tools are workspace-confined by the runtime. The default allowed root is the server working directory; hosts can configure additional allowed roots with `WORMHOLE_ALLOWED_REPO_ROOTS`.

Implemented `adaptive` capabilities include:

- `adaptive.routing-model-selection`: fast/balanced/deep mode selection and model choice from provider manifests.
- `adaptive.connector-registry`: capability-based connector discovery and selection.
- `adaptive.graph-first-codebase-query`: query-first codebase discovery workflow that asks the repo graph before broad grep or raw file-reading passes.
- `adaptive.dynamic-task-spawning`: dynamic DAG task expansion with max-depth and max-task guardrails.
- `adaptive.model-pool-orchestration`: bounded thinker, worker, and verifier provider orchestration.
- `adaptive.workbench-artifacts`: static mission/task/gate/artifact workbench snapshots and HTML rendering.
- `adaptive.rich-artifact-types`: typed artifact records for plans, reports, workbench HTML, patch plans, and benchmark reports.

Future adaptive extensions may still add learned model-pool routing, external provider marketplaces, richer interactive UI behavior, and persistent evidence graphs.
