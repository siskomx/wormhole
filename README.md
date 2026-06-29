# Wormhole

Wormhole is an evidence-aware MCP operating layer for AI coding agents. It is not an autonomous coding agent by itself. It is the local control plane that gives agents mission state, repo intelligence, context routing, evidence gates, verification guidance, durable indexes, and safer write/execute workflows.

The goal is simple: make coding agents faster and more precise in large repositories by giving them current, queryable, repo-native facts before they start broad file reads or speculative edits.

## What It Provides

### Mission And Evidence Control

- Mission rounds, evidence records, open questions, task registration, task status, control messages, and gate checks.
- Evidence-cited plan artifacts through `emit_plan`.
- Final-claim safeguards through `gate_request`, source-backed evidence records, freshness signals, and runtime behavior audit support.

### Agent Routing And Tool Discovery

- `agent_context_prepare` builds a focused context pack and routing instructions for a specific objective.
- `mission_route` and `next_best_tool` steer agents toward the next useful tool instead of forcing them to browse the full MCP surface.
- `tool_layer_map`, `tool_exposure_profile`, `tool_catalog_query`, and `tool_admission_review` expose the registered runtime surface with structured metadata.
- Tool registry conformance is tested against the live MCP server so stale tool metadata is treated as a regression.

### Repo Intelligence

- Deterministic repo-local graph indexing over files, symbols, imports, links, references, and inferred calls.
- AST-first extraction for TypeScript/TSX, JavaScript/JSX, Python, Rust, and C# through pinned Tree-sitter grammars, with regex fallback for parser failures, Markdown, and unsupported text formats.
- SQLite-backed durable repo indexes under `.wormhole/indexes`, plus JSON compatibility exports and shard manifests.
- `repo_index_build`, `repo_index_query`, `repo_index_explain`, `repo_index_path`, `repo_index_report`, and `repo_graph_analyze` for immediate repo graph work.
- Durable graph-derived artifacts for communities, surprising cross-community connections, graph wiki pages, graph-node semantic search, and named execution flows.
- `graph_communities_refresh`, `list_communities`, `get_community`, `get_surprising_connections`, `graph_node_semantic_index_refresh`, `graph_node_semantic_search`, `flows_refresh`, `list_flows`, `get_flow`, and `graph_wiki_generate` for queryable graph intelligence beyond raw file/symbol search.
- `durable_repo_index_refresh`, `durable_index_status`, `durable_index_manifest_refresh`, `durable_index_manifest_status`, and `durable_repo_index_query` for persistent large-repo retrieval.
- Project contracts, dependency inventory, command maps, architecture maps, entrypoint discovery, blast-radius analysis, and generated project context packs.
- Repo-native coverage packs and feature-slice queries over feature indexes, scripts, conventions, schema evidence, verification gates, source conflicts, and coverage gaps.

### Domain Indexing

Wormhole also has a manifest-driven domain indexing layer for repositories where generic file/symbol indexing is not enough.

Domain indexing joins:

- Feature ids, aliases, roots, portals, and owned database tables from `.wormhole/domain-index.json`.
- Route, hook, service, migration, OpenAPI, convention, and memory files.
- OpenAPI endpoint observations, route-scan fallback endpoints, registered Fastify/Express prefixes, auth hints, query keys, and response schema refs.
- Folded SQL migration facts: tables, columns, indexes, foreign keys, and migration provenance.
- Domain verification gates mapped from feature side effects such as `authz`, `database_schema`, `http_mutation`, and `realtime`.
- Coverage and drift signals for missing manifests, generic features missing from the manifest, routes without OpenAPI, APIs without feature ownership, tables without owners, stale indexes, and source conflicts.

The domain index is persisted as SQLite at:

```text
.wormhole/indexes/domain-index.sqlite
```

Domain tools:

- `domain_index_refresh`: rebuild the SQLite domain index.
- `domain_index_status`: read freshness, summary, warnings, and index health.
- `domain_manifest_generate`: infer a reviewable `.wormhole/domain-index.json` candidate from generic repo evidence while preserving manual aliases, portals, and gates.
- `domain_manifest_diff`: compare the current seeder manifest with the generated candidate and return semantic operations with base/candidate hashes.
- `domain_manifest_status`: report manifest validity, pending seeder operations, warnings, and blockers without writing files.
- `domain_manifest_apply`: write an approved candidate with stale-hash protection, backup, atomic replace, and optional domain-index refresh.
- `domain_slice_query`: query one feature with files, API endpoints, tables, coverage gaps, and gate plans.
- `domain_api_query`: query indexed API endpoints by feature, method, path template, or text.
- `domain_table_query`: query folded schema tables, columns, indexes, foreign keys, and migration provenance.
- `domain_index_coverage`: list domain coverage gaps.
- `domain_index_drift`: compare the stored domain index with the current repo.
- `domain_verification_gate_plan`: return feature- or gate-specific verification commands.

`domain_slice_query` falls back to `feature_slice_query` when the domain index is missing, stale, or refused by `requireFresh: true`, so agents still get useful repo-native context while being told the domain index needs refresh.

### Verification, Safety, And Writes

- Diff-aware test impact analysis and focused verification plans.
- Command diagnostics, LSP diagnostics, dependency reports, secret scanning, action policy review, and operation risk review.
- Anti-slop lifecycle gates for changed-code smells, diff scope, test quality, and coverage deltas.
- Optional strict diff-scope enforcement on `patch_apply` so patch transactions can refuse unrelated writes before files are changed.
- Privileged write admission checks for mutating artifacts.
- Patch transactions with checkpoints, unified-diff application, status, and rollback.
- App-process and blueprint gates for larger product or repo-change workflows.

### Agent Collaboration And Runtime Extensions

- Shared mission workspace memory for concurrent agent runs.
- External agent adapters, generated-tool validation, behavior/remit verification, and deterministic findings rendering.
- Printing Press CLI adapter support.
- Optional Python-backed graph metrics, graph communities, media extraction, trace summaries, and offline policy jobs.
- Discovery imports from HAR/OpenAPI, bounded HTTP crawl, optional browser capture, and deterministic tool-spec generation.
- Adaptive routing, model profiles, conductor traces, shell-hook planning, and policy research surfaces.

## Core Workflows

### First Contact With A Repo

1. Use `project_intelligence_snapshot`, `agent_context_prepare`, or `mission_route`.
2. Use `tool_layer_map` and `tool_catalog_query` for tool discovery.
3. Refresh stale or missing repo guidance through the state-maintenance owner tools.
4. Record source-backed evidence before implementation claims.
5. Run focused verification and ask the Wormhole gate before final artifacts.

### Large-Repo Retrieval

1. Refresh a durable index with `durable_repo_index_refresh` or `durable_index_manifest_refresh`.
2. Use `durable_index_status` or `durable_index_manifest_status` to inspect freshness.
3. Query through `durable_repo_index_query`.
4. Pass `requireFresh: true` when stale data must be refused instead of returned with warnings.
5. After upgrading to `0.8.0`, refresh each repo once because extractor-versioned fingerprints mark pre-AST durable indexes stale.

### Domain-Indexed Repos

1. Run `domain_manifest_generate` to infer a candidate `.wormhole/domain-index.json`.
2. Run `domain_manifest_diff` or `domain_manifest_status` to review semantic changes and blockers.
3. Run `domain_manifest_apply` with the returned `baseHash` when the candidate is approved.
4. Run `domain_index_refresh` or set `refreshAfterApply: true` on apply.
5. Check `domain_index_status`.
6. Use `domain_slice_query`, `domain_api_query`, `domain_table_query`, and `domain_verification_gate_plan` before implementation.
7. Use `domain_index_coverage` and `domain_index_drift` before trusting the stored domain facts.

### Graph-Derived Intelligence

1. Build or refresh the repo index first with `repo_index_build`, `durable_repo_index_refresh`, or state maintenance.
2. Run `graph_communities_refresh` to persist `.wormhole/graph/communities.json`.
3. Use `list_communities` and `get_community` to inspect graph clusters with files, symbols, and edge slices.
4. Use `get_surprising_connections` to rank cross-community edges that may reveal hidden coupling.
5. Run `flows_refresh`, then use `list_flows` and `get_flow` for named API, CLI, worker, and script execution paths.
6. Run `graph_node_semantic_index_refresh`, then use `graph_node_semantic_search` when the query should target graph nodes rather than generic text records.
7. Use `graph_wiki_generate` to render pages in memory, or pass `write: true` to write `.wormhole/graph-wiki/**` after privileged write admission.

### Lifecycle Anti-Slop Gates

The lifecycle gate tools are generic and operate on changed files, diffs, repo-index facts, tests, and coverage summaries. They are not tied to a specific product or ticket system.

- `code_smell_scan`: flags likely dead code, complex functions, duplicate blocks, and new dependencies that do not appear to be used by the changed set.
- `diff_scope_review`: checks whether changed files and hunks trace to the objective, cited evidence paths, or explicitly approved paths.
- `test_quality_review`: checks changed test files for skipped tests, missing assertions, snapshot-only coverage, and source changes without nearby tests.
- `coverage_delta_analyze`: compares before/after coverage summaries and reports regressions.

`tool_admission_review` now recommends `diff_scope_review` before `patch_apply`. Callers that want enforcement can pass `scopeReview` to `patch_apply`; strict failed reviews are refused before the patch writes files.

### Implementation Loop

1. Prepare context with `agent_context_prepare`.
2. Narrow impact with `blast_radius_analyze`, `test_impact_analyze_v2`, `domain_slice_query`, or `feature_slice_query`.
3. Run `diff_scope_review` and `code_smell_scan` before applying broader edits.
4. Make edits through normal repo tooling or guarded patch transactions when rollback matters.
5. Run focused verification plus `test_quality_review` and `coverage_delta_analyze` when tests or coverage are in scope.
6. Record evidence.
7. Ask `gate_request`.

## Domain Manifest

`.wormhole/domain-index.json` teaches Wormhole repo-specific feature ownership. Agents can now create and maintain this seeder through `domain_manifest_generate`, `domain_manifest_diff`, `domain_manifest_status`, and `domain_manifest_apply`.

The lifecycle is intentionally review-first:

- Generate and status are read-only.
- Diff returns semantic operations such as `add-feature`, `update-feature-roots`, `update-feature-tables`, `update-file-groups`, and `add-verification-gate`.
- Apply is the only writer. It requires the current `baseHash`, writes a backup, performs an atomic replace, validates the manifest after write, and can refresh the domain index.
- Manual knowledge is preserved. Existing aliases, portals, custom file groups, and verification gates are carried into generated candidates instead of being silently deleted.
- Stale removals should be treated as warnings for human review; generated candidates add or update inferred coverage but do not silently erase repo-specific knowledge.

The manifest shape is:

```json
{
  "schemaVersion": "domain-index.v0",
  "features": [
    {
      "featureId": "tickets",
      "displayName": "Tickets",
      "aliases": ["ticket"],
      "roots": ["backend/src/modules/tickets", "src/features/tickets"],
      "portals": ["internal", "client"],
      "tables": ["tickets", "ticket_messages"]
    }
  ],
  "fileGroups": {
    "routes": ["backend/src/modules/*/*Routes.ts"],
    "hooks": ["src/features/*/hooks/use*.ts"],
    "services": ["backend/src/modules/**/*Service.ts"],
    "migrations": ["migrations/*.sql"],
    "openapi": ["public/api-docs/openapi.json"],
    "conventions": ["docs/conventions/*.md"],
    "memory": [".wormhole/memory/*.md"]
  },
  "verificationGates": [
    {
      "gateId": "tenant-isolation",
      "scriptNames": ["lint:org-filter"],
      "whenFeatureTouches": ["authz"]
    }
  ]
}
```

Notes:

- Paths must be repo-relative and stay inside the repo.
- Feature ids and aliases are normalized for matching.
- Script names are preserved exactly so package scripts like `lint:org-filter` continue to work.
- Manifest-declared `.wormhole/memory` files are indexed by the domain layer even though the broad repo index ignores `.wormhole` runtime state.
- If OpenAPI files are absent, route scanning still produces endpoint facts and reports `route-without-openapi` coverage gaps.
- Route scanning detects direct `app/router/fastify.method()` calls, `fastify.route({ method, url })`, local `register(..., { prefix })` route modules, and `router.use("/prefix", childRouter)` when the child router is imported from the repo.

## AST-First Repo Intelligence

The native repo index now uses Tree-sitter first for parser-supported source files. Each indexed file records parser provenance as `tree-sitter` or `fallback`, and index health reports `PARSER_FALLBACK:` when a parser-capable file had to use fallback extraction.

What AST improves:

- More precise symbols, imports, exports, and direct call edges for TypeScript/TSX, JavaScript/JSX, Python, Rust, and C#.
- Fewer false call edges from comments or string literals in parser-supported files.
- Shared route and framework signals that domain manifest seeders can use to create or maintain repo-specific seeders.
- Extractor-versioned fingerprints so durable indexes built by older extraction logic become stale instead of being silently reused.

What AST does not replace:

- It is not a type checker or LSP. Runtime wiring, generated routes, decorators, dynamic imports, framework config, OpenAPI specs, tests, and command output still need their own evidence.
- It does not persist raw ASTs. Wormhole persists compact graph facts and parser coverage only.

Use `repo_graph_analyze` when relationships matter. It is read-only and returns hubs, connector nodes, cycles, disconnected files, orphan symbols, parser coverage, bounded changed-file impact flows, truncation state, and index health.

Go and Java parser packages are intentionally not enabled in this release. The next step is a parser compatibility spike that validates native package install/build behavior before adding them to the supported Tree-sitter set; until then, those languages should be treated as unsupported by AST extraction rather than silently claiming parser-grade precision.

## Graph Intelligence Artifacts

The graph intelligence layer turns existing repo graph facts into durable, queryable artifacts. It does not replace `repo_index_query`, `repo_graph_analyze`, `python_graph_communities`, semantic search, or entrypoint discovery; it wraps those existing capabilities in stores that agents can revisit by id, name, kind, or query.

Derived stores:

- `.wormhole/graph/communities.json`: stable community records built from Python sidecar community detection over the current repo graph.
- `.wormhole/flows/index.json`: named execution flows derived from entrypoint discovery, with downstream files and community membership.
- `.wormhole/indexes/graph-node-semantic-index.json`: deterministic semantic records for file, symbol, community, and flow graph nodes.
- `.wormhole/graph-wiki/**`: optional Markdown pages rendered from graph communities, flows, and cross-community connection evidence.

Read tools are stale-aware. If a derived store is missing or its source repo fingerprint differs from the current index, Wormhole returns a clear refresh hint instead of silently treating old graph intelligence as current. `state_maintenance_run` reports missing or stale derived graph artifacts as advisory status, but refresh remains explicit through the graph, flow, semantic-index, and wiki tools.

## Index Lifecycle Coverage

Wormhole has several index-like artifacts, but they do not all need the same seeder lifecycle:

- Repo graph indexes are generated from source files. Use `repo_index_build`, `repo_index_query`, `repo_index_explain`, `repo_index_path`, `repo_index_report`, and `repo_graph_analyze`.
- Durable repo indexes and shard manifests are generated artifacts. Use `durable_repo_index_refresh`, `durable_index_manifest_refresh`, `durable_index_status`, `durable_index_manifest_status`, and `durable_repo_index_query`.
- Semantic fallback indexes are generated from caller-provided records. Use `durable_semantic_index_refresh` and `durable_semantic_search`.
- Graph intelligence artifacts are generated from existing repo graph facts. Use `graph_communities_refresh`, `flows_refresh`, `graph_node_semantic_index_refresh`, and `graph_wiki_generate` to rebuild them, then query them through their list/get/search tools.
- Repo-native packs are read-only synthesized coverage over existing repo evidence. Use `repo_native_pack_build` and `feature_slice_query`.
- Blueprints and app-process artifacts already have compile/write/status/gate workflows because they are authored planning artifacts.
- Domain indexing was the missing case: it depended on a repo-specific seeder manifest that Wormhole could read but not create or maintain. The `domain_manifest_*` tools close that gap.

## Runtime State

- MCP entrypoint: `src/cli.ts`
- Event log: `.wormhole/events.jsonl`
- Handler runtime state: `.wormhole/runtime-state.json`
- App-process run state: `.wormhole/app-process/run-state.json` and `.wormhole/app-process/events.jsonl`
- Durable repo indexes: `.wormhole/indexes/repo-index.sqlite`, JSON compatibility exports, and manifest shards.
- Domain index: `.wormhole/indexes/domain-index.sqlite`
- Graph communities: `.wormhole/graph/communities.json`
- Named execution flows: `.wormhole/flows/index.json`
- Graph-node semantic index: `.wormhole/indexes/graph-node-semantic-index.json`
- Optional graph wiki pages: `.wormhole/graph-wiki/**`
- Codex plugin metadata: `plugins/wormhole/.codex-plugin/plugin.json`
- Claude Desktop extension metadata: `plugins/wormhole-claude-desktop`

The `.wormhole` directory is local runtime state and is ignored by git.

## Freshness And Index Health

Repo, durable-index, domain-index, derived graph artifact, architecture, blast-radius, context-pack, and routing responses expose shared `indexHealth` metadata. Agents should inspect this before trusting generated guidance.

Common freshness behavior:

- `fresh`: guidance matches current repo fingerprints.
- `stale`: stored guidance exists but the repo changed.
- `missing`: the index or artifact has not been built.
- `degraded`: the index exists but is truncated or has coverage gaps.
- `requireFresh: true`: stale or missing query results are refused instead of silently returned.

Repo index default caps are conservative:

- 1,000 files
- 512 KiB per file
- 10 MiB total indexed bytes

`repo_index_build`, `durable_repo_index_refresh`, and `durable_index_manifest_refresh` accept:

```json
{ "preset": "large_repo" }
```

Large-repo caps are:

- 50,000 files
- 1 MiB per file
- 512 MiB total indexed bytes

Explicit `maxFiles`, `maxFileBytes`, or `maxTotalBytes` values override the preset.

Durable SQLite status reports `ftsAvailable` and `retrievalModes`. Durable query results report `retrievalMode` so agents can distinguish SQLite FTS, SQLite LIKE, JSON, and manifest fallback paths.

Pre-`0.8.0` durable repo indexes are stale after upgrade because the repo fingerprint now includes the AST extractor generation. Run `durable_repo_index_refresh`, `durable_index_manifest_refresh`, or `state_maintenance_run` once per repo to rebuild AST-backed durable facts.

## Python Runtime

Wormhole uses TypeScript as the MCP control plane and requires Python 3 for Python-backed sidecar jobs such as graph metrics, graph communities, media extraction, trace summaries, and offline policy evaluation.

Install Python dependencies during setup:

```bash
python -m pip install -r python/requirements.txt
```

Environment variables:

- `WORMHOLE_PYTHON`: explicit Python interpreter.
- `WORMHOLE_PYTHONPATH`: sidecar package path when it is outside the repo-local `python` directory.
- `WORMHOLE_PYTHON_STARTUP_TIMEOUT_MS`: startup probe timeout.
- `WORMHOLE_ALLOWED_REPO_ROOTS`: comma- or semicolon-separated allowed repo roots for MCP repo tools.

## Local Commands

Requires Node.js 22.5.0 or newer for the built-in SQLite durable index backend.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run benchmarks:validate
npm run benchmarks:run
```

## Client Setup

Build first:

```bash
npm run build
```

For Claude Code or direct MCP attachment:

```bash
node dist/src/cli.js
```

For Claude Desktop, install the unpacked extension from `plugins/wormhole-claude-desktop` in developer settings. The extension launches `dist/src/cli.js` through `plugins/wormhole-claude-desktop/server/index.js`.

For Codex, use the repo-local plugin metadata in `plugins/wormhole/.codex-plugin/plugin.json`. The plugin MCP config points to `../../dist/src/cli.js` from `plugins/wormhole`.

## Maintained Docs

- [Canonical plan](docs/planning/wormhole-canonical-plan.md)
- [Orchestration and adaptive architecture](docs/architecture/orchestration-adaptive-capabilities.md)
- [Capability manifest contract](docs/contracts/capability-manifest.md)
- [Inspiration](docs/inspiration.md)
- [Changelog](CHANGELOG.md)

Dated implementation plans, generated tool inventories, and one-off analysis reports are intentionally not maintained as current documentation. Use git history for implementation archaeology.
