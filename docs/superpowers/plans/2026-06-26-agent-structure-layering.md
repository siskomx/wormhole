# Agent Structure Layering Implementation Plan

## Goal

Make Wormhole safer for coding agents in large repos by adding a validated tool registry, read-only discovery views, and routing hints that keep the full MCP surface visible without forcing agents to reason over every tool at once.

## Current Surface

- `src/mcp-server.ts` registers 156 MCP tools.
- `plugins/wormhole-claude-desktop/manifest.json` lists 132 tools, so manifest coverage is stale.
- `mission_route` and `agent_context_prepare` already live in `src/agent-routing.ts`; orchestration and context-maintenance guidance belongs there.
- Tool handlers are centralized in `src/tools.ts`; the registry should be independent data consumed by handlers and server registration tests.

## Execution Order

1. Add failing conformance tests.
   - Enumerate registered MCP tools from `createWormholeMcpServer`.
   - Require every registered tool to have registry metadata.
   - Require handler coverage for registry-backed tools, allowing explicitly documented server-only async wrappers.
   - Require the Claude manifest to use the compact-manifest policy or match registry coverage.

2. Add the registry.
   - Create a typed tool registry with stable metadata: `name`, `plane`, `phase`, `pack`, `risk`, `summary`, `inputs`.
   - Keep metadata deterministic and local; no model scoring or free-text search.
   - Include validation helpers so tests can catch missing or duplicate entries.

3. Add discovery tools.
   - Add `tool_layer_map` as a read-only view over planes, phases, packs, counts, and tool names.
   - Add `tool_catalog_query` as a structured query over the registry by `plane`, `phase`, `pack`, `risk`, and `toolNames`.
   - Register both in MCP and expose them through `createToolHandlers`.

4. Extend routing and context preparation.
   - Add `stateMaintenance` hints to `mission_route`.
   - Add `stateMaintenance` and `recommendedDiscovery` hints to `agent_context_prepare`.
   - Keep this advisory only; do not add autonomous background watchers or graph mutation.

5. Align manifests and prompts.
   - Use a compact-manifest policy for Claude if full coverage remains too large.
   - Add `tool_layer_map` and `tool_catalog_query` to guidance so agents discover the right layer first.

6. Verify.
   - Run focused tests for registry, MCP registration, routing, tools, and plugin manifest behavior.
   - Run `npm run typecheck`.
   - Run the broader test suite if focused checks pass cleanly.

## Non-Goals

- Do not implement opt-in dynamic MCP tool hiding in this pass.
- Do not add learned routing policy changes.
- Do not let discovery tools mutate context, graph, repo state, or runtime policy.
