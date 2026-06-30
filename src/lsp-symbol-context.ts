import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  LanguageServerConfig,
  LspProtocolLocation,
  NormalizedLspLocation,
} from "./lsp-ground-truth.js";
import { normalizeLspLocation } from "./lsp-ground-truth.js";
import type {
  createLspSessionManager,
  LspRequestResult,
  LspSessionInfo,
} from "./lsp-session-manager.js";
import type {
  RepoIndex,
  RepoIndexEdge,
  RepoIndexEdgeKind,
  RepoIndexEdgeProvenance,
  RepoIndexSymbol,
  RepoIndexSymbolKind,
} from "./repo-index.js";
import type { DiagnosticRecord } from "./diagnostics.js";

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

export type SymbolContextGraphStatus = "fresh" | "stale" | "missing" | "degraded" | "unknown";

export type SymbolContextRequestStatus =
  | "completed"
  | "partial"
  | "failed"
  | "timed_out"
  | "not_configured"
  | "not_requested"
  | "insufficient_target"
  | "unsupported_language"
  | "unsupported"
  | "unavailable"
  | "degraded";

export type SymbolContextLocation = {
  id?: string;
  name?: string;
  kind?: RepoIndexSymbolKind | string;
  path: string;
  line?: number;
  character?: number;
  external: boolean;
  source: "repo-index" | "lsp";
  confidence?: "exact" | "unique-symbol" | "position-nearest" | "lsp-definition";
  signature?: string;
  documentation?: string;
};

export type SymbolContextEdge = {
  from: string;
  to: string;
  kind: RepoIndexEdgeKind;
  provenance: RepoIndexEdgeProvenance;
  confidence: number;
  line?: number;
  label?: string;
  source: "repo-index";
};

export type SymbolContextEdgeList = {
  items: SymbolContextEdge[];
  totalCount: number;
  omittedCount: number;
  truncated: boolean;
};

export type SymbolContextDiagnostic = {
  diagnosticId?: string;
  source: string;
  severity: "error" | "warning" | "information" | "hint";
  message: string;
  path?: string;
  line?: number;
  character?: number;
  code?: string;
  recordedAt?: string;
};

export type SymbolContextLspDeps = {
  configs: LanguageServerConfig[];
  manager: ReturnType<typeof createLspSessionManager>;
  authorizeStart: (config: LanguageServerConfig) => void | Promise<void>;
};

export type SymbolContextHoverContent = {
  kind: "markdown" | "plaintext";
  value: string;
};

export type SymbolContextNearbySymbol = {
  name: string;
  kind: RepoIndexSymbolKind | string;
  path: string;
  line: number;
};

export type SymbolContextGraph = {
  status: SymbolContextGraphStatus;
  fingerprint: string;
  truncated: boolean;
  skippedFiles?: string[];
  inboundEdges: SymbolContextEdgeList;
  outboundEdges: SymbolContextEdgeList;
  nearbySymbols: SymbolContextNearbySymbol[];
};

export type SymbolContextQuery = {
  repoRoot: string;
  file?: string;
  fileExternal?: boolean;
  symbol?: string;
  line?: number;
  character?: number;
  aspects: SymbolContextAspect[];
  includeReferences?: boolean;
  referencesLimit?: number;
  referencesIncludeDeclaration?: boolean;
  excludeExternal?: boolean;
  sessionMode: "reuse" | "one_shot";
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
};

export type SymbolContextResult = {
  query: SymbolContextQuery;
  target?: SymbolContextLocation;
  candidates: SymbolContextLocation[];
  graph: SymbolContextGraph;
  lsp: SymbolContextLsp;
  warnings: string[];
};

export type SymbolContextLsp = {
  status: SymbolContextRequestStatus;
  sessionId?: string;
  server?: { language: string; command: string };
  definitionStatus: SymbolContextRequestStatus;
  hoverStatus: SymbolContextRequestStatus;
  referencesStatus: SymbolContextRequestStatus;
  definitionLocations: SymbolContextLocation[];
  referenceLocations: SymbolContextLocation[];
  referencesReturned: number;
  referencesTotalKnown?: number;
  referencesTruncated: boolean;
  externalLocationsExcluded?: number;
  hoverContents: SymbolContextHoverContent[];
  diagnostics: SymbolContextDiagnostic[];
};

type SymbolContextDeps = {
  index?: RepoIndex;
  graphStatus?: SymbolContextGraphStatus;
  initialWarnings?: string[];
  lsp?: SymbolContextLspDeps;
  diagnostics?: DiagnosticRecord[];
};

type NormalizedInput = SymbolContextInput & {
  repoRoot: string;
  file?: string;
  fileExternal?: boolean;
  aspects: SymbolContextAspect[];
  sessionMode: "reuse" | "one_shot";
};

type NumericInputField =
  | "line"
  | "character"
  | "referencesLimit"
  | "startupTimeoutMs"
  | "requestTimeoutMs";

const VALID_ASPECTS = new Set<SymbolContextAspect>(["definition", "hover", "references"]);
const EDGE_LIMIT = 50;
const DIAGNOSTIC_LIMIT = 50;
const MAX_SIGNATURE_LENGTH = 240;
const MAX_DOCUMENTATION_LINES = 12;
const MAX_DOCUMENTATION_LENGTH = 1_000;
const MAX_DID_OPEN_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_REFERENCES_LIMIT = 50;
const MAX_REFERENCES_LIMIT = 1_000;
const INSUFFICIENT_TARGET_WARNING =
  "symbol_context requires a file, symbol, or file + line + character target.";

export async function createSymbolContext(
  input: SymbolContextInput,
  deps: SymbolContextDeps,
): Promise<SymbolContextResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const warnings = [...(deps.initialWarnings ?? [])];
  const sanitizedInput = sanitizeInput(input, warnings);
  const aspects = normalizeAspects(sanitizedInput, warnings);
  const normalized = normalizeInput({ ...sanitizedInput, repoRoot, aspects });
  clampInputPosition(normalized, deps.index, warnings);
  const diagnostics = mapDiagnostics({
    repoRoot,
    diagnostics: deps.diagnostics ?? [],
    warnings,
  });
  if (deps.index?.truncated) {
    warnings.push("Repo index is truncated; graph facts may be incomplete.");
  }
  const graphStatus = graphStatusFor(deps.index, deps.graphStatus);
  const graphBase = {
    status: graphStatus,
    fingerprint: deps.index?.fingerprint ?? "",
    truncated: deps.index?.truncated ?? false,
    skippedFiles: deps.index && deps.index.skippedFiles.length > 0 ? [...deps.index.skippedFiles] : undefined,
  };

  if (hasInsufficientTarget(normalized)) {
    warnings.push(INSUFFICIENT_TARGET_WARNING);
    return {
      query: createQuery(normalized),
      candidates: [],
      graph: {
        ...graphBase,
        inboundEdges: emptyEdgeList(),
        outboundEdges: emptyEdgeList(),
        nearbySymbols: [],
      },
      lsp: lspWithStatus({
        lsp: emptyLspResult(diagnostics),
        input: normalized,
        status: "insufficient_target",
      }),
      warnings,
    };
  }

  const resolved = resolveGraphTarget({
    index: deps.index,
    input: normalized,
    warnings,
  });
  const targetLocation = resolved.target
    ? symbolToLocation(repoRoot, resolved.target, deps.index, resolved.confidence)
    : undefined;
  const candidateSymbols = candidateSymbolsForResult({
    index: deps.index,
    input: normalized,
    resolved,
  });
  const candidateLocations = candidateSymbols.map((candidate) =>
    symbolToLocation(repoRoot, candidate, deps.index),
  );
  const visibleLocations = filterExternalLocations({
    target: targetLocation,
    candidates: candidateLocations,
    excludeExternal: normalized.excludeExternal === true,
    warnings,
  });
  const live = await createLiveLspContext({
    repoRoot,
    input: normalized,
    index: deps.index,
    resolvedTarget: resolved.target,
    deps: deps.lsp,
    diagnostics,
    warnings,
  });
  const finalTargetSymbol = live.mappedTarget ?? (visibleLocations.target ? resolved.target : undefined);
  const finalTargetLocation = live.mappedTarget
    ? symbolToLocation(repoRoot, live.mappedTarget, deps.index, "lsp-definition")
    : visibleLocations.target;
  const graphFacts = createGraphFacts(deps.index, finalTargetSymbol);

  return {
    query: createQuery(normalized),
    target: finalTargetLocation,
    candidates: visibleLocations.candidates,
    graph: {
      ...graphBase,
      ...graphFacts,
    },
    lsp: live.lsp,
    warnings,
  };
}

type LiveTarget = {
  file: string;
  fileExternal: boolean;
  line: number;
  character: number;
};

type LiveDocument = {
  uri: string;
  languageId: string;
  text: string;
};

type LiveLspContextResult = {
  lsp: SymbolContextLsp;
  mappedTarget?: RepoIndexSymbol;
};

async function createLiveLspContext(input: {
  repoRoot: string;
  input: NormalizedInput;
  index: RepoIndex | undefined;
  resolvedTarget: RepoIndexSymbol | undefined;
  deps: SymbolContextLspDeps | undefined;
  diagnostics: SymbolContextDiagnostic[];
  warnings: string[];
}): Promise<LiveLspContextResult> {
  const lsp = emptyLspResult(input.diagnostics);
  if (input.input.aspects.length === 0) {
    lsp.status = "not_requested";
    return { lsp };
  }

  if (!input.deps || input.deps.configs.length === 0) {
    return {
      lsp: lspWithStatus({ lsp, input: input.input, status: "not_configured" }),
    };
  }

  const config = input.deps.configs.find((candidate) => candidate.language === "typescript");
  if (!config) {
    return {
      lsp: lspWithStatus({ lsp, input: input.input, status: "unsupported_language" }),
    };
  }
  lsp.server = { language: config.language, command: config.command };

  const target = liveTargetFor({
    repoRoot: input.repoRoot,
    input: input.input,
    resolvedTarget: input.resolvedTarget,
    warnings: input.warnings,
  });
  if (!target || !isTypeScriptLiveFile(target.file)) {
    return {
      lsp: lspWithStatus({ lsp, input: input.input, status: "unsupported_language" }),
    };
  }
  if (target.fileExternal) {
    input.warnings.push("External file targets are not live-opened for TypeScript LSP enrichment in PR1.");
    return {
      lsp: lspWithStatus({ lsp, input: input.input, status: "unsupported_language" }),
    };
  }

  const document = readLiveDocument({
    repoRoot: input.repoRoot,
    target,
    index: input.index,
    warnings: input.warnings,
  });
  if (!document) {
    return {
      lsp: lspWithStatus({ lsp, input: input.input, status: "failed" }),
    };
  }

  const requestTimeoutMs = clampRequestTimeout(input.input.requestTimeoutMs);
  let sessionId: string | undefined;
  let release: (() => void) | undefined;
  let oneShotSession = false;

  try {
    let createdByThisCall = false;
    if (input.input.sessionMode === "one_shot") {
      try {
        await input.deps.authorizeStart(config);
      } catch (error) {
        input.warnings.push(`LSP start was not authorized: ${errorMessage(error)}`);
        return {
          lsp: lspWithStatus({ lsp, input: input.input, status: "failed" }),
        };
      }
      const started = await input.deps.manager.start({
        repoRoot: input.repoRoot,
        language: oneShotLanguageKey(config.language),
        command: config.command,
        args: config.args,
        startupTimeoutMs: input.input.startupTimeoutMs,
      });
      sessionId = started.sessionId;
      lsp.sessionId = sessionId;
      oneShotSession = started.status === "running";
      if (started.status !== "running") {
        return {
          lsp: lspWithStatus({
            lsp,
            input: input.input,
            status: lspStatusFromSession(started),
          }),
        };
      }
    } else {
      const acquired = await input.deps.manager.getOrStart({
        repoRoot: input.repoRoot,
        language: config.language,
        command: config.command,
        args: config.args,
        startupTimeoutMs: input.input.startupTimeoutMs,
        beforeStart: () => input.deps?.authorizeStart(config),
      });
      release = acquired.release;
      createdByThisCall = acquired.createdByThisCall;
      sessionId = acquired.info.sessionId;
      lsp.sessionId = sessionId;
      if (acquired.info.status !== "running") {
        if (acquired.info.error) {
          input.warnings.push(`LSP startup failed: ${acquired.info.error}`);
        }
        return {
          lsp: lspWithStatus({
            lsp,
            input: input.input,
            status: lspStatusFromSession(acquired.info),
          }),
        };
      }
    }

    const operation = await input.deps.manager.runExclusive({
      sessionId,
      operation: async () =>
        runLiveLspOperation({
          repoRoot: input.repoRoot,
          input: input.input,
          index: input.index,
          manager: input.deps!.manager,
          sessionId: sessionId!,
          lsp,
          document,
          target,
          requestTimeoutMs,
          createdByThisCall,
          warnings: input.warnings,
        }),
    });
    return operation;
  } catch (error) {
    input.warnings.push(`LSP live enrichment failed: ${errorMessage(error)}`);
    return {
      lsp: lspWithStatus({ lsp, input: input.input, status: "failed" }),
    };
  } finally {
    release?.();
    if (oneShotSession && sessionId) {
      await gracefulShutdownOneShot({
        manager: input.deps.manager,
        sessionId,
        timeoutMs: requestTimeoutMs,
        warnings: input.warnings,
      });
    }
  }
}

async function runLiveLspOperation(input: {
  repoRoot: string;
  input: NormalizedInput;
  index: RepoIndex | undefined;
  manager: ReturnType<typeof createLspSessionManager>;
  sessionId: string;
  lsp: SymbolContextLsp;
  document: LiveDocument;
  target: LiveTarget;
  requestTimeoutMs: number;
  createdByThisCall: boolean;
  warnings: string[];
}): Promise<LiveLspContextResult> {
  const initialized = await ensureInitialized({
    repoRoot: input.repoRoot,
    manager: input.manager,
    sessionId: input.sessionId,
    timeoutMs: input.requestTimeoutMs,
    warnings: input.warnings,
  });
  if (!initialized.ok) {
    if (input.input.sessionMode === "reuse" && input.createdByThisCall) {
      await input.manager.stop({ sessionId: input.sessionId, force: true });
    }
    return {
      lsp: lspWithStatus({ lsp: input.lsp, input: input.input, status: "failed" }),
    };
  }

  const openedDocument = await input.manager.ensureDocumentOpen({
    sessionId: input.sessionId,
    uri: input.document.uri,
    languageId: input.document.languageId,
    version: 1,
    text: input.document.text,
  });
  if (openedDocument.status !== "sent") {
    input.warnings.push(`LSP didOpen failed: ${openedDocument.error ?? "unknown error"}`);
    return {
      lsp: lspWithStatus({ lsp: input.lsp, input: input.input, status: "failed" }),
    };
  }

  try {
    let mappedTarget: RepoIndexSymbol | undefined;
    if (input.input.aspects.includes("definition")) {
      const definition = await requestDefinition({
        repoRoot: input.repoRoot,
        input: input.input,
        index: input.index,
        manager: input.manager,
        sessionId: input.sessionId,
        uri: input.document.uri,
        target: input.target,
        timeoutMs: input.requestTimeoutMs,
        warnings: input.warnings,
      });
      input.lsp.definitionStatus = definition.status;
      input.lsp.definitionLocations = definition.locations;
      mappedTarget = definition.mappedTarget;
    }

    if (input.input.aspects.includes("hover")) {
      const hover = await requestHover({
        manager: input.manager,
        sessionId: input.sessionId,
        uri: input.document.uri,
        target: input.target,
        timeoutMs: input.requestTimeoutMs,
        warnings: input.warnings,
      });
      input.lsp.hoverStatus = hover.status;
      input.lsp.hoverContents = hover.contents;
    }

    if (referencesRequested(input.input)) {
      const references = await requestReferences({
        repoRoot: input.repoRoot,
        input: input.input,
        manager: input.manager,
        sessionId: input.sessionId,
        uri: input.document.uri,
        target: input.target,
        timeoutMs: input.requestTimeoutMs,
        warnings: input.warnings,
      });
      input.lsp.referencesStatus = references.status;
      input.lsp.referenceLocations = references.locations;
      input.lsp.referencesReturned = references.returned;
      input.lsp.referencesTotalKnown = references.totalKnown;
      input.lsp.referencesTruncated = references.truncated;
      input.lsp.externalLocationsExcluded = references.externalExcluded;
    }

    input.lsp.status = aggregateLspStatus(input.lsp, input.input);
    return { lsp: input.lsp, mappedTarget };
  } finally {
    if (openedDocument.openedByThisCall) {
      const closed = await input.manager.closeDocument({
        sessionId: input.sessionId,
        uri: input.document.uri,
      });
      if (closed.status !== "sent") {
        input.warnings.push(`LSP didClose failed: ${closed.error ?? "unknown error"}`);
      }
    }
  }
}

function emptyLspResult(diagnostics: SymbolContextDiagnostic[]): SymbolContextLsp {
  return {
    status: "not_requested",
    definitionStatus: "not_requested",
    hoverStatus: "not_requested",
    referencesStatus: "not_requested",
    definitionLocations: [],
    referenceLocations: [],
    referencesReturned: 0,
    referencesTruncated: false,
    hoverContents: [],
    diagnostics,
  };
}

function lspWithStatus(input: {
  lsp: SymbolContextLsp;
  input: NormalizedInput;
  status: SymbolContextRequestStatus;
}): SymbolContextLsp {
  input.lsp.status = input.status;
  if (input.input.aspects.includes("definition")) {
    input.lsp.definitionStatus = input.status;
  }
  if (input.input.aspects.includes("hover")) {
    input.lsp.hoverStatus = input.status;
  }
  if (referencesRequested(input.input)) {
    input.lsp.referencesStatus = input.status;
  }
  return input.lsp;
}

function aggregateLspStatus(
  lsp: SymbolContextLsp,
  input: NormalizedInput,
): SymbolContextRequestStatus {
  const statuses: SymbolContextRequestStatus[] = [];
  if (input.aspects.includes("definition")) {
    statuses.push(lsp.definitionStatus);
  }
  if (input.aspects.includes("hover")) {
    statuses.push(lsp.hoverStatus);
  }
  if (referencesRequested(input)) {
    statuses.push(lsp.referencesStatus);
  }
  if (statuses.length === 0 || statuses.every((status) => status === "not_requested")) {
    return "not_requested";
  }
  if (statuses.every((status) => status === "completed" || status === "not_requested")) {
    return "completed";
  }
  if (
    statuses.some((status) => status === "completed") &&
    statuses.some((status) => status !== "completed" && status !== "not_requested")
  ) {
    return "partial";
  }
  if (statuses.some((status) => status === "timed_out")) {
    return "timed_out";
  }
  if (statuses.some((status) => status === "failed")) {
    return "failed";
  }
  if (statuses.some((status) => status === "unsupported")) {
    return "degraded";
  }
  return statuses[0] ?? "degraded";
}

function referencesRequested(input: NormalizedInput): boolean {
  return input.includeReferences === true || input.aspects.includes("references");
}

function lspStatusFromSession(info: LspSessionInfo): SymbolContextRequestStatus {
  return info.status === "unavailable" ? "unavailable" : "failed";
}

function liveTargetFor(input: {
  repoRoot: string;
  input: NormalizedInput;
  resolvedTarget: RepoIndexSymbol | undefined;
  warnings: string[];
}): LiveTarget | undefined {
  if (
    input.input.file !== undefined &&
    input.input.line !== undefined &&
    input.input.character !== undefined
  ) {
    return {
      file: input.input.file,
      fileExternal: input.input.fileExternal === true,
      line: input.input.line,
      character: input.input.character,
    };
  }
  if (input.resolvedTarget && input.resolvedTarget.line > 0) {
    const normalized = toRepoRelativeLocationPath(input.repoRoot, input.resolvedTarget.path);
    input.warnings.push(
      "Live LSP position used the graph target line with character 1 because no explicit character was supplied.",
    );
    return {
      file: normalized.path,
      fileExternal: normalized.external,
      line: input.resolvedTarget.line,
      character: 1,
    };
  }
  return undefined;
}

function isTypeScriptLiveFile(filePath: string): boolean {
  return new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]).has(
    path.extname(filePath).toLowerCase(),
  );
}

function readLiveDocument(input: {
  repoRoot: string;
  target: LiveTarget;
  index: RepoIndex | undefined;
  warnings: string[];
}): LiveDocument | undefined {
  const absolutePath = absolutePathForLiveTarget(input.repoRoot, input.target);
  let text: string | undefined;
  try {
    text = normalizeLineEndings(readFileSync(absolutePath, "utf8"));
  } catch {
    const indexedContent = findIndexedFile(input.index, input.target.file)?.content;
    if (indexedContent !== undefined) {
      input.warnings.push("Unable to read current file content; indexed content was used for live LSP didOpen.");
      text = normalizeLineEndings(indexedContent);
    } else {
      input.warnings.push("Unable to read current file content for live LSP didOpen.");
      return undefined;
    }
  }

  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > MAX_DID_OPEN_BYTES) {
    input.warnings.push(
      `Document text is ${byteLength} bytes and exceeds the live LSP didOpen limit of ${MAX_DID_OPEN_BYTES} bytes.`,
    );
    return undefined;
  }

  const languageId = languageIdForLiveFile(input.target.file);
  if (!languageId) {
    return undefined;
  }
  return {
    uri: pathToFileURL(absolutePath).href,
    languageId,
    text,
  };
}

function absolutePathForLiveTarget(repoRoot: string, target: LiveTarget): string {
  return target.fileExternal ? path.resolve(target.file) : path.resolve(repoRoot, target.file);
}

function languageIdForLiveFile(filePath: string): string | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    default:
      return undefined;
  }
}

async function ensureInitialized(input: {
  repoRoot: string;
  manager: ReturnType<typeof createLspSessionManager>;
  sessionId: string;
  timeoutMs: number;
  warnings: string[];
}): Promise<{ ok: boolean }> {
  const current = input.manager.status({ sessionId: input.sessionId });
  if (current?.initialized) {
    return { ok: true };
  }

  const rootUri = pathToFileURL(input.repoRoot).href;
  const initialize = await input.manager.request({
    sessionId: input.sessionId,
    method: "initialize",
    params: {
      processId: process.pid,
      rootUri,
      capabilities: {},
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(input.repoRoot) || rootUri,
        },
      ],
    },
    timeoutMs: input.timeoutMs,
  });
  if (initialize.status !== "completed") {
    input.warnings.push(`LSP initialize request ${initialize.status}: ${initialize.error ?? "unknown error"}`);
    return { ok: false };
  }
  if (initialize.response?.error) {
    input.warnings.push(`LSP initialize request failed: ${JSON.stringify(initialize.response.error)}`);
    return { ok: false };
  }
  if (!isRecord(initialize.response?.result)) {
    input.warnings.push("LSP initialize response was malformed.");
    return { ok: false };
  }

  const initialized = await input.manager.notify({
    sessionId: input.sessionId,
    method: "initialized",
    params: {},
  });
  if (initialized.status !== "sent") {
    input.warnings.push(`LSP initialized notification failed: ${initialized.error ?? "unknown error"}`);
    return { ok: false };
  }
  input.manager.markInitialized({
    sessionId: input.sessionId,
    serverCapabilities: initialize.response.result.capabilities,
  });
  return { ok: true };
}

async function requestDefinition(input: {
  repoRoot: string;
  input: NormalizedInput;
  index: RepoIndex | undefined;
  manager: ReturnType<typeof createLspSessionManager>;
  sessionId: string;
  uri: string;
  target: LiveTarget;
  timeoutMs: number;
  warnings: string[];
}): Promise<{
  status: SymbolContextRequestStatus;
  locations: SymbolContextLocation[];
  mappedTarget?: RepoIndexSymbol;
}> {
  const response = await input.manager.request({
    sessionId: input.sessionId,
    method: "textDocument/definition",
    params: textDocumentPositionParams(input.uri, input.target),
    timeoutMs: input.timeoutMs,
  });
  const failed = requestFailureStatus("definition", response, input.warnings);
  if (failed) {
    return { status: failed, locations: [] };
  }
  try {
    const allLocations = parseLspLocations(input.repoRoot, response.response?.result);
    const locations = filterExternalDefinitions({
      locations: allLocations,
      excludeExternal: input.input.excludeExternal === true,
      warnings: input.warnings,
    });
    const mappedTarget = mapDefinitionTarget({
      index: input.index,
      locations,
      warnings: input.warnings,
    });
    return { status: "completed", locations, mappedTarget };
  } catch (error) {
    input.warnings.push(`Malformed LSP definition response: ${errorMessage(error)}`);
    return { status: "failed", locations: [] };
  }
}

async function requestHover(input: {
  manager: ReturnType<typeof createLspSessionManager>;
  sessionId: string;
  uri: string;
  target: LiveTarget;
  timeoutMs: number;
  warnings: string[];
}): Promise<{
  status: SymbolContextRequestStatus;
  contents: SymbolContextHoverContent[];
}> {
  const response = await input.manager.request({
    sessionId: input.sessionId,
    method: "textDocument/hover",
    params: textDocumentPositionParams(input.uri, input.target),
    timeoutMs: input.timeoutMs,
  });
  const failed = requestFailureStatus("hover", response, input.warnings);
  if (failed) {
    return { status: failed, contents: [] };
  }
  try {
    return {
      status: "completed",
      contents: parseHoverResponse(response.response?.result),
    };
  } catch (error) {
    input.warnings.push(`Malformed LSP hover response: ${errorMessage(error)}`);
    return { status: "failed", contents: [] };
  }
}

async function requestReferences(input: {
  repoRoot: string;
  input: NormalizedInput;
  manager: ReturnType<typeof createLspSessionManager>;
  sessionId: string;
  uri: string;
  target: LiveTarget;
  timeoutMs: number;
  warnings: string[];
}): Promise<{
  status: SymbolContextRequestStatus;
  locations: SymbolContextLocation[];
  returned: number;
  totalKnown?: number;
  truncated: boolean;
  externalExcluded?: number;
}> {
  const limit = clampReferencesLimit(input.input.referencesLimit);
  if (limit === 0) {
    input.warnings.push("referencesLimit is 0; skipped LSP references request.");
    return {
      status: "not_requested",
      locations: [],
      returned: 0,
      totalKnown: 0,
      truncated: false,
    };
  }

  const capabilities = input.manager.status({ sessionId: input.sessionId })?.serverCapabilities;
  if (!hasReferencesProvider(capabilities)) {
    input.warnings.push("LSP server does not advertise referencesProvider; references were skipped.");
    return {
      status: "unsupported",
      locations: [],
      returned: 0,
      truncated: false,
    };
  }

  const response = await input.manager.request({
    sessionId: input.sessionId,
    method: "textDocument/references",
    params: {
      ...textDocumentPositionParams(input.uri, input.target),
      context: {
        includeDeclaration: input.input.referencesIncludeDeclaration === true,
      },
    },
    timeoutMs: input.timeoutMs,
  });
  const failed = requestFailureStatus("references", response, input.warnings);
  if (failed) {
    return {
      status: failed,
      locations: [],
      returned: 0,
      truncated: false,
    };
  }

  try {
    const locations = parseLspLocations(input.repoRoot, response.response?.result);
    const externalCount = locations.filter((location) => location.external).length;
    let filtered = locations;
    let externalExcluded: number | undefined;
    if (input.input.excludeExternal === true && externalCount > 0) {
      filtered = locations.filter((location) => !location.external);
      externalExcluded = externalCount;
      input.warnings.push(
        `Excluded ${externalCount} external LSP reference${externalCount === 1 ? "" : "s"} because excludeExternal is true.`,
      );
    }
    const totalKnown = filtered.length;
    const returnedLocations = filtered.slice(0, limit);
    return {
      status: "completed",
      locations: returnedLocations,
      returned: returnedLocations.length,
      totalKnown,
      truncated: totalKnown > returnedLocations.length,
      externalExcluded,
    };
  } catch (error) {
    input.warnings.push(`Malformed LSP references response: ${errorMessage(error)}`);
    return {
      status: "failed",
      locations: [],
      returned: 0,
      truncated: false,
    };
  }
}

function requestFailureStatus(
  label: string,
  response: LspRequestResult,
  warnings: string[],
): SymbolContextRequestStatus | undefined {
  if (response.status === "timed_out") {
    warnings.push(`LSP ${label} request timed out: ${response.error ?? "unknown error"}`);
    return "timed_out";
  }
  if (response.status === "failed") {
    warnings.push(`LSP ${label} request failed: ${response.error ?? "unknown error"}`);
    return "failed";
  }
  if (response.response?.error) {
    warnings.push(`LSP ${label} request failed: ${JSON.stringify(response.response.error)}`);
    return "failed";
  }
  return undefined;
}

function textDocumentPositionParams(uri: string, target: LiveTarget): {
  textDocument: { uri: string };
  position: { line: number; character: number };
} {
  return {
    textDocument: { uri },
    position: {
      line: target.line - 1,
      character: target.character - 1,
    },
  };
}

function parseLspLocations(repoRoot: string, value: unknown): SymbolContextLocation[] {
  if (value === null || value === undefined) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => lspProtocolLocationToContext(repoRoot, protocolLocationFromUnknown(entry)));
}

function filterExternalDefinitions(input: {
  locations: SymbolContextLocation[];
  excludeExternal: boolean;
  warnings: string[];
}): SymbolContextLocation[] {
  if (!input.excludeExternal) {
    return input.locations;
  }
  const externalCount = input.locations.filter((location) => location.external).length;
  if (externalCount > 0) {
    input.warnings.push(
      `Excluded ${externalCount} external LSP definition${externalCount === 1 ? "" : "s"} because excludeExternal is true.`,
    );
  }
  return input.locations.filter((location) => !location.external);
}

function protocolLocationFromUnknown(value: unknown): LspProtocolLocation {
  if (isProtocolLocation(value)) {
    return value;
  }
  if (isLocationLink(value)) {
    return {
      uri: value.targetUri,
      range: value.targetSelectionRange ?? value.targetRange,
    };
  }
  throw new Error("expected Location or LocationLink");
}

function lspProtocolLocationToContext(
  repoRoot: string,
  location: LspProtocolLocation,
): SymbolContextLocation {
  const normalized = normalizeLspLocation(location);
  return normalizedLspLocationToContext(repoRoot, normalized);
}

function normalizedLspLocationToContext(
  repoRoot: string,
  location: NormalizedLspLocation,
): SymbolContextLocation {
  const normalizedPath = toRepoRelativeLocationPath(repoRoot, location.file);
  return {
    path: normalizedPath.path,
    line: location.line,
    character: location.column,
    external: normalizedPath.external,
    source: "lsp",
  };
}

function mapDefinitionTarget(input: {
  index: RepoIndex | undefined;
  locations: SymbolContextLocation[];
  warnings: string[];
}): RepoIndexSymbol | undefined {
  const internalDefinition = input.locations.find((location) => !location.external);
  if (!internalDefinition) {
    return undefined;
  }
  if (!input.index || internalDefinition.line === undefined) {
    input.warnings.push("Unable to map LSP definition to an indexed symbol; keeping repo graph target.");
    return undefined;
  }
  const fileSymbols = input.index.symbols
    .filter((symbol) => samePath(symbol.path, internalDefinition.path))
    .sort(byPathThenLineThenName);
  const exact = fileSymbols.find((symbol) => symbol.line === internalDefinition.line);
  if (exact) {
    return exact;
  }
  const nearest = [...fileSymbols]
    .filter((symbol) => symbol.line <= internalDefinition.line!)
    .sort((left, right) => right.line - left.line || left.name.localeCompare(right.name))[0];
  if (nearest) {
    return nearest;
  }
  input.warnings.push("Unable to map LSP definition to an indexed symbol; keeping repo graph target.");
  return undefined;
}

function parseHoverResponse(value: unknown): SymbolContextHoverContent[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (isRecord(value) && "contents" in value) {
    return parseHoverContents(value.contents);
  }
  return parseHoverContents(value);
}

function parseHoverContents(value: unknown): SymbolContextHoverContent[] {
  if (typeof value === "string") {
    return compactHoverText(value, "plaintext");
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseHoverContents(entry));
  }
  if (isRecord(value)) {
    if (typeof value.kind === "string" && typeof value.value === "string") {
      if (value.kind !== "markdown" && value.kind !== "plaintext") {
        throw new Error("unknown MarkupContent kind");
      }
      return compactHoverText(value.value, value.kind);
    }
    if (typeof value.language === "string" && typeof value.value === "string") {
      const language = value.language.trim();
      const content = normalizeLineEndings(value.value).trim();
      if (!content) {
        return [];
      }
      return [
        {
          kind: "markdown",
          value: language ? `\`\`\`${language}\n${content}\n\`\`\`` : content,
        },
      ];
    }
  }
  throw new Error("expected Hover, MarkupContent, MarkedString, or string");
}

function compactHoverText(
  value: string,
  kind: "markdown" | "plaintext",
): SymbolContextHoverContent[] {
  const compact = normalizeLineEndings(value).trim();
  return compact.length > 0 ? [{ kind, value: compact }] : [];
}

function hasReferencesProvider(capabilities: unknown): boolean {
  if (!isRecord(capabilities)) {
    return false;
  }
  return capabilities.referencesProvider !== undefined && capabilities.referencesProvider !== false;
}

async function gracefulShutdownOneShot(input: {
  manager: ReturnType<typeof createLspSessionManager>;
  sessionId: string;
  timeoutMs: number;
  warnings: string[];
}): Promise<void> {
  const shutdown = await input.manager.request({
    sessionId: input.sessionId,
    method: "shutdown",
    params: null,
    timeoutMs: input.timeoutMs,
  });
  if (shutdown.status !== "completed") {
    input.warnings.push(`LSP shutdown request ${shutdown.status}: ${shutdown.error ?? "unknown error"}`);
  }
  const exited = await input.manager.notify({
    sessionId: input.sessionId,
    method: "exit",
    params: {},
  });
  if (exited.status !== "sent") {
    input.warnings.push(`LSP exit notification failed: ${exited.error ?? "unknown error"}`);
  }
  await waitForSessionToExit(input.manager, input.sessionId, 50);
  if (input.manager.status({ sessionId: input.sessionId })) {
    await input.manager.stop({ sessionId: input.sessionId, force: true });
  }
}

async function waitForSessionToExit(
  manager: ReturnType<typeof createLspSessionManager>,
  sessionId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!manager.status({ sessionId })) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function isProtocolLocation(value: unknown): value is LspProtocolLocation {
  return (
    isRecord(value) &&
    typeof value.uri === "string" &&
    isRange(value.range)
  );
}

function isLocationLink(value: unknown): value is {
  targetUri: string;
  targetRange: LspProtocolLocation["range"];
  targetSelectionRange?: LspProtocolLocation["range"];
} {
  return (
    isRecord(value) &&
    typeof value.targetUri === "string" &&
    isRange(value.targetRange) &&
    (value.targetSelectionRange === undefined || isRange(value.targetSelectionRange))
  );
}

function isRange(value: unknown): value is LspProtocolLocation["range"] {
  return (
    isRecord(value) &&
    isPosition(value.start) &&
    isPosition(value.end)
  );
}

function isPosition(value: unknown): value is { line: number; character: number } {
  return (
    isRecord(value) &&
    typeof value.line === "number" &&
    Number.isFinite(value.line) &&
    Number.isInteger(value.line) &&
    value.line >= 0 &&
    typeof value.character === "number" &&
    Number.isFinite(value.character) &&
    Number.isInteger(value.character) &&
    value.character >= 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampRequestTimeout(value: number | undefined): number {
  const requested = value ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.max(1, Math.min(requested, MAX_REQUEST_TIMEOUT_MS));
}

function clampReferencesLimit(value: number | undefined): number {
  const requested = value ?? DEFAULT_REFERENCES_LIMIT;
  return Math.max(0, Math.min(requested, MAX_REFERENCES_LIMIT));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function oneShotLanguageKey(language: string): string {
  return `${language}:one_shot:${randomUUID()}`;
}

function normalizeInput(input: SymbolContextInput & {
  repoRoot: string;
  aspects: SymbolContextAspect[];
}): NormalizedInput {
  const normalizedFile =
    input.file === undefined ? undefined : toRepoRelativeLocationPath(input.repoRoot, input.file);
  return {
    ...input,
    file: normalizedFile?.path,
    fileExternal: normalizedFile?.external,
    sessionMode: input.sessionMode ?? "reuse",
  };
}

function normalizeAspects(input: SymbolContextInput, warnings: string[]): SymbolContextAspect[] {
  const rawAspects = (input as { aspects?: unknown }).aspects;
  const requested =
    rawAspects === undefined
      ? ["definition", "hover"]
      : Array.isArray(rawAspects)
        ? rawAspects
        : undefined;
  if (!requested) {
    warnings.push("Invalid symbol_context aspects; using default definition and hover.");
    return ["definition", "hover"];
  }
  const aspects: SymbolContextAspect[] = [];
  for (const aspect of requested) {
    if (typeof aspect !== "string") {
      warnings.push("Non-string symbol_context aspect ignored.");
      continue;
    }
    if (VALID_ASPECTS.has(aspect as SymbolContextAspect)) {
      const known = aspect as SymbolContextAspect;
      if (!aspects.includes(known)) {
        aspects.push(known);
      }
      continue;
    }
    warnings.push(`Unknown symbol_context aspect ignored: ${String(aspect)}`);
  }
  if (input.includeReferences && !aspects.includes("references")) {
    aspects.push("references");
  }
  if (aspects.length === 0 && requested.length > 0) {
    warnings.push("No valid symbol_context aspects were supplied; no live LSP aspects were requested.");
    return [];
  }
  return aspects;
}

function createQuery(input: NormalizedInput): SymbolContextQuery {
  return {
    repoRoot: input.repoRoot,
    file: input.file,
    fileExternal: input.file === undefined ? undefined : input.fileExternal ?? false,
    symbol: input.symbol,
    line: input.line,
    character: input.character,
    aspects: input.aspects,
    includeReferences: input.includeReferences,
    referencesLimit: input.referencesLimit,
    referencesIncludeDeclaration: input.referencesIncludeDeclaration,
    excludeExternal: input.excludeExternal,
    sessionMode: input.sessionMode,
    startupTimeoutMs: input.startupTimeoutMs,
    requestTimeoutMs: input.requestTimeoutMs,
  };
}

function sanitizeInput(input: SymbolContextInput, warnings: string[]): SymbolContextInput {
  const sanitized = { ...input };
  for (const field of [
    "line",
    "character",
    "referencesLimit",
    "startupTimeoutMs",
    "requestTimeoutMs",
  ] satisfies NumericInputField[]) {
    const value = (input as Record<NumericInputField, unknown>)[field];
    if (value === undefined) {
      continue;
    }
    if (!isValidNumericField(field, value)) {
      warnings.push(`Invalid numeric symbol_context field ${field} ignored.`);
      delete sanitized[field];
    }
  }
  return sanitized;
}

function isValidNumericField(field: NumericInputField, value: unknown): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return false;
  }
  if (field === "referencesLimit") {
    return value >= 0;
  }
  return value > 0;
}

function hasInsufficientTarget(input: NormalizedInput): boolean {
  if ((input.line !== undefined || input.character !== undefined) && input.file === undefined) {
    return true;
  }
  return input.file === undefined && input.symbol === undefined;
}

function graphStatusFor(
  index: RepoIndex | undefined,
  status: SymbolContextGraphStatus | undefined,
): SymbolContextGraphStatus {
  if (status) {
    return status;
  }
  if (!index) {
    return "missing";
  }
  return "fresh";
}

function clampInputPosition(
  input: NormalizedInput,
  index: RepoIndex | undefined,
  warnings: string[],
): void {
  if (input.file === undefined || input.line === undefined || input.character === undefined) {
    return;
  }

  const content = readFileContentForClamping({
    repoRoot: input.repoRoot,
    file: input.file,
    fileExternal: input.fileExternal === true,
    index,
    warnings,
  });
  if (content === undefined) {
    return;
  }
  const clamped = clampOneBasedPosition({
    line: input.line,
    character: input.character,
    content,
  });
  if (!clamped.clamped) {
    return;
  }
  input.line = clamped.line;
  input.character = clamped.character;
  warnings.push(`Requested file position was clamped to line ${clamped.line}, character ${clamped.character}.`);
}

function readFileContentForClamping(input: {
  repoRoot: string;
  file: string;
  fileExternal: boolean;
  index: RepoIndex | undefined;
  warnings: string[];
}): string | undefined {
  if (input.fileExternal) {
    const indexedContent = findIndexedFile(input.index, input.file)?.content;
    if (indexedContent !== undefined) {
      input.warnings.push("External file target used indexed content for position clamping.");
      return normalizeLineEndings(indexedContent);
    }
    input.warnings.push("External file target skipped disk read for position clamping.");
    return undefined;
  }
  try {
    return normalizeLineEndings(readFileSync(path.resolve(input.repoRoot, input.file), "utf8"));
  } catch {
    const indexedContent = findIndexedFile(input.index, input.file)?.content;
    if (indexedContent !== undefined) {
      input.warnings.push("Unable to read current file content; indexed content was used for position clamping.");
      return normalizeLineEndings(indexedContent);
    }
    input.warnings.push("Unable to read current file content for position clamping.");
    return undefined;
  }
}

function clampOneBasedPosition(input: {
  line: number;
  character: number;
  content: string;
}): { line: number; character: number; clamped: boolean } {
  const lines = input.content.split("\n");
  const line = Math.max(1, Math.min(input.line, Math.max(1, lines.length)));
  const lineText = lines[line - 1] ?? "";
  const character = Math.max(1, Math.min(input.character, lineText.length + 1));
  return {
    line,
    character,
    clamped: line !== input.line || character !== input.character,
  };
}

function resolveGraphTarget(input: {
  index: RepoIndex | undefined;
  input: NormalizedInput;
  warnings: string[];
}): {
  target?: RepoIndexSymbol;
  confidence?: NonNullable<SymbolContextLocation["confidence"]>;
  candidates: RepoIndexSymbol[];
} {
  const index = input.index;
  if (!index) {
    return { candidates: [] };
  }
  const file = input.input.file;
  const symbol = input.input.symbol;
  const line = input.input.line;

  if (file && symbol) {
    const exactMatches = index.symbols
      .filter((candidate) => samePath(candidate.path, file) && candidate.name === symbol)
      .sort(byPathThenLineThenName);
    if (exactMatches.length > 0) {
      return {
        target: exactMatches[0],
        confidence: "exact",
        candidates: exactMatches,
      };
    }
    return { candidates: fallbackCandidates(index, { file, symbol }) };
  }

  if (file && line !== undefined) {
    const fileSymbols = index.symbols
      .filter((candidate) => samePath(candidate.path, file))
      .sort(byPathThenLineThenName);
    const nearest = [...fileSymbols]
      .filter((candidate) => candidate.line <= line)
      .sort((left, right) => right.line - left.line || left.name.localeCompare(right.name))[0];
    if (nearest) {
      input.warnings.push(
        "Repo graph symbols do not have end ranges; file position resolved to the nearest preceding symbol.",
      );
      return {
        target: nearest,
        confidence: "position-nearest",
        candidates: [nearest],
      };
    }
    return { candidates: fileSymbols };
  }

  if (symbol) {
    const exactMatches = index.symbols
      .filter((candidate) => candidate.name === symbol)
      .sort(byPathThenLineThenName);
    return {
      target: exactMatches.length === 1 ? exactMatches[0] : undefined,
      confidence: exactMatches.length === 1 ? "unique-symbol" : undefined,
      candidates: exactMatches,
    };
  }

  if (file) {
    return {
      candidates: index.symbols
        .filter((candidate) => candidate.path === file)
        .sort(byPathThenLineThenName),
    };
  }

  return { candidates: [] };
}

function fallbackCandidates(
  index: RepoIndex,
  input: { file?: string; symbol?: string },
): RepoIndexSymbol[] {
  const sameName = input.symbol
    ? index.symbols.filter((candidate) => candidate.name === input.symbol)
    : [];
  if (sameName.length > 0) {
    return sameName.sort(byPathThenLineThenName);
  }
  if (!input.file) {
    return [];
  }
  const file = input.file;
  return index.symbols
    .filter((candidate) => samePath(candidate.path, file))
    .sort(byPathThenLineThenName);
}

function candidateSymbolsForResult(input: {
  index: RepoIndex | undefined;
  input: NormalizedInput;
  resolved: {
    target?: RepoIndexSymbol;
    candidates: RepoIndexSymbol[];
  };
}): RepoIndexSymbol[] {
  if (
    !input.index ||
    input.input.excludeExternal !== true ||
    !input.resolved.target ||
    !input.input.symbol
  ) {
    return input.resolved.candidates;
  }
  const targetLocation = symbolToLocation(input.input.repoRoot, input.resolved.target, input.index);
  if (!targetLocation.external) {
    return input.resolved.candidates;
  }
  const seen = new Set(input.resolved.candidates.map((candidate) => candidate.id));
  const candidates = [...input.resolved.candidates];
  for (const symbol of input.index.symbols.filter((symbol) => symbol.name === input.input.symbol)) {
    if (seen.has(symbol.id)) {
      continue;
    }
    seen.add(symbol.id);
    candidates.push(symbol);
  }
  return candidates.sort(byPathThenLineThenName);
}

function filterExternalLocations(input: {
  target: SymbolContextLocation | undefined;
  candidates: SymbolContextLocation[];
  excludeExternal: boolean;
  warnings: string[];
}): { target?: SymbolContextLocation; candidates: SymbolContextLocation[] } {
  if (!input.excludeExternal) {
    return {
      target: input.target,
      candidates: input.candidates,
    };
  }

  const excludedKeys = new Set<string>();
  function recordExternal(location: SymbolContextLocation | undefined): void {
    if (!location?.external) {
      return;
    }
    excludedKeys.add(`${location.id ?? ""}\0${location.path}\0${location.line ?? ""}`);
  }

  recordExternal(input.target);
  for (const candidate of input.candidates) {
    recordExternal(candidate);
  }

  if (excludedKeys.size > 0) {
    input.warnings.push(
      `Excluded ${excludedKeys.size} external graph location${excludedKeys.size === 1 ? "" : "s"} because excludeExternal is true.`,
    );
  }

  return {
    target: input.target?.external ? undefined : input.target,
    candidates: input.candidates.filter((candidate) => !candidate.external),
  };
}

function createGraphFacts(
  index: RepoIndex | undefined,
  target: RepoIndexSymbol | undefined,
): Pick<SymbolContextGraph, "inboundEdges" | "outboundEdges" | "nearbySymbols"> {
  if (!index || !target) {
    return {
      inboundEdges: emptyEdgeList(),
      outboundEdges: emptyEdgeList(),
      nearbySymbols: [],
    };
  }
  return {
    inboundEdges: edgeList(index.edges.filter((edge) => edge.to === target.id)),
    outboundEdges: edgeList(index.edges.filter((edge) => edge.from === target.id)),
    nearbySymbols: nearbySymbols(index, target),
  };
}

function edgeList(edges: RepoIndexEdge[]): SymbolContextEdgeList {
  const sortedEdges = [...edges].sort(compareRepoIndexEdges);
  const items = sortedEdges.slice(0, EDGE_LIMIT).map(edgeToContextEdge);
  return {
    items,
    totalCount: edges.length,
    omittedCount: Math.max(0, edges.length - items.length),
    truncated: edges.length > items.length,
  };
}

function emptyEdgeList(): SymbolContextEdgeList {
  return {
    items: [],
    totalCount: 0,
    omittedCount: 0,
    truncated: false,
  };
}

function edgeToContextEdge(edge: RepoIndexEdge): SymbolContextEdge {
  return {
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    provenance: edge.provenance,
    confidence: edge.confidence,
    line: edge.line,
    label: edge.label,
    source: "repo-index",
  };
}

function nearbySymbols(index: RepoIndex, target: RepoIndexSymbol): SymbolContextNearbySymbol[] {
  return index.symbols
    .filter((symbol) => samePath(symbol.path, target.path) && symbol.id !== target.id)
    .sort(
      (left, right) =>
        Math.abs(left.line - target.line) - Math.abs(right.line - target.line) ||
        left.line - right.line ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 10)
    .map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      path: symbol.path,
      line: symbol.line,
    }));
}

function symbolToLocation(
  repoRoot: string,
  symbol: RepoIndexSymbol,
  index: RepoIndex | undefined,
  confidence?: NonNullable<SymbolContextLocation["confidence"]>,
): SymbolContextLocation {
  const normalized = toRepoRelativeLocationPath(repoRoot, symbol.path);
  const facts = sourceFactsForSymbol(index, symbol);
  return {
    id: symbol.id,
    name: symbol.name,
    kind: symbol.kind,
    path: normalized.path,
    line: symbol.line,
    external: normalized.external,
    source: "repo-index",
    confidence,
    signature: facts.signature,
    documentation: facts.documentation,
  };
}

function sourceFactsForSymbol(
  index: RepoIndex | undefined,
  symbol: RepoIndexSymbol,
): { signature?: string; documentation?: string } {
  const file = findIndexedFile(index, symbol.path);
  if (!file || symbol.line < 1) {
    return {};
  }
  const lines = normalizeLineEndings(file.content).split("\n");
  const signature = compactBoundedLine(lines[symbol.line - 1] ?? "", MAX_SIGNATURE_LENGTH);
  const documentation = leadingDocumentation(lines, symbol.line);
  return {
    signature: signature.length > 0 ? signature : undefined,
    documentation,
  };
}

function leadingDocumentation(lines: string[], oneBasedSymbolLine: number): string | undefined {
  const cursor = oneBasedSymbolLine - 2;
  if (cursor < 0) {
    return undefined;
  }

  const current = (lines[cursor] ?? "").trim();
  if (current.endsWith("*/")) {
    return collectBlockDocumentation(lines, cursor);
  }
  if (current.startsWith("//") || current.startsWith("#")) {
    return collectLineDocumentation(lines, cursor);
  }
  return undefined;
}

function collectLineDocumentation(lines: string[], start: number): string | undefined {
  const comments: string[] = [];
  for (let cursor = start; cursor >= 0 && comments.length < MAX_DOCUMENTATION_LINES; cursor -= 1) {
    const trimmed = (lines[cursor] ?? "").trim();
    if (trimmed.startsWith("//")) {
      comments.unshift(trimmed.replace(/^\/\/\s?/, ""));
      continue;
    }
    if (trimmed.startsWith("#")) {
      comments.unshift(trimmed.replace(/^#\s?/, ""));
      continue;
    }
    break;
  }
  return compactDocumentation(comments);
}

function collectBlockDocumentation(lines: string[], end: number): string | undefined {
  const comments: string[] = [];
  for (
    let cursor = end;
    cursor >= 0 && comments.length < MAX_DOCUMENTATION_LINES;
    cursor -= 1
  ) {
    const trimmed = (lines[cursor] ?? "").trim();
    comments.unshift(
      trimmed
        .replace(/^\/\*\*\s?/, "")
        .replace(/^\/\*\s?/, "")
        .replace(/^\*\s?/, "")
        .replace(/\*\/$/, ""),
    );
    if (trimmed.startsWith("/**") || trimmed.startsWith("/*")) {
      break;
    }
  }
  return compactDocumentation(comments);
}

function compactDocumentation(lines: string[]): string | undefined {
  const value = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length === 0) {
    return undefined;
  }
  if (value.length <= MAX_DOCUMENTATION_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_DOCUMENTATION_LENGTH - 3)}...`;
}

function compactBoundedLine(value: string, limit: number): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (compact.length <= limit) {
    return compact;
  }
  return `${compact.slice(0, limit - 3)}...`;
}

function mapDiagnostics(input: {
  repoRoot: string;
  diagnostics: DiagnosticRecord[];
  warnings: string[];
}): SymbolContextDiagnostic[] {
  if (input.diagnostics.length > DIAGNOSTIC_LIMIT) {
    input.warnings.push("Diagnostics were capped at 50 records.");
  }
  return input.diagnostics.slice(0, DIAGNOSTIC_LIMIT).map((diagnostic) => {
    const normalizedPath =
      diagnostic.file === undefined
        ? undefined
        : toRepoRelativeLocationPath(input.repoRoot, diagnostic.file).path;
    return {
      diagnosticId: diagnostic.diagnosticId,
      source: diagnostic.source,
      severity: diagnostic.severity === "info" ? "information" : diagnostic.severity,
      message: diagnostic.message,
      path: normalizedPath,
      line: diagnostic.line,
      character: diagnostic.column,
      code: diagnostic.code,
      recordedAt: diagnostic.recordedAt,
    };
  });
}

function byPathThenLineThenName(left: RepoIndexSymbol, right: RepoIndexSymbol): number {
  return (
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.name.localeCompare(right.name)
  );
}

function compareRepoIndexEdges(left: RepoIndexEdge, right: RepoIndexEdge): number {
  return (
    left.kind.localeCompare(right.kind) ||
    normalizePathForCompare(left.from).localeCompare(normalizePathForCompare(right.from)) ||
    normalizePathForCompare(left.to).localeCompare(normalizePathForCompare(right.to)) ||
    (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER) ||
    (left.label ?? "").localeCompare(right.label ?? "") ||
    left.provenance.localeCompare(right.provenance) ||
    left.confidence - right.confidence
  );
}

function findIndexedFile(index: RepoIndex | undefined, filePath: string) {
  return index?.files.find((file) => samePath(file.path, filePath));
}

function samePath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right);
}

function normalizePathForCompare(value: string): string {
  return value.replace(/\\/g, "/");
}

function toRepoRelativeLocationPath(
  repoRoot: string,
  value: string,
): { path: string; external: boolean } {
  const absoluteValue = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(repoRoot, value);
  const relativePath = path.relative(repoRoot, absoluteValue);
  const normalizedRelativePath = relativePath.replace(/\\/g, "/");
  if (
    normalizedRelativePath === "" ||
    normalizedRelativePath === ".." ||
    normalizedRelativePath.startsWith("../") ||
    path.isAbsolute(relativePath) ||
    path.posix.isAbsolute(normalizedRelativePath)
  ) {
    return { path: value.replace(/\\/g, "/"), external: true };
  }
  return { path: normalizedRelativePath, external: false };
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
