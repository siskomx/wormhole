# Project Intelligence Sequencing Design

## Goal

Implement the next Wormhole sequencing gaps as one integrated project-intelligence layer: project onboarding orchestration, managed LSP session contracts, durable repo/semantic indexes, deeper test-impact analysis, dependency/security reporting, action admission control, and external optimization adapters.

## Architecture

The design is additive and local-first. Existing modules remain the source of truth for project contracts, repo indexes, diagnostics, semantic fallback search, safety scans, and verification; new modules compose them into higher-level workflows and add durable state where process-local behavior is currently too weak.

The first slice favors deterministic contracts over external-service dependence. LSP sessions and optimization adapters support real local process execution when configured, but return structured unavailable/failed results when binaries or endpoints are missing. Dependency/security reporting is local lockfile/package analysis first; it emits stable report shapes suitable for future online vulnerability providers without requiring network calls.

## Components

- `project-onboard.ts`: one-shot orchestration over contract detection, repo indexing, LSP probe, safety scan, impact analysis, test-plan selection, dependency/security reporting, and action-policy review.
- `lsp-session-manager.ts`: process-local LSP lifecycle with start, list/status, JSON-RPC request, and stop contracts.
- `durable-index-store.ts`: `.wormhole/indexes` persistence for repo and semantic indexes, keyed by repo root and refreshed by fingerprint.
- `test-impact-v2.ts`: unified-diff hunk parsing, changed-symbol mapping from repo index symbols, and confidence-scored test recommendations.
- `dependency-security.ts`: package/lockfile inventory, direct/transitive counts, missing-lockfile and license/vulnerability placeholder-safe findings.
- `action-policy.ts`: admission review for commands, file edits, tool writes, deletions, network actions, and rollback hints.
- `optimization-adapter.ts`: registry, selection, and run contracts for native, CLI, and HTTP optimization adapters.

## Data Flow

`project_onboard` is the top-level entry. It resolves the repo root, builds or refreshes durable indexes, runs independent inspections, merges results into a report, and returns recommended next actions. It does not mutate source files. It may write `.wormhole/indexes` cache files.

The MCP tool layer exposes both the aggregate tool and lower-level tools so agents can either call `project_onboard` or inspect individual subsystems.

## Safety And Error Handling

All repo-reading tools are confined by existing allowed-root checks in `src/tools.ts`. Durable index paths are resolved under the target repo's `.wormhole/indexes`. LSP and adapter processes are bounded by timeouts and never use a shell. Unavailable commands return structured results instead of throwing after process startup failures.

## Testing

Each new module gets direct Vitest coverage. Handler tests prove the modules work in combination through `createToolHandlers`. MCP/plugin/capability tests ensure the surface is discoverable. Full verification remains `npm test`, `npm run typecheck`, `npm run build`, `npm run benchmarks:validate`, MCPB validation, and `git diff --check`.
