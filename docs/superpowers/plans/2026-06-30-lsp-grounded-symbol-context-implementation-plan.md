# LSP-Grounded Symbol Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a repo-read-only `symbol_context` tool that merges Wormhole's static repo graph with TypeScript LSP definition/hover facts, optional capped references, explicit degradation, and clear source attribution for coding agents.

**Architecture:** Extend the existing LSP session manager with retained sessions, document lifecycle notifications, request locking, and realistic timeouts; add a focused `src/lsp-symbol-context.ts` service that receives repo index, diagnostics, LSP configs, and an authorization callback; wire the service through `src/tools.ts`, `src/mcp-server.ts`, and `src/tool-registry.ts`.

**Tech Stack:** TypeScript, Node.js stdio child processes, JSON-RPC/LSP protocol shapes, existing repo index graph types, MCP SDK tool registration, Zod schemas, Vitest.

---

## Current-State Constraints

- `src/lsp-session-manager.ts` currently supports start/request/stop but does not support JSON-RPC notifications, `textDocument/didOpen`, retained session lookup, initialization state, per-session operation locking, open document tracking, or idle cleanup.
- `startupTimeoutMs` is currently capped to 50ms with `Math.min(input.startupTimeoutMs ?? 50, 50)`. That must be fixed before higher-level LSP behavior is reliable.
- `src/repo-index.ts` symbols have `line` but no end range. Position fallback must be marked degraded because exact symbol containment is unavailable from the graph alone.
- Tool registry order must match MCP registration order exactly. Add `symbol_context` in both places at the same position.
- The new tool is repo-state read-only but starts/reuses a child process in live mode. Registry risk must be `execute`, and the handler must use the existing privileged action gate before starting an LSP command.
- Existing raw LSP tools must keep working. Preserve the current `start`, `request`, `list`, `status`, `stop`, and `stopAll` call signatures; add new capabilities around them instead of forcing existing callers to change.

## Task 1: Harden The LSP Session Manager

- [ ] Update [src/lsp-session-manager.ts](C:/Users/Ivan/Documents/GitHub/wormhole/src/lsp-session-manager.ts) types to expose retained sessions, notifications, initialization/open-document state, and a per-session lock.

Add these public shapes near the existing LSP session types:

```ts
export type LspNotificationResult = {
  sessionId: string;
  status: "sent" | "failed";
  error?: string;
};

export type LspDocumentOpenResult = LspNotificationResult & {
  openedByThisCall: boolean;
};

export type LspSessionAcquireResult = {
  info: LspSessionInfo;
  createdByThisCall: boolean;
  release: () => void;
};

export type LspSessionInfo = {
  sessionId: string;
  repoRoot: string;
  language: string;
  command: string;
  args: string[];
  status: LspSessionStatus;
  startedAt: string;
  lastUsedAt: string;
  initialized?: boolean;
  serverCapabilities?: unknown;
  openDocumentCount: number;
  error?: string;
};
```

The manager object should preserve existing methods and add these methods:

```ts
type LspSessionManager = {
  start(input: LspSessionStartInput): Promise<LspSessionInfo>;
  getOrStart(input: LspSessionStartInput & { beforeStart?: () => void | Promise<void> }): Promise<LspSessionAcquireResult>;
  list(): LspSessionInfo[];
  status(input: { sessionId: string }): LspSessionInfo | undefined;
  markInitialized(input: { sessionId: string; serverCapabilities?: unknown }): void;
  notify(input: { sessionId: string; method: string; params?: unknown }): Promise<LspNotificationResult>;
  request(input: { sessionId: string; method: string; params?: unknown; timeoutMs?: number }): Promise<LspRequestResult>;
  runExclusive<T>(input: { sessionId: string; operation: () => Promise<T> }): Promise<T>;
  ensureDocumentOpen(input: { sessionId: string; uri: string; languageId: string; version: number; text: string }): Promise<LspDocumentOpenResult>;
  closeDocument(input: { sessionId: string; uri: string }): Promise<LspNotificationResult>;
  stop(input: { sessionId: string; force?: boolean }): Promise<LspSessionInfo>;
  stopIdle(input?: { idleTimeoutMs?: number; nowMs?: number }): Promise<LspSessionInfo[]>;
  stopAll(): Promise<void>;
};
```

`getOrStart` must call `beforeStart` only when no compatible running session exists and a new child process will be spawned. It must not gate retained-session reuse. A compatible retained session is one with the same key, `status === "running"`, and no terminal child-process state. It can be uninitialized; the service initializes it inside the same `runExclusive` block before using it.

Retained-session acquisition must be atomic per session key:

- maintain `startingByKey: Map<string, Promise<ManagedSession>>`
- if a start is in progress for the same key, await that promise instead of starting another child process
- call `beforeStart` inside the per-key start path, immediately before `spawn`
- increment a `leaseCount` before returning `LspSessionAcquireResult`
- expose `release()` to decrement `leaseCount` in a service `finally`
- set `createdByThisCall: true` only for the caller that created the start promise; concurrent waiters on the same promise receive the same session with `createdByThisCall: false`
- clear `startingByKey` in `finally` when the start promise resolves or rejects so a later retry can succeed

This prevents duplicate child processes and prevents `stopIdle` from killing an acquired session before its queued operation starts.

- [ ] Replace the 50ms startup cap with a real bounded startup window.

Use a helper with the spec defaults:

```ts
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const MAX_STARTUP_TIMEOUT_MS = 60_000;

function clampStartupTimeout(value: number | undefined): number {
  const requested = value ?? DEFAULT_STARTUP_TIMEOUT_MS;
  return Math.max(1, Math.min(requested, MAX_STARTUP_TIMEOUT_MS));
}
```

The `start` timer should use `clampStartupTimeout(input.startupTimeoutMs)`. If the child exits before the timer settles, return `failed`/`stopped` instead of `running`.

- [ ] Add JSON-RPC notification support without allocating an id.

Use a single sender for request and notification writes:

```ts
function writeJsonRpc(child: ChildProcessWithoutNullStreams, payload: unknown): Promise<void> {
  const message = JSON.stringify(payload);
  const framed = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`;
  return new Promise((resolve, reject) => {
    child.stdin.write(framed, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
```

`notify` should write:

```ts
{
  jsonrpc: "2.0",
  method: input.method,
  params: input.params ?? {},
}
```

and return `{ sessionId, status: "sent" }` unless stdin write fails with EPIPE/backpressure errors. A notification write failure marks the session `failed`, clears retained keys/open documents, and resolves pending requests as failed. `request` should register the pending request before writing, then clear and fail that pending entry if `writeJsonRpc` rejects. That preserves response correlation while still making large `didOpen` payloads and broken pipes deterministic.

- [ ] Add retained-session reuse keyed by `repoRoot + language + command + args`.

Use a stable key:

```ts
function sessionKey(input: Pick<LspSessionStartInput, "repoRoot" | "language" | "command" | "args">): string {
  return JSON.stringify({
    repoRoot: path.resolve(input.repoRoot),
    language: input.language,
    command: input.command,
    args: input.args ?? [],
  });
}
```

`getOrStart` should return a running session with the same key when present; otherwise it calls `start`.

- [ ] Add operation serialization per session.

Each managed session should keep a `queue: Promise<void>`, `activeOperationCount`, `queuedOperationCount`, and `leaseCount`. `runExclusive` appends to the queue and runs the caller operation after the previous operation resolves or rejects. It must wrap the entire `symbol_context` LSP phase, not individual requests, so concurrent calls cannot interleave `initialize`, `didOpen`, definition, hover, references, and `didClose`.

`runExclusive` must update `lastUsedAt` at operation start and finish. `stopIdle` must skip sessions with active operations, queued operations, pending JSON-RPC requests, or `leaseCount > 0`, and it must only stop sessions where `nowMs - lastUsedAtMs >= idleTimeoutMs`.

`stop` and `stopAll` should also avoid terminating leased/active sessions by default. Add optional `{ force?: boolean }` to `stop` and `stopAll` internals while preserving existing call signatures; raw `lsp_session_stop` without `force` should return the current running session plus a warning/error field when the session is busy rather than killing an active `symbol_context` operation.

- [ ] Add open-document tracking.

`ensureDocumentOpen` should skip `textDocument/didOpen` when the URI is already in the session's `openDocuments` set. When it sends `didOpen`, add the URI to the set and return `openedByThisCall: true`.

`closeDocument` should send `textDocument/didClose` only if the URI is tracked as open, then remove it from the set.

- [ ] Handle child-process exit, close, and error deterministically.

On `error`, `exit`, or `close`, mark the session `unavailable`, `failed`, or `stopped`, remove its retained-session key, clear open documents, and resolve all pending requests with `status: "failed"`. The fake-server disconnect test must observe a failed LSP result without waiting for a second stale request.

- [ ] Handle stale JSON-RPC responses after timeout.

When a request times out, delete its pending entry and add its id to a bounded `timedOutRequestIds` set. If a response later arrives for that id, ignore it and do not let it affect a later request. Request ids remain monotonically increasing per session.

Request ids reset per new session. If `nextRequestId` would exceed `Number.MAX_SAFE_INTEGER`, mark the session failed and require a new session rather than wrapping ids.

- [ ] Add session-manager tests in [tests/lsp-session-manager.test.ts](C:/Users/Ivan/Documents/GitHub/wormhole/tests/lsp-session-manager.test.ts).

Add focused tests:

- missing command still returns `unavailable` and does not retain a session
- a fake server that exits after 80ms with `startupTimeoutMs: 200` returns `failed`, proving startup is no longer capped to 50ms
- `notify` sends a JSON-RPC notification without an `id`
- `ensureDocumentOpen` sends one `textDocument/didOpen` for repeated opens of the same URI
- `getOrStart` reuses a retained session for the same repo/language/command/args
- `runExclusive` serializes two async operations on the same session
- two concurrent `getOrStart` calls for the same key spawn only one child process, invoke `beforeStart` once, and return `createdByThisCall: true` only to the starter
- failed concurrent `getOrStart` startup clears `startingByKey` so a later retry can start
- newly-created retained session with failed initialization is force-stopped and evicted from the retained key map
- notification write failure marks the session failed and resolves pending requests
- `stopIdle` skips a session while `runExclusive` is active or a request is pending
- `stopIdle` skips a session after `getOrStart` returns but before `runExclusive` starts because `leaseCount > 0`
- `stopIdle` stops stale sessions and leaves fresh sessions running
- `stop` without `force` does not terminate a leased or active session
- a timed-out request does not poison the next successful request when the late response eventually arrives
- child `exit`/`close` resolves pending requests and removes retained sessions

Verification command:

```powershell
npx vitest run tests/lsp-session-manager.test.ts
```

Expected result: all `LSP session manager` tests pass with no unhandled child-process errors.

## Task 2: Add Graph-Only Symbol Context Service

- [ ] Create [src/lsp-symbol-context.ts](C:/Users/Ivan/Documents/GitHub/wormhole/src/lsp-symbol-context.ts).

Export the tool input/result contracts from the design spec. Keep MCP boundary fields one-based:

```ts
export type SymbolContextAspect = "definition" | "hover" | "references";

export type SymbolContextInput = {
  repoRoot: string;
  file?: string;
  symbol?: string;
  line?: number;
  character?: number;
  aspects?: SymbolContextAspect[];
  includeReferences?: boolean;
  referencesLimit?: number;
  referencesIncludeDeclaration?: boolean;
  excludeExternal?: boolean;
  sessionMode?: "reuse" | "one_shot";
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
};
```

The main function should accept dependencies explicitly:

```ts
export async function createSymbolContext(input: SymbolContextInput, deps: {
  index?: RepoIndex;
  graphStatus?: SymbolContextGraphStatus;
  initialWarnings?: string[];
  lsp?: SymbolContextLspDeps;
  diagnostics?: DiagnosticRecord[];
}): Promise<SymbolContextResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const warnings: string[] = [...(deps.initialWarnings ?? [])];
  const aspects = normalizeAspects(input);
  const graph = createGraphContext({ repoRoot, input, index: deps.index, warnings });
  const result = createBaseResult({ repoRoot, input, aspects, graph, warnings, diagnostics: deps.diagnostics ?? [] });
  if (!deps.lsp) {
    return withLspUnavailable(result, "not_configured", "No LSP dependencies were supplied.");
  }
  return enrichWithLsp(result, { input, aspects, graph, lsp: deps.lsp, warnings });
}
```

`graphStatus` defaults to:

- `"missing"` when `deps.index` is absent
- `"degraded"` when `deps.index.truncated === true`
- `"fresh"` when an in-memory index was built for the current request

Tests can pass `"stale"` directly to verify the stale response shape. Future durable-index integration can compute `"stale"` by comparing persisted fingerprints.

- [ ] Validate useful target input at the service boundary.

If the caller provides no `file`, no `symbol`, and no usable `line + character + file`, return graph-only context with:

- `target` unset
- empty candidates
- `lsp.status = "insufficient_target"`
- `lsp.sessionId` omitted
- warning: `symbol_context requires a file, symbol, or file + line + character target.`

If `line` or `character` is supplied without `file`, use the same insufficient-target path.

- [ ] Implement graph fallback target resolution with explicit ambiguity/degradation.

This resolver is used when live LSP is unavailable, not requested, or fails. When `file + line + character` is supplied and live TypeScript LSP is available, Task 3's LSP-definition-first path runs before this graph fallback.

Graph fallback resolution order:

1. `file + symbol`: exact name match in that repo-relative file.
2. `file + line`: nearest preceding symbol in the file, confidence `position-nearest`, plus warning that graph symbols do not have end ranges.
3. `symbol` only: exact repo-wide name matches as candidates; choose only if there is exactly one match.
4. no match: return candidates from the file or same name and leave `target` unset.

Use stable sorting:

```ts
function byPathThenLineThenName(left: RepoIndexSymbol, right: RepoIndexSymbol): number {
  return left.path.localeCompare(right.path) || left.line - right.line || left.name.localeCompare(right.name);
}
```

- [ ] Clamp file positions before graph or LSP resolution.

When `file + line + character` is supplied, read the current file content from disk and clamp to the closest valid one-based line/character. If disk read fails, fall back to indexed content when available and warn that clamping used indexed content:

```ts
function clampOneBasedPosition(input: { line: number; character: number; content: string }): {
  line: number;
  character: number;
  clamped: boolean;
} {
  const lines = input.content.split("\n");
  const line = Math.max(1, Math.min(input.line, Math.max(1, lines.length)));
  const lineText = lines[line - 1] ?? "";
  const character = Math.max(1, Math.min(input.character, lineText.length + 1));
  return { line, character, clamped: line !== input.line || character !== input.character };
}
```

If clamping occurs, add a warning and use the clamped position for LSP requests and graph fallback.

- [ ] Collect graph edges and cap them.

Use `index.edges.filter((edge) => edge.to === symbol.id)` for inbound and `edge.from === symbol.id` for outbound. Default edge cap should be 50 per direction. Return:

```ts
{
  items: cappedEdges,
  totalCount: allEdges.length,
  truncated: allEdges.length > cappedEdges.length,
}
```

- [ ] Compute nearby same-file symbols.

When a target exists, collect symbols in the same file, exclude the target, sort by absolute line distance, then path/name for stability, and return at most 10:

```ts
function nearbySymbols(index: RepoIndex, target: RepoIndexSymbol): Array<{ name: string; kind: string; line: number }> {
  return index.symbols
    .filter((symbol) => symbol.path === target.path && symbol.id !== target.id)
    .sort((left, right) =>
      Math.abs(left.line - target.line) - Math.abs(right.line - target.line) ||
      left.line - right.line ||
      left.name.localeCompare(right.name),
    )
    .slice(0, 10)
    .map((symbol) => ({ name: symbol.name, kind: symbol.kind, line: symbol.line }));
}
```

- [ ] Normalize repo-relative paths inside this module.

Use a local helper rather than importing private helpers from `tools.ts`:

```ts
function toRepoRelativeLocationPath(repoRoot: string, value: string): { path: string; external: boolean } {
  const absoluteValue = path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
  const relativePath = path.relative(repoRoot, absoluteValue);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return { path: value.replace(/\\/g, "/"), external: true };
  }
  return { path: relativePath.replace(/\\/g, "/"), external: false };
}
```

- [ ] Add graph-only tests in [tests/lsp-symbol-context.test.ts](C:/Users/Ivan/Documents/GitHub/wormhole/tests/lsp-symbol-context.test.ts).

Use temporary repos and `buildRepoIndex`. Cover:

- `file + symbol` resolves exactly
- `symbol` only returns ambiguity candidates
- `file + line` uses nearest-symbol fallback and emits a warning
- graph-only result sets `lsp.status = "not_configured"` when no LSP deps are passed
- inbound/outbound edges include `source: "repo-index"` and truncation metadata
- `nearbySymbols` returns the nearest 10 same-file symbols by line distance
- out-of-range line/character is clamped and emits a warning
- missing/absent index returns `graph.status = "missing"`
- injected `graphStatus: "stale"` returns `graph.status = "stale"` with the index fingerprint

Verification command:

```powershell
npx vitest run tests/lsp-symbol-context.test.ts
```

Expected result: all symbol-context graph-only tests pass.

## Task 3: Add TypeScript LSP Live Enrichment

- [ ] Define the LSP dependency boundary in [src/lsp-symbol-context.ts](C:/Users/Ivan/Documents/GitHub/wormhole/src/lsp-symbol-context.ts).

The service should not directly call the privileged action gate. It should receive an authorization callback from the tool layer:

```ts
export type SymbolContextLspDeps = {
  configs: LanguageServerConfig[];
  manager: ReturnType<typeof createLspSessionManager>;
  authorizeStart: (config: LanguageServerConfig) => void | Promise<void>;
};
```

- [ ] Support TypeScript live mode only in PR 1.

Choose the first detected TypeScript server config from `configs` in detection order. Choose a live server only when:

- `configs` contains `language === "typescript"`
- the target file extension is `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, or `.cjs`
- a file and one-based `line`/`character` are available, or LSP definition can be run from the graph target line with character `1` as a degraded fallback

Return `lsp.status = "not_configured"` when no server config exists. Return `lsp.status = "unsupported_language"` when a server config exists but TypeScript live mode is not applicable. Populate `lsp.server` when a server config was selected, even if startup is later denied or fails.

- [ ] Normalize aspects and session mode before live work.

Use:

```ts
function normalizeAspects(input: SymbolContextInput): SymbolContextAspect[] {
  const requested = input.aspects === undefined ? ["definition", "hover"] : input.aspects;
  const merged = new Set<SymbolContextAspect>(requested);
  if (input.includeReferences) {
    merged.add("references");
  }
  return [...merged];
}
```

`aspects: []` means the caller wants graph context plus already-recorded diagnostic-store records only; do not start or acquire LSP for diagnostics in PR1. `sessionMode` defaults to `"reuse"`.

`aspects: ["references"]` is equivalent to `includeReferences: true` for deciding whether to request references, but it does not imply definition or hover. Unknown aspect values are rejected by the MCP Zod schema; direct service calls should ignore unknown values with a warning rather than starting LSP for them.

- [ ] Clamp request timeout separately from startup timeout.

Use:

```ts
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;

function clampRequestTimeout(value: number | undefined): number {
  const requested = value ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.max(1, Math.min(requested, MAX_REQUEST_TIMEOUT_MS));
}
```

Pass the clamped value to `initialize`, `shutdown`, definition, hover, and references requests.

- [ ] Acquire sessions with explicit ownership.

For reuse mode:

```ts
const acquired = await manager.getOrStart({
  repoRoot,
  language: config.language,
  command: config.command,
  args: config.args,
  startupTimeoutMs,
  beforeStart: () => lsp.authorizeStart(config),
});
```

For one-shot mode, bypass retained-session reuse entirely. Do not use `getOrStart`, do not insert the session into the retained key map, and never return this session to a later reuse-mode caller:

```ts
await lsp.authorizeStart(config);
const oneShotInfo = await manager.start({
  repoRoot,
  language: config.language,
  command: config.command,
  args: config.args,
  startupTimeoutMs,
});
const acquired = { info: oneShotInfo, createdByThisCall: true };
```

Wrap authorization and startup in `try/catch`. If authorization throws or startup fails, return graph context with `lsp.status = "failed"` or `"unavailable"` and a warning. Do not throw away graph context.

The service must release acquired retained-session leases in `finally`:

```ts
let acquired: LspSessionAcquireResult | undefined;
try {
  acquired = await acquireSession();
  return await runLivePhase(acquired);
} finally {
  acquired?.release();
}
```

- [ ] Initialize the TypeScript server once per retained session.

The whole live phase must run inside `runExclusive`:

```ts
const sessionId = acquired.info.sessionId;
const liveResult = await manager.runExclusive({
  sessionId,
  operation: async () => {
    let openedDocument: LspDocumentOpenResult | undefined;
    let initializedThisCall = false;
    try {
      const current = manager.status({ sessionId: acquired.info.sessionId });
      if (!current?.initialized) {
        initializedThisCall = await initializeSession();
      }
      openedDocument = await manager.ensureDocumentOpen({ sessionId, uri, languageId, version: 1, text });
      return await requestLiveFacts();
    } finally {
      if (openedDocument?.openedByThisCall) {
        await manager.closeDocument({ sessionId, uri });
      }
      if (sessionMode === "one_shot" && manager.status({ sessionId })) {
        await shutdownThenStop(manager, sessionId, requestTimeoutMs);
      }
      if (acquired.createdByThisCall && !initializedThisCall && sessionMode !== "one_shot") {
        await manager.stop({ sessionId, force: true });
      }
    }
  },
});
```

Inside the locked operation, if the current `manager.status({ sessionId })?.initialized` is false:

```ts
const initialize = await manager.request({
  sessionId,
  method: "initialize",
  params: {
    processId: process.pid,
    rootUri: pathToFileURL(repoRoot).href,
    capabilities: {},
    workspaceFolders: [{ uri: pathToFileURL(repoRoot).href, name: path.basename(repoRoot) }],
  },
  timeoutMs: requestTimeoutMs,
});
```

If initialization completes, send `initialized`:

```ts
await manager.notify({ sessionId, method: "initialized", params: {} });
manager.markInitialized({
  sessionId,
  serverCapabilities: extractServerCapabilities(initialize.response?.result),
});
```

If initialization times out or fails, stop a newly-created session and return graph-only context with a warning.

If initialization succeeds in one-shot mode, shutdown/stop still runs in `finally` after live requests finish, guarded by the presence of a started session. In reuse mode, the service closes documents opened by the request and releases the lease, but it does not shut down or stop the retained session unless initialization failed for a newly-created session. A newly-created reuse session whose initialization fails must be force-stopped and evicted from the retained key map.

- [ ] Send `textDocument/didOpen` before live requests.

Read the target file from disk and send:

```ts
const openedDocument = await manager.ensureDocumentOpen({
  sessionId,
  uri,
  languageId,
  version: 1,
  text,
});
```

Language IDs:

- `.ts`, `.mts`, `.cts`: `typescript`
- `.tsx`: `typescriptreact`
- `.js`, `.mjs`, `.cjs`: `javascript`
- `.jsx`: `javascriptreact`

If the file is missing or unreadable, fall back to indexed file content when available and warn. If neither disk nor indexed content is available, skip live requests, set per-request statuses to `failed` or `insufficient_target`, and add a warning.

Guard very large `didOpen` payloads:

```ts
const MAX_DID_OPEN_BYTES = 1024 * 1024;
```

If the target text exceeds this limit, skip live LSP for PR1 and return graph context with a warning rather than sending an unbounded payload through stdio.

Closing documents after each request avoids stale retained-session text. A later optimization can keep documents open only when Wormhole also tracks file versions and sends `textDocument/didChange`.

For one-shot sessions, `shutdownThenStop` should attempt LSP shutdown before falling back to process stop:

```ts
async function shutdownThenStop(
  manager: ReturnType<typeof createLspSessionManager>,
  sessionId: string,
  timeoutMs: number,
): Promise<void> {
  try {
    const shutdown = await manager.request({ sessionId, method: "shutdown", params: null, timeoutMs });
    if (shutdown.status === "completed") {
      await manager.notify({ sessionId, method: "exit", params: {} });
    }
  } finally {
    await manager.stop({ sessionId });
  }
}
```

The existing raw `lsp_session_stop` behavior can remain process-oriented; the graceful shutdown helper is for symbol-context one-shot cleanup.

- [ ] Request definition and hover by default.

Use zero-based LSP positions:

```ts
const position = {
  line: Math.max(0, input.line - 1),
  character: Math.max(0, input.character - 1),
};
```

Definition params:

```ts
{
  textDocument: { uri },
  position,
}
```

Hover params use the same shape. Each request must have independent status handling so hover failure does not erase definition success.

When `file + line + character` is supplied, run LSP definition before final target selection. After a successful definition response:

1. Normalize the first repo-internal definition location.
2. Find a repo-index symbol in that file with the exact definition line.
3. If no exact match exists, use the nearest preceding symbol in that definition file and warn.
4. If a symbol is found, set `target.confidence = "lsp-definition"`.
5. If the definition line precedes every indexed symbol in that file or no symbol is found, keep the graph target or candidates and warn that the LSP definition did not map to a repo-index symbol.

This LSP-first path must win over the nearest-symbol graph fallback when live definition succeeds.

- [ ] Keep references opt-in and capped.

Only call `textDocument/references` when `includeReferences === true` or `aspects` contains `"references"`.

Use:

```ts
{
  textDocument: { uri },
  position,
  context: { includeDeclaration: input.referencesIncludeDeclaration === true },
}
```

Clamp `referencesLimit`:

```ts
const DEFAULT_REFERENCES_LIMIT = 50;
const MAX_REFERENCES_LIMIT = 1_000;

function clampReferencesLimit(value: number | undefined): number {
  const requested = value ?? DEFAULT_REFERENCES_LIMIT;
  return Math.max(0, Math.min(requested, MAX_REFERENCES_LIMIT));
}
```

Apply `requestTimeoutMs` to references. If references time out, set only `referencesStatus = "timed_out"` and compute the overall `lsp.status` as `"partial"` when definition or hover succeeded.

If `referencesLimit === 0`, do not send `textDocument/references`; set `referencesStatus = "not_requested"`, `referencesReturned = 0`, and add a warning that the references request was skipped because the limit is zero.

Before requesting references, inspect the stored initialize capabilities:

```ts
function supportsReferences(capabilities: unknown): boolean {
  return Boolean(
    capabilities &&
      typeof capabilities === "object" &&
      "referencesProvider" in capabilities &&
      (capabilities as { referencesProvider?: unknown }).referencesProvider,
  );
}
```

If references are requested but the server does not advertise `referencesProvider`, set `referencesStatus = "unsupported"` and do not send the request.

Reference limiting is applied after external filtering:

1. normalize all returned locations
2. count external locations
3. if `excludeExternal` is true, drop external locations and set `externalLocationsExcluded` to the dropped count
4. take the first `referencesLimit` remaining locations
5. set `referencesTotalKnown` to the pre-limit count after filtering and `referencesTruncated` when more filtered locations existed than were returned

This lets internal references fill the requested limit when external hits are excluded.

- [ ] Normalize LSP results defensively.

Support both `Location` and `LocationLink` for definition results. First pass every protocol location through `normalizeLspLocation` from [src/lsp-ground-truth.ts](C:/Users/Ivan/Documents/GitHub/wormhole/src/lsp-ground-truth.ts) so `file://` URIs are decoded consistently, then convert to repo-relative/external paths with `toRepoRelativeLocationPath`.

```ts
function locationLikeToProtocolLocation(value: unknown): LspProtocolLocation | undefined {
  if (isProtocolLocation(value)) {
    return value;
  }
  if (isLocationLink(value)) {
    return {
      uri: value.targetUri,
      range: value.targetSelectionRange ?? value.targetRange,
    };
  }
  return undefined;
}
```

Keep external locations with `external: true` unless `excludeExternal` is true. When excluded, append a warning with the excluded count.

If any LSP response has malformed data, catch it at the per-request parser boundary, set that request status to `failed`, append a warning, and continue returning graph context plus any other successful LSP facts.

- [ ] Normalize hover contents.

Support string, `MarkupContent`, `MarkedString`, and arrays. Return a compact array:

```ts
type SymbolContextHoverContent = {
  kind: "markdown" | "plaintext";
  value: string;
};
```

Map LSP `kind: "markdown"` to markdown; everything else becomes plaintext. Drop empty strings.

- [ ] Add live LSP tests in [tests/lsp-symbol-context.test.ts](C:/Users/Ivan/Documents/GitHub/wormhole/tests/lsp-symbol-context.test.ts).

Use a fake JSON-RPC server run with `process.execPath -e <script>`. The fake server should:

- record all received methods
- require `textDocument/didOpen` before returning definition/hover
- return a definition `Location`
- return hover as `{ contents: { kind: "markdown", value: "```ts\nfunction demo(): string\n```" } }`
- optionally return more references than the limit
- optionally return an external `file://` location
- optionally exit mid-request for failure tests

Cover:

- `didOpen` occurs before definition/hover
- `didClose` is sent in `finally` for a document opened by the request
- position lookup uses LSP definition before nearest graph fallback when LSP is available
- successful LSP definition maps back to a repo-index symbol and sets `target.confidence = "lsp-definition"`
- references are not requested by default
- references are requested when `includeReferences: true`
- references truncation sets `referencesTruncated = true`
- external locations are retained by default with `external: true`
- `excludeExternal: true` removes external locations and emits a warning
- request timeout returns graph-only context with `lsp.status = "timed_out"` or `partial`
- hover failure leaves successful definition locations intact and sets overall `lsp.status = "partial"`
- definition failure leaves successful hover contents intact and sets overall `lsp.status = "partial"`
- malformed LSP response data fails only the affected request and emits a warning
- fake server disconnect returns graph-only context with `lsp.status = "failed"`
- one-shot mode sends `shutdown`, `exit`, and stops the isolated session in `finally`
- one-shot mode bypasses retained reuse and cannot stop a shared reuse-mode session
- two concurrent `createSymbolContext` calls share one retained session, execute their live phases serially, attribute responses to the correct caller, send `didClose` for each document opened by the request, and leave `openDocumentCount = 0`
- two concurrent calls against an uninitialized retained session send exactly one `initialize` and one `initialized`
- strict privileged gate failure returns graph context with `lsp.status = "failed"` and does not throw
- reuse mode gates only the first call that starts the process; the second retained-session call does not invoke `authorizeStart`
- graph-only results and `aspects: []` do not acquire or start an LSP session
- `aspects: []` may return existing diagnostic-store records but does not live-request diagnostics
- `aspects: ["references"]` requests references without definition/hover
- unknown aspects in direct service calls warn and do not start unexpected LSP requests
- `referencesLimit: 0` skips the references request and warns
- `referencesIncludeDeclaration: true` sends `context.includeDeclaration: true`
- `excludeExternal: true` returns `externalLocationsExcluded` and applies `referencesLimit` after external filtering
- `LocationLink` definition responses normalize through the same path as `Location`
- definition line before all indexed symbols keeps graph fallback target and warns
- selected-server metadata remains populated when startup is denied or fails
- unsupported configured language returns `lsp.status = "unsupported_language"`
- file position clamping falls back with a warning when disk content is missing but indexed content exists
- didOpen falls back to indexed content when disk read fails and skips live LSP with warning when content exceeds `MAX_DID_OPEN_BYTES`

Verification command:

```powershell
npx vitest run tests/lsp-symbol-context.test.ts tests/lsp-session-manager.test.ts
```

Expected result: all service and session-manager tests pass.

## Task 4: Wire Tool Handler And Privileged Action Gate

- [ ] Export the new module from [src/index.ts](C:/Users/Ivan/Documents/GitHub/wormhole/src/index.ts).

Add:

```ts
export * from "./lsp-symbol-context.js";
```

- [ ] Import the service into [src/tools.ts](C:/Users/Ivan/Documents/GitHub/wormhole/src/tools.ts).

Add:

```ts
import {
  createSymbolContext,
  type SymbolContextGraphStatus,
  type SymbolContextInput,
} from "./lsp-symbol-context.js";
```

- [ ] Add `symbolContext` to `createToolHandlers`.

Place it near `lspProbe`, `lspServerConfigs`, and `lspNormalizeLocation`. `getRepoIndex`, `repoRelativePath`, `diagnosticStore`, `lspSessionManager`, and `assertPrivilegedAction` are existing closures inside `createToolHandlers`, not new imports.

Add a safe index loader inside `createToolHandlers`:

```ts
function loadSymbolContextIndex(repoRoot: string): {
  index?: RepoIndex;
  graphStatus: SymbolContextGraphStatus;
  warnings: string[];
} {
  try {
    const index = getRepoIndex(repoRoot, preservedRepoIndexOptions(repoRoot));
    return {
      index,
      graphStatus: isRepoIndexFresh(index) ? (index.truncated ? "degraded" : "fresh") : "stale",
      warnings: isRepoIndexFresh(index) ? [] : ["Repo index fingerprint is stale for the current workspace state."],
    };
  } catch (error) {
    return {
      graphStatus: "missing",
      warnings: [`Unable to load repo index for symbol_context: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
```

Use that loader in the handler:

```ts
async symbolContext(input: SymbolContextInput) {
  const repoRoot = resolveAllowedRepoRoot(input.repoRoot, allowedRepoRoots);
  const configs = detectLanguageServerConfigs({ repoRoot });
  await lspSessionManager.stopIdle({ idleTimeoutMs: 10 * 60_000 });
  const diagnosticFile = input.file ? repoRelativePath(repoRoot, input.file) : undefined;
  const graphIndex = loadSymbolContextIndex(repoRoot);
  return await createSymbolContext(
    { ...input, repoRoot },
    {
      index: graphIndex.index,
      graphStatus: graphIndex.graphStatus,
      initialWarnings: graphIndex.warnings,
      diagnostics: diagnosticFile ? diagnosticStore.query({ file: diagnosticFile }).diagnostics : [],
      lsp: {
        configs,
        manager: lspSessionManager,
        async authorizeStart(config) {
          assertPrivilegedAction({
            toolName: "symbol_context",
            kind: "command",
            operations: [{ kind: "command", command: config.command, args: config.args }],
            target: { repoRoot, command: config.command, args: config.args },
          });
        },
      },
    },
  );
}
```

The service must call `authorizeStart(config)` only when a new live LSP session will be started. It must not authorize when returning graph-only context or when reusing a retained session.

Diagnostics handling:

- pass file-scoped diagnostics only when `input.file` is present
- map existing `DiagnosticRecord` severities into `SymbolContextDiagnostic`, converting `info` to `information`
- cap returned diagnostics to 50 records and add a warning if capped
- do not return all repo diagnostics for a symbol-only query in PR 1

- [ ] Add tool-handler tests.

Extend [tests/project-onboarding-tools.test.ts](C:/Users/Ivan/Documents/GitHub/wormhole/tests/project-onboarding-tools.test.ts) or add a focused `tests/symbol-context-tools.test.ts`.

Cover:

- allowed repo root is enforced
- graph-only call works in strict privileged mode when no LSP is configured
- graph-only call does not invoke the privileged action gate
- live LSP startup calls the privileged gate through `symbol_context`
- retained-session reuse does not call the privileged gate again
- strict mode blocks live startup unless approved
- index-load failure returns `graph.status = "missing"` and does not throw from the handler
- file-scoped diagnostics map `info` to `information`, cap at 50 records, and emit a cap warning

Verification command:

```powershell
npx vitest run tests/project-onboarding-tools.test.ts tests/symbol-context-tools.test.ts
```

Expected result: tool-layer tests pass, including strict privileged-action behavior.

## Task 5: Register MCP Schema And Tool Registry Metadata

- [ ] Add Zod schemas in [src/mcp-server.ts](C:/Users/Ivan/Documents/GitHub/wormhole/src/mcp-server.ts).

Add near the existing LSP schemas:

```ts
const symbolContextAspectSchema = z.enum(["definition", "hover", "references"]);
const symbolContextSessionModeSchema = z.enum(["reuse", "one_shot"]);
```

Register `symbol_context` immediately after `lsp_normalize_location` in MCP registration order:

```ts
server.registerTool(
  "symbol_context",
  {
    description:
      "Return compact repo symbol context by merging static graph facts with live TypeScript LSP definition, hover, and optional capped references. May start a bounded language-server process.",
    inputSchema: {
      repoRoot: z.string(),
      file: z.string().optional(),
      symbol: z.string().optional(),
      line: z.number().int().positive().optional(),
      character: z.number().int().positive().optional(),
      aspects: z.array(symbolContextAspectSchema).optional(),
      includeReferences: z.boolean().optional(),
      referencesLimit: z.number().int().nonnegative().optional(),
      referencesIncludeDeclaration: z.boolean().optional(),
      excludeExternal: z.boolean().optional(),
      sessionMode: symbolContextSessionModeSchema.optional(),
      startupTimeoutMs: z.number().int().positive().optional(),
      requestTimeoutMs: z.number().int().positive().optional(),
    },
  },
  async (input) => jsonResult(await tools.symbolContext(input)),
);
```

- [ ] Add `symbol_context` to `TOOL_NAMES` in [src/tool-registry.ts](C:/Users/Ivan/Documents/GitHub/wormhole/src/tool-registry.ts).

Insert it immediately after `lsp_normalize_location`, matching MCP registration order.

- [ ] Add an explicit registry override because `symbol_context` does not start with `lsp_`.

Add to `TOOL_OVERRIDES`:

```ts
symbol_context: {
  plane: "project",
  phase: "gather",
  pack: "large-repo",
  risk: "execute",
  summary: "Merge repo graph facts with live TypeScript LSP symbol definition, hover, and optional references.",
  inputs: ["repoRoot", "file", "symbol", "line", "character", "aspects", "includeReferences", "sessionMode"],
},
```

- [ ] Update MCP/registry tests.

In [tests/mcp-server.test.ts](C:/Users/Ivan/Documents/GitHub/wormhole/tests/mcp-server.test.ts), add `"symbol_context"` to the expected `arrayContaining`.

In [tests/tool-registry.test.ts](C:/Users/Ivan/Documents/GitHub/wormhole/tests/tool-registry.test.ts), add a metadata assertion:

```ts
expect(queryToolCatalog({ toolNames: ["symbol_context"] }).tools[0]).toEqual(
  expect.objectContaining({
    name: "symbol_context",
    plane: "project",
    phase: "gather",
    pack: "large-repo",
    risk: "execute",
  }),
);
```

Also assert admission requires preflight for live process risk:

```ts
expect(reviewToolAdmission({ toolNames: ["symbol_context"] }).approval).toBe("required");
```

Verification command:

```powershell
npx vitest run tests/mcp-server.test.ts tests/tool-registry.test.ts
```

Expected result: registry conformance, runtime MCP coverage, and registration-order tests pass.

## Task 6: End-To-End Verification

- [ ] Run the focused suite first.

```powershell
npx vitest run tests/lsp-session-manager.test.ts tests/lsp-symbol-context.test.ts tests/symbol-context-tools.test.ts tests/project-onboarding-tools.test.ts tests/mcp-server.test.ts tests/tool-registry.test.ts
```

Expected result: all focused tests pass, including existing raw `lsp_session_*` behavior and registry/MCP conformance.

- [ ] Run typecheck.

```powershell
npm run typecheck
```

Expected result: `tsc -p tsconfig.json --noEmit` exits with code 0.

- [ ] Run the full suite.

```powershell
npm test
```

Expected result: all Vitest test files pass. The total test count will increase from the current baseline because this plan adds session-manager, service, tool, MCP, and registry tests.

## Task 7: Review And Documentation Cleanup

- [ ] Update the design spec only if implementation discoveries change the contract.
- [ ] Add a short README or docs note only if the new MCP input/output shape is not obvious from `mcp-server.ts`; avoid duplicating the full result schema in multiple places.
- [ ] Review warnings and status strings for agent readability:
  - no silent arbitrary symbol choice
  - no silent external-location drops
  - no raw LSP protocol dumps in primary output
  - per-request status is visible for definition, hover, and references
- [ ] Confirm no durable graph or SQLite schema mutations were introduced in PR 1.

## Implementation Order

1. Harden `lsp-session-manager` and tests.
2. Build graph-only `lsp-symbol-context` and tests.
3. Add TypeScript LSP live path and fake-server tests.
4. Wire `tools.ts` with privileged action authorization.
5. Register MCP schema and registry metadata.
6. Run focused tests, typecheck, and full suite.

## Model Review Criteria

The plan is acceptable only if reviewers find no blockers or major issues in:

- LSP lifecycle correctness: initialize, initialized, didOpen, request sequence, optional close, session reuse.
- Timeout realism: startup default/cap and request default/cap are distinct and tested.
- Target correctness: LSP position is preferred when available; graph nearest-symbol fallback is explicitly degraded.
- Agent safety: process startup uses the privileged action gate only for new child processes, and registry risk is not mislabeled as read.
- Ownership cleanup: opened documents are closed in `finally`, one-shot sessions stop in `finally`, and idle cleanup skips busy sessions.
- Cost control: references are opt-in, capped, and truncation is visible.
- Degradation: unavailable/unsupported/timeout/failure modes return graph context instead of crashing.
- Testability: fake server tests cover ordering, truncation, external locations, timeouts, disconnects, and concurrency.
