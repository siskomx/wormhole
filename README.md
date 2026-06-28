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
- SQLite-backed durable repo indexes under `.wormhole/indexes`, plus JSON compatibility exports and shard manifests.
- `repo_index_build`, `repo_index_query`, `repo_index_explain`, `repo_index_path`, and `repo_index_report` for immediate repo graph work.
- `durable_repo_index_refresh`, `durable_index_status`, `durable_index_manifest_refresh`, `durable_index_manifest_status`, and `durable_repo_index_query` for persistent large-repo retrieval.
- Project contracts, dependency inventory, command maps, architecture maps, entrypoint discovery, blast-radius analysis, and generated project context packs.
- Repo-native coverage packs and feature-slice queries over feature indexes, scripts, conventions, schema evidence, verification gates, source conflicts, and coverage gaps.

### Domain Indexing

Wormhole also has a manifest-driven domain indexing layer for repositories where generic file/symbol indexing is not enough.

Domain indexing joins:

- Feature ids, aliases, roots, portals, and owned database tables from `.wormhole/domain-index.json`.
- Route, hook, service, migration, OpenAPI, convention, and memory files.
- OpenAPI endpoint observations, route-scan fallback endpoints, auth hints, query keys, and response schema refs.
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

### Domain-Indexed Repos

1. Add `.wormhole/domain-index.json`.
2. Run `domain_index_refresh`.
3. Check `domain_index_status`.
4. Use `domain_slice_query`, `domain_api_query`, `domain_table_query`, and `domain_verification_gate_plan` before implementation.
5. Use `domain_index_coverage` and `domain_index_drift` before trusting the stored domain facts.

### Implementation Loop

1. Prepare context with `agent_context_prepare`.
2. Narrow impact with `blast_radius_analyze`, `test_impact_analyze_v2`, `domain_slice_query`, or `feature_slice_query`.
3. Make edits through normal repo tooling or guarded patch transactions when rollback matters.
4. Run focused verification.
5. Record evidence.
6. Ask `gate_request`.

## Domain Manifest

Create `.wormhole/domain-index.json` to teach Wormhole repo-specific feature ownership:

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

## Runtime State

- MCP entrypoint: `src/cli.ts`
- Event log: `.wormhole/events.jsonl`
- Handler runtime state: `.wormhole/runtime-state.json`
- App-process run state: `.wormhole/app-process/run-state.json` and `.wormhole/app-process/events.jsonl`
- Durable repo indexes: `.wormhole/indexes/repo-index.sqlite`, JSON compatibility exports, and manifest shards.
- Domain index: `.wormhole/indexes/domain-index.sqlite`
- Codex plugin metadata: `plugins/wormhole/.codex-plugin/plugin.json`
- Claude Desktop extension metadata: `plugins/wormhole-claude-desktop`

The `.wormhole` directory is local runtime state and is ignored by git.

## Freshness And Index Health

Repo, durable-index, domain-index, architecture, blast-radius, context-pack, and routing responses expose shared `indexHealth` metadata. Agents should inspect this before trusting generated guidance.

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
