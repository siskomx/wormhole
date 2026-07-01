# Changelog

## Unreleased

## 0.16.0 - 2026-07-01

- Added a typed claim/proof ledger for deterministic repo and workflow claims, including evidence IDs, invalidation keys, support status, and persisted query/update handlers.
- Added claim gate checks so `gate_request` can warn or block on stale, unsupported, conflicted, or unverified claims before final agent assertions.
- Added MCP, registry, guided tool-surface, and test coverage for `claim_record`, `claim_verify`, `claim_search`, and `claim_invalidate`.

## 0.15.0 - 2026-07-01

- Added large-repo intelligence gap-closure tools: canonical repo facts/fact store, typed relation queries, relation-aware change impact, hybrid repo-intelligence search, typed workflow planning, shared evidence requirements, and advisory tool-surface audit.
- Routed large-repo workflows and agent context through `repo_intelligence_search` and `change_impact_analyze` before lower-level index/impact fallbacks.
- Extended large-repo evals, benchmark rubric, capability relations, docs, and plugin guidance for relation, impact, search, workflow, evidence, and tool-surface coverage.

## 0.14.3 - 2026-06-30

- Refused missing or stale persisted graph-node semantic indexes instead of returning empty search results that could be mistaken for complete coverage.
- Passed the current repo fingerprint into `graph_node_semantic_search` from the tool handler so stale graph-node records are detected before use.
- Aligned package, lockfile, plugin, MCP server, and capability manifest version metadata to the release version.

## 0.14.2 - 2026-06-30

- Added `symbol_context`, a large-repo context tool that merges repo graph facts with live TypeScript LSP definition, hover, and optional capped references.
- Hardened process-local LSP session handling for bounded startup/request timeouts, retained-session reuse, one-shot sessions, graceful stop, and partial failure reporting.
- Wired symbol context into MCP registration, tool registry metadata, admission review, README guidance, and focused tests.

## 0.14.1 - 2026-06-30

- Strengthened existing feature/domain inference so direct source-root subsystem files such as `repo-index`, `domain-index`, `project-intelligence`, `tool-registry`, and `feature-index` seed feature maps and domain manifest candidates without adding new tools or approval workflows.
- Added guards so single-token source-root files such as `index`, `types`, and `utils` do not become feature IDs.

## 0.13.0 - 2026-06-29

- Added resume validation as a gate signal, including resume state detection, state-maintenance auto-validation when resume state exists, `gate_request` resume inputs, workflow done-gate enforcement, and relation freshness coverage.
- Added `repo_reachability_analyze`, a read-only repo-wide reachability review tool for coding agents that combines repo-index edges, entrypoints, workspace/package boundaries, dynamic/framework blockers, manual known-used files, and optional Knip hints into deletion-review categories that always require human approval.
- Clarified that `code_smell_scan` is changed-files-only and not repository-wide reachability or deletion proof.
- Wired repo reachability review into MCP registration, tool registry metadata, capability relations, agent routing, plugin manifest guidance, README guidance, and focused tests.

## 0.12.2 - 2026-06-29

- Added CI verification for build, tests, and benchmark fixture validation on Node.js 22.5.0.
- Aligned plugin runtime metadata with the Node.js version required by the SQLite-backed durable index backend.
- Added startup validation for unsupported Node.js versions.
- Clarified workflow artifact status so planned artifacts are not reported as written until `workflow_write_artifacts` runs.

## 0.12.1 - 2026-06-29

- Bumped release metadata after the integration hardening commit so GitHub's latest release tag matches current `origin/main`.

## 0.12.0 - 2026-06-29

- Added durable resume continuation tools for material session records, compact checkpoints, validation against kernel evidence/context packs, repo fingerprint drift checks, and latest handoff artifacts.
- Wired resume continuation through runtime persistence, MCP registration, tool registry metadata, capability relations, agent routing, plugin manifests, docs, and focused tests.

## 0.11.0 - 2026-06-29

- Added git lifecycle tools for status, branch preparation/creation, commit preparation/creation, PR preparation, and bounded conflict analysis.
- Added dependency risk reporting with parsed audit/outdated inputs and bounded live npm audit/outdated execution.
- Added `docs_sync_check` to gate public-surface changes against documentation freshness and stale source claims.
- Added `workspace_graph_analyze` for npm, pnpm, and Cargo workspace roots with local package dependency edges.
- Wired the new lifecycle coverage into MCP registration, tool registry metadata, capability relations, plugin manifests, README guidance, and release version metadata.

## 0.10.0 - 2026-06-29

- Added anti-slop lifecycle gates: `code_smell_scan`, `diff_scope_review`, `test_quality_review`, and `coverage_delta_analyze`.
- Wired `patch_apply` to support optional strict diff-scope enforcement before a patch writes files.
- Added focused foundation tests for repo extraction, Tree-sitter loader support, language-profile gaps, route extraction, network guard behavior, and SQLite repo-index freshness.
- Documented Go and Java Tree-sitter package work as a deferred parser compatibility spike rather than shipping unverified native parser dependencies.

## 0.9.0 - 2026-06-29

- Added durable graph community artifacts with `graph_communities_refresh`, `list_communities`, and `get_community`.
- Added community-aware `get_surprising_connections` ranking for cross-cluster repo graph edges.
- Added graph wiki rendering and optional `.wormhole/graph-wiki/**` writes through `graph_wiki_generate`.
- Added graph-node semantic indexing and search over file, symbol, community, and flow nodes.
- Added persistent named execution flow artifacts with `flows_refresh`, `list_flows`, and `get_flow`.
- Extended state maintenance to report missing or stale graph-derived artifacts as advisory refresh signals.

## 0.8.0 - 2026-06-29

- Added AST-first repo extraction with pinned Tree-sitter grammars for TypeScript/TSX, JavaScript/JSX, Python, Rust, and C#.
- Preserved regex fallback extraction for Markdown, unsupported text formats, parser load failures, and malformed parser-capable files, with `PARSER_FALLBACK:` index-health reasons.
- Added `repo_graph_analyze` for read-only graph hubs, connector nodes, cycles, disconnected files, orphan symbols, parser coverage, and bounded changed-file impact flows.
- Added shared framework and route extraction signals, including Fastify/Express registered prefixes, so domain manifest seeders can identify route groups beyond `*Routes.ts` conventions.
- Added extractor-versioned repo fingerprints and durable SQLite metadata; pre-0.8 durable repo indexes should be refreshed once after upgrade.

## 0.7.0 - 2026-06-28

- Added a domain manifest seeder lifecycle with `domain_manifest_generate`, `domain_manifest_diff`, `domain_manifest_status`, and guarded `domain_manifest_apply`.
- Preserved manual domain knowledge during generation, including aliases, portals, file groups, and verification gates.
- Added stale-hash protection, backup writes, atomic replacement, validation, and optional domain-index refresh for manifest apply.
- Documented how domain seeders differ from generated repo, durable, semantic, and repo-native indexes.

## 0.6.0 - 2026-06-28

- Added the manifest-driven domain indexing layer backed by `.wormhole/domain-index.json` and `.wormhole/indexes/domain-index.sqlite`.
- Added domain refresh, status, slice, API, table, coverage, drift, and verification-gate tools.
- Wired domain index facts into repo-native context packs and capability relation coverage.

## 0.5.3 - 2026-06-28

- Wired state maintenance to start an evidence round automatically before recording maintenance evidence.
- Extended gate checks to consume runtime behavior blockers and agent-loop health blockers alongside source-conflict and freshness signals.
- Carried fresh durable SQLite repo-index health into prepared agent contexts so large-repo ctx packs do not fall back to degraded native index metadata after durable refresh.
- Tuned runtime behavior audits to ignore expected Wormhole orchestration/meta tools while still flagging unexpected runtime calls.
- Added C#/.NET/Jellyfin web-client recognition across feature binding, source authority, blueprint/app-process grounding, and workflow context.

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
- Earlier builds made `repo_graph_refresh_incremental` explicit about full-rebuild fallback behavior; current builds perform partial refresh when the prior index, extractor version, and build options are safe.
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
