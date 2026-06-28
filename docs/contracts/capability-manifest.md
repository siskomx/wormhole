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
- `python-sidecar`: required local Python runtime through a narrow JSON job contract
- `hermes-agent`: Hermes Agent through the external agent adapter contract
- `inflection-pi`: Inflection Pi through the provider API adapter contract

## Capability Areas

`core` capabilities are the authoritative evidence-gated planning loop and must be executable and tested.

Implemented `orchestration` capabilities include:

- `orchestration.first-party-optimization-primitives`: deterministic local command-output compaction, context compression, dense summaries, and minimality review.
- `orchestration.native-context-packs`: native source-backed context records, ranked context queries, and budgeted context pack rendering with provenance.
- `orchestration.context-pack-eviction`: deterministic context-pack budget review and refresh with pinned records, stale-record eviction, changed-file relevance, and explicit evicted-record reasons.
- `orchestration.reversible-optimization-pipeline`: reversible optimization records with retrieval handles, transform traces, JSON/log routing, and token-budget stats.
- `orchestration.live-sub-orchestrator-control`: task registration, heartbeat/status reporting, mailbox messages, direction-change pause/ack, and immediate interrupts.
- `orchestration.parallel-sub-orchestrators`: four-layer task records plus static DAG scheduling with read/write lock separation.
- `orchestration.content-addressed-evidence-cache`: SHA-256 addressed raw evidence storage.
- `orchestration.reconciliation-engine`: provenance merge and read/write conflict detection.
- `orchestration.benchmark-runner`: unaided versus Wormhole run capture and anonymized review-pair generation.
- `orchestration.codex-runtime-adapter`: Codex plugin/runtime adapter config generation and validation.
- `orchestration.external-agent-adapters`: generic external agent registration, dispatch, status, interrupt, and completion records for systems such as Hermes Agent and Inflection Pi.
- `orchestration.printing-press-cli-adapters`: Printing Press generated CLI registration, capability selection, structural verification, native execution, evidence capture, and conversion into Wormhole external agent workers.
- `orchestration.printed-tool-runtime`: native printed-tool run records with stdout, stderr, exit code, timeout handling, and immutable evidence hashes.
- `orchestration.repo-index-graph`: deterministic repo-local file, symbol, import, link, reference, provenance, confidence, query, explain, report, dependency-path, SQLite-backed durable query, and JSON compatibility index.
- `orchestration.project-ground-truth-suite`: project contract detection, dependency inventory, structured diagnostics, impact-aware test planning, verification execution, safety scanning, deterministic semantic fallback search, and safe LSP config probes.
- `orchestration.project-intelligence-sequencing`: one-shot project onboarding, process-local LSP sessions, durable repo and semantic indexes, diff-aware test impact, dependency security reports, action admission policy, and optimization adapter execution.
- `orchestration.native-project-intelligence-spine`: native architecture maps, entrypoint flow discovery, blast-radius analysis, and task-scoped project context packs derived from typed repo observations with provenance.
- `orchestration.repo-blueprint-compiler`: existing-repo blueprint and constraints compiler that writes `.wormhole` agent-context artifacts, supports progressive lane coverage artifacts, and gates package-manager and verification drift.
- `orchestration.app-process-compiler`: provisional full-app process compiler that drafts discovery, product definition, roadmap, backlog, architecture, UX, security, and verification artifacts above the repo blueprint.
- `orchestration.app-process-run-controller`: durable app-process status, section acceptance, one-step continuation, event log, and verification evidence records that feed completion gates.
- `orchestration.native-agent-behavior-verification`: native remit creation, capability inventory, behavior verification, rule coverage, drift analysis, and deterministic findings rendering.
- `orchestration.mission-delta-replanning`: mid-mission re-scope reports that combine changed files, diagnostics, blast radius, stale evidence, focused tests, refreshed context, and gate guidance.
- `orchestration.lsp-feedback-replanning`: LSP diagnostic feedback loop that records structured diagnostics and feeds mission-delta replanning with repo-relative changed files.
- `orchestration.agent-workspace-memory`: shared mission workspace memory for concurrent agent runs with attributed records, provenance, snapshot persistence, merge views, and conflict detection.
- `orchestration.graph-artifact-suite`: native graph.json, GRAPH_REPORT.md, graph.html, graph metrics, and deterministic community analysis.
- `orchestration.repo-activity-watch-layer`: opt-in repo watch sessions with file change scans, git diff detection, structured activity recording, mission evidence capture, and durable repo graph refresh.
- `orchestration.patch-transactions`: repo-confined patch checkpoints, unified-diff application, transaction status, and captured before-content rollback for safer coding-agent edits.
- `orchestration.optimized-command-runner`: no-shell command execution with reversible output optimization, retrieval handles, hashes, and savings stats.
- `orchestration.external-optimization-adapters`: native, CLI, and HTTP optimization adapter registry with capability selection and bounded CLI execution.
- `orchestration.native-tool-factory`: deterministic generation of CLI/MCP scaffold files from constrained tool specs.
- `orchestration.local-runner`: adapter-free local orchestration planning and deterministic execution over DAG waves, depth limits, task budgets, and spawned local tasks.

The repo-index MCP tools are workspace-confined by the runtime. The default allowed root is the server working directory; hosts can configure additional allowed roots with `WORMHOLE_ALLOWED_REPO_ROOTS`.

Implemented `adaptive` capabilities include:

- `adaptive.routing-model-selection`: fast/balanced/deep mode selection and model choice from provider manifests.
- `adaptive.connector-registry`: capability-based connector discovery and selection.
- `adaptive.graph-first-codebase-query`: query-first codebase discovery workflow that asks the repo graph before broad grep or raw file-reading passes.
- `adaptive.agent-facing-routing`: curated project snapshots, next-tool recommendations, mission routes, and prepared context packs that keep agents off the full tool surface unless needed.
- `adaptive.model-profile-learning`: native model-profile registration, deterministic selection, outcome recording, and replayable route trace export.
- `adaptive.required-python-runtime`: required Python runtime for deterministic graph metrics, graph communities, media extraction, model-profile trace summaries, and offline policy jobs, bounded by TypeScript-owned MCP schemas, startup probes, timeouts, and evidence hashes.
- `adaptive.deterministic-conductor`: deterministic planner, worker, and verifier scaffolds with replayable conductor traces.
- `adaptive.durable-behavior-policy`: durable brevity and minimality modes with dense output and minimality review primitives.
- `adaptive.native-media-ingestion`: repo-confined PDF/image ingestion with byte hashes, required Python extraction, package dependency reports, OCR safety gates, and evidence-ready records.
- `adaptive.shell-hook-manager`: dry-run-first shell hook discovery, plan-token-gated marker-based install, backup, verification, and uninstall for common terminals.
- `adaptive.discovery-tool-generation`: HAR/OpenAPI import, bounded HTTP crawl with private-network guardrails, optional browser capture, endpoint normalization, secret redaction, and API tool-spec generation.
- `adaptive.learned-orchestration-policy`: offline orchestration trace datasets, deterministic policy training/evaluation, stored evaluation IDs, replay thresholds, activation gates, and action clamps.
- `adaptive.safe-live-policy-feedback`: live orchestration outcome feedback that records traces and returns bounded advisory hints without self-training or activating policies.
- `adaptive.orchestration-policy-lab`: expanded orchestration action decisions, deterministic baseline comparison, scored reasoning traces, and strategy evaluation for plan/critique/revision/verifier research.
- `adaptive.dynamic-task-spawning`: dynamic DAG task expansion with max-depth and max-task guardrails.
- `adaptive.model-pool-orchestration`: bounded thinker, worker, and verifier provider orchestration.
- `adaptive.workbench-artifacts`: static mission/task/gate/artifact workbench snapshots and HTML rendering.
- `adaptive.rich-artifact-types`: typed artifact records for plans, reports, workbench HTML, patch plans, and benchmark reports.

Future adaptive extensions may still add external provider marketplaces, richer interactive UI behavior, persistent evidence graphs, and deeper research algorithms. Browser automation remains a complementary observation source rather than the center of Wormhole's runtime.
