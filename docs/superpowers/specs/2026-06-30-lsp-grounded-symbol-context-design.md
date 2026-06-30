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

The first implementation should be read-only with respect to source files and durable graph state, and narrow in scope. It should not mutate the durable graph schema or change blast-radius behavior yet. Because the live path may start a language-server child process, the MCP/tool registry risk should be `execute`, not `read`. The live LSP path should be proven for TypeScript first; other languages can return graph-only degraded context until their server lifecycle and request semantics are explicitly tested.

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
  aspects?: Array<"definition" | "hover" | "references">;
  includeReferences?: boolean;
  referencesLimit?: number;
  referencesIncludeDeclaration?: boolean;
  excludeExternal?: boolean;
  sessionMode?: "reuse" | "one_shot";
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
}): Promise<SymbolContextResult>
```

The tool resolves the target symbol from the durable repo index, starts or reuses an LSP session when configured, asks the language server for definition and hover by default, optionally asks for references, then returns a compact merged context packet. Diagnostics are not live-requested in PR1; the tool may surface diagnostics that already exist in Wormhole's diagnostic records.

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
- Build LSP request params for `textDocument/definition`, `textDocument/hover`, and optionally `textDocument/references`.
- Prepare and send `textDocument/didOpen` before live LSP requests when the target file is not already open in the session.
- Send `textDocument/didClose` only for one-shot sessions or files opened solely for this request.
- Normalize LSP locations through existing location helpers.
- Merge static graph facts and live LSP facts into one response.
- Return explicit freshness/confidence/degraded-state metadata.

This module should not spawn child processes directly. It should receive or call the existing LSP session manager through the tool handler layer. The implementation should add a retained-session path keyed by `repoRoot + language` with an idle timeout so repeated agent calls do not pay cold-start cost every time. Sessions created only for a single request must be stopped in a `finally` path.

### New MCP Tool

Register:

```text
symbol_context
```

Tool phase: `gather`
Risk: `execute`
Pack: `large-repo`

Description:

> Return a compact symbol context packet by merging durable repo graph facts with live LSP definition, reference, hover, and diagnostic facts when available.

This name is intentionally not `lsp_symbol_context`. The agent asks for symbol context; LSP is one evidence source. The result can still work in graph-only degraded mode.

The tool is repo-state read-only but not process-effect free. If the handler starts or reuses an LSP process internally, it must call the existing privileged action gate with a `command` operation for the selected server command, mirroring `lsp_session_start`.

`sessionMode` defaults to `"reuse"`. In reuse mode, the handler must authorize only when a new server process is actually started, not when a retained compatible session is reused. In one-shot mode, the handler must bypass retained-session reuse entirely, start an isolated unkeyed session for that call, and stop only that isolated session in `finally`.

Retained-session acquisition must be atomic per `repoRoot + language + command + args` so concurrent reuse-mode calls cannot spawn duplicate language servers. Idle cleanup must skip acquired, queued, active, or pending-request sessions.

## Data Flow

1. Agent calls `symbol_context` with `repoRoot` and either:
   - `file` + `line` + `character`, or
   - `file` + `symbol`, or
   - `symbol` alone.

2. Tool handler resolves and validates `repoRoot`.

3. Symbol context service loads the current repo index through the existing project/index path. If the index is missing or cannot be read, return degraded context with empty graph facts, `graph.status = "missing"`, and a warning rather than throwing.

4. Target resolution:
   - If `file + line + character` is provided and LSP is available, query `textDocument/definition` at the exact position first. Use the returned definition location to attach repo-index symbol facts when possible.
   - If `file + line + character` is provided but LSP is unavailable, use graph symbol ranges if available. If ranges are unavailable, use nearest preceding symbol only as a degraded fallback and include a warning.
   - If file and symbol are provided, choose matching symbols in that file.
   - If symbol only is provided, return ranked candidates and mark ambiguity if more than one likely match exists.
   - If file and symbol are not found, return no target, populate candidates from the file when possible, and include a warning.
   - If line/character are outside the file bounds, clamp to the closest valid position and include a warning.

5. Static graph facts are collected:
   - symbol id, name, kind, file, line
   - file language
   - inbound edges
   - outbound edges
   - nearby same-file symbols
   - graph index health/fingerprint

6. LSP availability is checked using `detectLanguageServerConfigs`/`lspProbe` style logic.

7. If LSP is configured and the request includes enough location data:
   - start or reuse a retained LSP session
   - authorize command startup only when the request will spawn a new child process
   - read the target file from disk and send `textDocument/didOpen` if needed
   - send `textDocument/definition`
   - send `textDocument/hover`
   - send `textDocument/references` only when `includeReferences` is true or `aspects` includes `"references"`
   - use `{ includeDeclaration: false }` by default for references unless `referencesIncludeDeclaration` is true
   - send requests sequentially through the session manager's JSON-RPC request path unless the manager provides an explicit per-session queue
   - wrap each LSP request in its own failure handling so a hover failure does not erase definition results
   - on session death, mark the LSP section failed and return graph-only context
   - send `textDocument/didClose` in `finally` for files opened by this request
   - stop one-shot sessions in `finally`
   - keep retained sessions alive only after successful initialization, and do not let idle cleanup kill active requests

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
    aspects: Array<"definition" | "hover" | "references">;
  };
  target?: {
    symbolId: string;
    name: string;
    kind: string;
    path: string;
    line: number;
    confidence: "lsp-definition" | "exact" | "position-nearest" | "fuzzy";
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
    status: "fresh" | "stale" | "missing" | "degraded" | "unknown";
    inboundEdges: SymbolContextEdgeList;
    outboundEdges: SymbolContextEdgeList;
    nearbySymbols: Array<{ name: string; kind: string; line: number }>;
  };
  lsp: {
    status: "fresh" | "partial" | "unavailable" | "not_configured" | "unsupported_language" | "timed_out" | "failed" | "insufficient_target";
    sessionId?: string;
    server?: {
      language: string;
      command: string;
    };
    definitionStatus: SymbolContextRequestStatus;
    hoverStatus: SymbolContextRequestStatus;
    referencesStatus: SymbolContextRequestStatus;
    definitionLocations: SymbolContextLocation[];
    referenceLocations: SymbolContextLocation[];
    referencesReturned: number;
    referencesTotalKnown?: number;
    referencesTruncated: boolean;
    externalLocationsExcluded?: number;
    hoverContents: Array<{ kind: "markdown" | "plaintext"; value: string }>;
    diagnostics: SymbolContextDiagnostic[];
  };
  warnings: string[];
};

type SymbolContextRequestStatus =
  | "not_requested"
  | "fresh"
  | "timed_out"
  | "failed"
  | "unsupported"
  | "insufficient_target";

type SymbolContextLocation = {
  path: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
  external: boolean;
};

type SymbolContextEdgeList = {
  items: SymbolContextEdge[];
  totalCount: number;
  truncated: boolean;
};

type SymbolContextEdge = {
  kind: string;
  from: string;
  to: string;
  path?: string;
  line?: number;
  label?: string;
  source: "repo-index" | "lsp-overlay";
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

- If the durable graph is stale, set `graph.status = "stale"` and include graph stale warnings.
- If the durable graph is missing or unreadable, set `graph.status = "missing"` and return empty graph facts plus warnings.
- If the tool rebuilds a current in-memory repo index for this request, `graph.status` may be `"fresh"` even when an older durable artifact exists; the status must describe the graph facts actually returned.
- If LSP is unavailable, return graph-only context with `lsp.status = "unavailable"` or `"not_configured"`.
- If LSP times out, return graph-only context plus timeout warning.
- If LSP returns malformed data, return graph-only context plus parse warning.
- If target resolution is ambiguous, return candidates and avoid pretending one was certain.

The first PR should not refuse all output just because LSP is unavailable. The correct behavior is degraded context, because existing static graph tools remain useful. Refusal should be reserved for future modes where the caller explicitly requires LSP-grounded facts.

Do not duplicate freshness fields. `graph.status` is authoritative for durable graph state. `lsp.status` and the per-request statuses are authoritative for live LSP state.

## Error Handling

- Bound LSP startup with `startupTimeoutMs`, defaulting to 30 seconds and capped at 60 seconds.
- Bound each LSP request with `requestTimeoutMs`, defaulting to 15 seconds and capped at 30 seconds.
- Report per-request failures independently when possible. A hover failure should not erase definition/reference results.
- Cap reference locations with `referencesLimit`, defaulting to 50 and capped at 1,000, with truncation counts and warnings.
- Normalize paths defensively.
- Keep LSP locations outside `repoRoot` with `external: true` unless `excludeExternal` is true. If excluded, report the excluded count in warnings.
- Handle malformed LSP data as a per-request failure with a warning rather than throwing away graph context.
- Ignore stale JSON-RPC responses that arrive after their request timed out.
- Avoid leaking raw LSP protocol noise in the primary result. Keep detailed errors in warnings.

## Testing Plan

First PR tests:

- Unit test target resolution from `file + symbol`.
- Unit test target resolution from `file + line + character`.
- Unit test ambiguous symbol lookup returns candidates.
- Unit test position lookup is LSP-first when LSP is available.
- Unit test `textDocument/didOpen` is sent before definition/hover on a fake server that requires it.
- Unit test `textDocument/didClose` is sent for files opened by the request.
- Unit test one-shot session cleanup runs in `finally` on success, timeout, and failure.
- Unit test retained sessions are reused and idle sessions can be stopped.
- Unit test privileged action gate runs only for new process startup, not retained-session reuse.
- Unit test line/character clamping emits a warning.
- Unit test LSP definition location reconciles back to a repo-index symbol with `confidence = "lsp-definition"`.
- Unit test graph-only result when no LSP server is configured.
- Unit test timeout/degraded LSP behavior using a fake or missing command.
- Unit test normalization of LSP locations into repo-relative files.
- Unit test external LSP locations are retained with `external: true`.
- Unit test external LSP locations are counted in warnings when `excludeExternal` is true.
- Unit test reference truncation returns `referencesTruncated = true`, counts, and warnings.
- Unit test concurrent `symbol_context` calls do not cross-wire LSP responses.
- Unit test fake server disconnect mid-call returns graph-only context and `lsp.status = "failed"`.
- Unit test TypeScript live path works while unsupported languages degrade explicitly.
- Tool handler test for `symbol_context` schema and allowed repo root handling.
- MCP registry test confirming the tool is advertised as execute/gather/large-repo.

Second PR tests, once persistence exists:

- LSP overlay cache invalidates on repo fingerprint/file hash change.
- Repo watch marks changed-file symbol facts stale.
- Graph-node semantic search can require fresh LSP facts.
- Impact/test-impact prefer LSP references when available and fall back to static graph edges otherwise.

## Rollout Plan

### PR 1: Repo-Read-Only TypeScript Symbol Context

Implement:

- `src/lsp-symbol-context.ts`
- TypeScript live LSP support for definition and hover
- optional references behind `includeReferences`
- graph-only degraded results for unsupported languages
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
2. Diagnostic method support: PR1 does not live-request diagnostics. Later PRs can consume existing `diagnostics_from_lsp` records or add explicit pull-diagnostic support where server capabilities prove it is available.
3. LSP requirement mode: first PR should only degrade. A later PR can add `requireLsp: true` to refuse graph-only answers.

## Acceptance Criteria

- A coding agent can ask one tool for symbol context instead of separately using repo index queries and raw LSP requests.
- The response identifies which facts came from durable graph state and which came from LSP.
- Ambiguous symbol requests return candidates instead of silently choosing an arbitrary target.
- Position-based requests use LSP definition first when LSP is available.
- Live LSP requests open the target document before querying.
- LSP failures do not break graph-only context.
- Timeouts are bounded and visible.
- References are opt-in, capped, and report truncation.
- External LSP locations are explicit instead of silently disappearing.
- Tool metadata, MCP registration, and tests cover the new surface, including `execute` risk for live LSP startup.
- No existing graph/index behavior changes in PR 1.
