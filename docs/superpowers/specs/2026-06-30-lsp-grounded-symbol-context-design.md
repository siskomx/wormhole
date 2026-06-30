# LSP-Grounded Symbol Context Design

Status: proposed for user review
Date: 2026-06-30

## Context

Wormhole already has strong static repo intelligence:

- Durable repo indexes in JSON and SQLite.
- File, symbol, import, reference, and inferred call graph extraction.
- Graph communities, execution flows, graph wiki, and graph-node semantic search.
- Repo watch and state maintenance paths that can refresh durable graph state.
- Domain and feature indexes with coverage and drift checks.
- Impact, test-impact, source-conflict, diagnostic, and verification tools.
- LSP support through `lsp_probe`, `lsp_server_configs`, `lsp_normalize_location`, `lsp_session_start`, `lsp_session_request`, `lsp_session_status`, and `lsp_session_stop`.

The gap is that LSP facts are still separate from the graph/index facts. A coding agent can ask for static graph context or manually drive LSP JSON-RPC, but there is no agent-friendly layer that merges both into one symbol-level answer with freshness, confidence, and diagnostics.

The recent graph-node semantic search change tightened stale-index behavior: stale or missing semantic graph indexes are refused instead of silently returned. The next improvement should follow the same reliability pattern: when a symbol-level answer depends on compiler or language-server truth, Wormhole should either return fresh grounded facts or clearly report the degraded path.

## Goal

Build an LSP-grounded symbol context layer that makes it easier for coding agents to answer:

- Where is this symbol really defined?
- What references or callers should I inspect before editing it?
- What does the language server know about the type/signature?
- Are there diagnostics around this file or symbol?
- Which facts came from the durable graph, and which came from live LSP?
- Is the answer fresh for the current repo fingerprint?

The first implementation should be read-only and narrow. It should not mutate the durable graph schema or change blast-radius behavior yet.

## Non-Goals

- Do not replace the repo indexer with LSP.
- Do not require an LSP server for existing graph/index tools to keep working.
- Do not run whole-repo LSP reference scans in the first PR.
- Do not persist a new LSP fact cache in the first PR.
- Do not implement rename, code actions, or automatic refactors.
- Do not block existing static queries when LSP is unavailable.

## Design Summary

Add a new symbol context service and MCP tool that merge static repo graph facts with live LSP facts on demand.

Initial tool shape:

```ts
// line and character are one-based at the MCP boundary.
symbolContext(input: {
  repoRoot: string;
  file?: string;
  symbol?: string;
  line?: number;
  character?: number;
  language?: "typescript" | "python" | "csharp";
  timeoutMs?: number;
}): Promise<SymbolContextResult>
```

The tool resolves the target symbol from the durable repo index, starts or reuses an LSP session when configured, asks the language server for definition, references, hover, and diagnostics, then returns a compact merged context packet.

The first PR exposes live facts only in the response. Later PRs can persist an LSP fact overlay and teach semantic search, impact analysis, and test impact to consume it.

## Architecture

### Existing Pieces

The design should build on these current modules:

- `src/lsp-ground-truth.ts`: detects safe LSP startup config and normalizes LSP locations.
- `src/lsp-session-manager.ts`: starts JSON-RPC LSP sessions and sends requests.
- `src/repo-index.ts`: builds the static file/symbol/edge graph and explains nodes.
- `src/sqlite-repo-index.ts`: persists/query durable file and symbol records.
- `src/durable-index-store.ts`: stores durable repo indexes and freshness state.
- `src/graph-node-semantic.ts`: builds/searches graph semantic records.
- `src/repo-activity.ts`: handles repo watch and changed-file detection.
- `src/tools.ts`: hosts tool handler wiring.
- `src/mcp-server.ts`: registers MCP schemas and tool descriptions.
- `src/tool-registry.ts`: advertises tool metadata and risk/phase.

### New Unit: Symbol Context Service

Add a focused module:

```text
src/lsp-symbol-context.ts
```

Responsibilities:

- Resolve a requested target to a repo-index symbol when possible.
- Determine the best LSP position to query.
- Build LSP request params for `textDocument/definition`, `textDocument/references`, `textDocument/hover`, and diagnostics where supported.
- Normalize LSP locations through existing location helpers.
- Merge static graph facts and live LSP facts into one response.
- Return explicit freshness/confidence/degraded-state metadata.

This module should not own LSP process lifecycle directly. It should receive or call the existing LSP session manager through the tool handler layer.

### New MCP Tool

Register:

```text
symbol_context
```

Tool phase: `gather`
Risk: `read`
Pack: `large-repo`

Description:

> Return a compact symbol context packet by merging durable repo graph facts with live LSP definition, reference, hover, and diagnostic facts when available.

This name is intentionally not `lsp_symbol_context`. The agent asks for symbol context; LSP is one evidence source. The result can still work in graph-only degraded mode.

## Data Flow

1. Agent calls `symbol_context` with `repoRoot` and either:
   - `file` + `line` + `character`, or
   - `file` + `symbol`, or
   - `symbol` alone.

2. Tool handler resolves and validates `repoRoot`.

3. Symbol context service loads the current repo index through the existing project/index path.

4. Target resolution:
   - If position is provided, choose the nearest symbol in that file whose line is at or before the requested line.
   - If file and symbol are provided, choose matching symbols in that file.
   - If symbol only is provided, return ranked candidates and mark ambiguity if more than one likely match exists.

5. Static graph facts are collected:
   - symbol id, name, kind, file, line
   - file language
   - inbound edges
   - outbound edges
   - nearby same-file symbols
   - graph index health/fingerprint

6. LSP availability is checked using `detectLanguageServerConfigs`/`lspProbe` style logic.

7. If LSP is configured and the request includes enough location data:
   - start or reuse an LSP session
   - send `textDocument/definition`
   - send `textDocument/references`
   - send `textDocument/hover`
   - optionally send `textDocument/diagnostic` if supported by the server
   - stop only sessions created for the one-shot call if the existing session manager does not retain them intentionally

8. Normalize LSP responses into repo-relative paths and one-based locations.

9. Return a merged result with source attribution and confidence.

## Result Shape

```ts
type SymbolContextResult = {
  repoRoot: string;
  query: {
    file?: string;
    symbol?: string;
    line?: number;
    character?: number;
  };
  target?: {
    symbolId: string;
    name: string;
    kind: string;
    path: string;
    line: number;
    confidence: "exact" | "position-nearest" | "fuzzy" | "ambiguous";
  };
  candidates: Array<{
    symbolId: string;
    name: string;
    kind: string;
    path: string;
    line: number;
    reason: string;
  }>;
  graph: {
    fingerprint: string;
    fresh: boolean;
    inboundEdges: Array<SymbolContextEdge>;
    outboundEdges: Array<SymbolContextEdge>;
    nearbySymbols: Array<{ name: string; kind: string; line: number }>;
  };
  lsp: {
    status: "fresh" | "unavailable" | "not_configured" | "timed_out" | "failed" | "insufficient_target";
    server?: {
      language: string;
      command: string;
    };
    definitionLocations: SymbolContextLocation[];
    referenceLocations: SymbolContextLocation[];
    hoverText?: string;
    diagnostics: SymbolContextDiagnostic[];
    warnings: string[];
  };
  freshness: {
    durableGraph: "fresh" | "stale" | "missing" | "degraded" | "unknown";
    lsp: "fresh" | "unavailable" | "not_configured" | "timed_out" | "failed" | "insufficient_target";
  };
  warnings: string[];
};

type SymbolContextLocation = {
  path: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
};

type SymbolContextEdge = {
  kind: string;
  from: string;
  to: string;
  path?: string;
  line?: number;
  label?: string;
  source: "repo-index";
};

type SymbolContextDiagnostic = {
  path: string;
  line: number;
  character: number;
  severity?: "error" | "warning" | "information" | "hint";
  message: string;
  source?: string;
};
```

Keep the first implementation compact if TypeScript verbosity becomes high. The important contract is source separation: graph facts and LSP facts must be visibly distinct.

## Freshness and Degradation

The tool should follow Wormhole's existing freshness posture:

- If the durable graph is stale, include graph stale warnings.
- If LSP is unavailable, return graph-only context with `lsp.status = "unavailable"` or `"not_configured"`.
- If LSP times out, return graph-only context plus timeout warning.
- If LSP returns malformed data, return graph-only context plus parse warning.
- If target resolution is ambiguous, return candidates and avoid pretending one was certain.

The first PR should not refuse all output just because LSP is unavailable. The correct behavior is degraded context, because existing static graph tools remain useful. Refusal should be reserved for future modes where the caller explicitly requires LSP-grounded facts.

## Error Handling

- Bound LSP startup and request time with `timeoutMs`, defaulting to a short value such as 5 seconds.
- Report per-request failures independently when possible. A hover failure should not erase definition/reference results.
- Cap reference locations to a conservative default, such as 100, with a truncation warning.
- Normalize paths defensively and drop locations outside `repoRoot`.
- Avoid leaking raw LSP protocol noise in the primary result. Keep detailed errors in warnings.

## Testing Plan

First PR tests:

- Unit test target resolution from `file + symbol`.
- Unit test target resolution from `file + line + character`.
- Unit test ambiguous symbol lookup returns candidates.
- Unit test graph-only result when no LSP server is configured.
- Unit test timeout/degraded LSP behavior using a fake or missing command.
- Unit test normalization of LSP locations into repo-relative files.
- Tool handler test for `symbol_context` schema and allowed repo root handling.
- MCP registry test confirming the tool is advertised as read/gather/large-repo.

Second PR tests, once persistence exists:

- LSP overlay cache invalidates on repo fingerprint/file hash change.
- Repo watch marks changed-file symbol facts stale.
- Graph-node semantic search can require fresh LSP facts.
- Impact/test-impact prefer LSP references when available and fall back to static graph edges otherwise.

## Rollout Plan

### PR 1: Read-Only Symbol Context

Implement:

- `src/lsp-symbol-context.ts`
- `symbolContext` handler in `src/tools.ts`
- MCP schema and registration in `src/mcp-server.ts`
- registry metadata in `src/tool-registry.ts`
- focused tests

No durable graph mutation. No SQLite schema changes.

### PR 2: LSP Fact Overlay

Persist LSP facts in a separate overlay keyed by repo fingerprint/file hash:

- definitions
- references summary
- hover/type text
- diagnostics summary
- resolved timestamp
- source server metadata

This should be additive and safe to delete/rebuild.

### PR 3: Consumer Integration

Teach existing tools to consume the overlay:

- graph-node semantic search can boost/filter LSP-backed symbols
- impact analysis can prefer LSP references for changed symbols
- test-impact can use LSP references when available
- state maintenance can report stale LSP overlay health

## Open Decisions

1. Tool name: use `symbol_context` unless the project prefers names prefixed with `lsp_`.
2. Session lifetime: decide whether one-shot symbol context should stop sessions it starts, or retain sessions through the existing manager for subsequent calls.
3. Diagnostic method support: `textDocument/diagnostic` is not universally implemented. First PR can make diagnostics best-effort and rely on existing `diagnostics_from_lsp` paths for explicit diagnostic ingestion.
4. Position units: MCP input should be one-based line/character for human/editor friendliness, then converted to LSP zero-based internally.
5. LSP requirement mode: first PR should only degrade. A later PR can add `requireLsp: true` to refuse graph-only answers.

## Acceptance Criteria

- A coding agent can ask one tool for symbol context instead of separately using repo index queries and raw LSP requests.
- The response identifies which facts came from durable graph state and which came from LSP.
- Ambiguous symbol requests return candidates instead of silently choosing an arbitrary target.
- LSP failures do not break graph-only context.
- Timeouts are bounded and visible.
- Tool metadata, MCP registration, and tests cover the new surface.
- No existing graph/index behavior changes in PR 1.
