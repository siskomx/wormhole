# Changelog

## Unreleased

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
