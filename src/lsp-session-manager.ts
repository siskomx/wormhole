import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

const DEFAULT_STARTUP_TIMEOUT_MS = 250;
const MAX_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
const STOP_GRACE_MS = 250;
const JSON_RPC_WRITE_TIMEOUT_MS = 1_000;
const MAX_TIMED_OUT_REQUEST_IDS = 1_000;

export type LspSessionStatus = "running" | "stopped" | "failed" | "unavailable";

export type LspSessionStartInput = {
  repoRoot: string;
  language: string;
  command: string;
  args?: string[];
  startupTimeoutMs?: number;
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

export type LspRequestResult = {
  sessionId: string;
  status: "completed" | "failed" | "timed_out";
  response?: {
    jsonrpc?: string;
    id?: number;
    result?: unknown;
    error?: unknown;
    [key: string]: unknown;
  };
  error?: string;
};

export type LspSessionManager = {
  start(input: LspSessionStartInput): Promise<LspSessionInfo>;
  getOrStart(input: LspSessionStartInput & { beforeStart?: () => void | Promise<void> }): Promise<LspSessionAcquireResult>;
  list(): LspSessionInfo[];
  status(input: { sessionId: string }): LspSessionInfo | undefined;
  markInitialized(input: { sessionId: string; serverCapabilities?: unknown }): void;
  notify(input: { sessionId: string; method: string; params?: unknown }): Promise<LspNotificationResult>;
  request(input: { sessionId: string; method: string; params?: unknown; timeoutMs?: number }): Promise<LspRequestResult>;
  runExclusive<T>(input: { sessionId: string; operation: () => Promise<T> }): Promise<T>;
  ensureDocumentOpen(input: {
    sessionId: string;
    uri: string;
    languageId: string;
    version: number;
    text: string;
  }): Promise<LspDocumentOpenResult>;
  closeDocument(input: { sessionId: string; uri: string }): Promise<LspNotificationResult>;
  stop(input: { sessionId: string; force?: boolean }): Promise<LspSessionInfo>;
  stopIdle(input?: { idleTimeoutMs?: number; nowMs?: number }): Promise<LspSessionInfo[]>;
  stopAll(): Promise<void>;
};

type PendingRequest = {
  resolve: (result: LspRequestResult) => void;
  timer: NodeJS.Timeout;
};

type ManagedSession = {
  info: LspSessionInfo;
  child: ChildProcessWithoutNullStreams;
  buffer: Buffer;
  pending: Map<number, PendingRequest>;
  timedOutRequestIds: Set<number>;
  timedOutRequestOrder: number[];
  nextRequestId: number;
  retainedKey: string;
  openDocuments: Set<string>;
  openingDocuments: Map<string, Promise<LspDocumentOpenResult>>;
  queue: Promise<void>;
  activeOperationCount: number;
  queuedOperationCount: number;
  activeNotificationCount: number;
  leaseCount: number;
  lastUsedAtMs: number;
  lifecycleHandled: boolean;
  stopRequested: boolean;
  exitedStatus?: LspSessionStatus;
  exitedError?: string;
};

class LspStartupError extends Error {
  constructor(readonly info: LspSessionInfo) {
    super(info.error ?? `LSP session startup ended with status ${info.status}.`);
  }
}

export function createLspSessionManager(): LspSessionManager {
  const sessions = new Map<string, ManagedSession>();
  const retainedByKey = new Map<string, string>();
  const startingByKey = new Map<string, Promise<ManagedSession>>();

  function snapshot(session: ManagedSession): LspSessionInfo {
    session.info.openDocumentCount = session.openDocuments.size;
    return {
      ...session.info,
      args: [...session.info.args],
      openDocumentCount: session.openDocuments.size,
    };
  }

  function clearRetainedSession(session: ManagedSession): void {
    if (retainedByKey.get(session.retainedKey) === session.info.sessionId) {
      retainedByKey.delete(session.retainedKey);
    }
  }

  function failPendingRequests(session: ManagedSession, error: string): void {
    for (const [id, pending] of session.pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        sessionId: session.info.sessionId,
        status: "failed",
        error: `${error} Pending response ${id} was not received.`,
      });
    }
    session.pending.clear();
  }

  function markSessionFailed(session: ManagedSession, error: string): void {
    if (session.lifecycleHandled) {
      return;
    }
    session.info.status = "failed";
    session.info.error = appendError(session.info.error, error);
    clearRetainedSession(session);
    session.openDocuments.clear();
    session.openingDocuments.clear();
    session.info.openDocumentCount = 0;
    failPendingRequests(session, error);
    terminateFailedSession(session);
  }

  function handleChildEnd(session: ManagedSession, status: LspSessionStatus, error?: string): void {
    if (session.lifecycleHandled) {
      return;
    }
    session.lifecycleHandled = true;
    session.info.status = session.info.status === "failed" ? "failed" : session.stopRequested ? "stopped" : status;
    if (session.info.status === "failed" || session.info.status === "unavailable") {
      session.info.error = appendError(session.info.error, error);
    }
    clearRetainedSession(session);
    session.openDocuments.clear();
    session.openingDocuments.clear();
    session.info.openDocumentCount = 0;
    failPendingRequests(
      session,
      session.info.error ?? `LSP session ${session.info.sessionId} ${session.info.status}.`,
    );
    sessions.delete(session.info.sessionId);
  }

  function terminateFailedSession(session: ManagedSession): void {
    if (session.child.exitCode !== null || session.child.signalCode !== null) {
      return;
    }
    session.child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (
        !session.lifecycleHandled &&
        session.child.exitCode === null &&
        session.child.signalCode === null
      ) {
        session.child.kill("SIGKILL");
      }
    }, STOP_GRACE_MS);
    timer.unref?.();
  }

  function findRetainedSession(key: string): ManagedSession | undefined {
    const sessionId = retainedByKey.get(key);
    if (!sessionId) {
      return undefined;
    }
    const session = sessions.get(sessionId);
    if (!session || !isUsableRunningSession(session)) {
      retainedByKey.delete(key);
      return undefined;
    }
    return session;
  }

  function acquireSession(session: ManagedSession, createdByThisCall: boolean): LspSessionAcquireResult {
    session.leaseCount += 1;
    let released = false;
    return {
      info: snapshot(session),
      createdByThisCall,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        session.leaseCount = Math.max(0, session.leaseCount - 1);
      },
    };
  }

  function failedAcquireResult(
    input: LspSessionStartInput,
    createdByThisCall: boolean,
    error: unknown,
  ): LspSessionAcquireResult {
    const info =
      error instanceof LspStartupError
        ? error.info
        : createTerminalInfo(input, "failed", error instanceof Error ? error.message : String(error));
    return {
      info,
      createdByThisCall,
      release: () => undefined,
    };
  }

  async function startManaged(input: LspSessionStartInput, key: string): Promise<ManagedSession> {
    const nowMs = Date.now();
    const sessionId = `lsp:${randomUUID()}`;
    const repoRoot = path.resolve(input.repoRoot);
    const startedAt = new Date(nowMs).toISOString();
    const info: LspSessionInfo = {
      sessionId,
      repoRoot,
      language: input.language,
      command: input.command,
      args: [...(input.args ?? [])],
      status: "running",
      startedAt,
      lastUsedAt: startedAt,
      openDocumentCount: 0,
    };

    return await new Promise<ManagedSession>((resolve, reject) => {
      let startupSettled = false;
      let timer: NodeJS.Timeout;
      let child: ChildProcessWithoutNullStreams;

      try {
        child = spawn(input.command, input.args ?? [], {
          cwd: repoRoot,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        reject(new LspStartupError(createTerminalInfo(input, "unavailable", errorMessage(error))));
        return;
      }

      const session: ManagedSession = {
        info,
        child,
        buffer: Buffer.alloc(0),
        pending: new Map(),
        timedOutRequestIds: new Set(),
        timedOutRequestOrder: [],
        nextRequestId: 1,
        retainedKey: key,
        openDocuments: new Set(),
        openingDocuments: new Map(),
        queue: Promise.resolve(),
        activeOperationCount: 0,
        queuedOperationCount: 0,
        activeNotificationCount: 0,
        leaseCount: 0,
        lastUsedAtMs: nowMs,
        lifecycleHandled: false,
        stopRequested: false,
      };

      const rejectStartup = () => {
        if (startupSettled) {
          return;
        }
        startupSettled = true;
        clearTimeout(timer);
        reject(new LspStartupError(snapshot(session)));
      };

      const resolveStartup = () => {
        if (startupSettled) {
          return;
        }
        startupSettled = true;
        sessions.set(sessionId, session);
        retainedByKey.set(key, sessionId);
        resolve(session);
      };

      timer = setTimeout(resolveStartup, clampStartupTimeout(input.startupTimeoutMs));

      child.stdout.on("data", (chunk: Buffer) => {
        session.buffer = Buffer.concat([session.buffer, chunk]);
        drainResponses(session);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        session.info.error = appendError(session.info.error, chunk.toString("utf8"));
      });
      child.stdin.on("error", (error) => {
        if (!session.lifecycleHandled && session.info.status === "running") {
          markSessionFailed(session, `LSP stdin write failed: ${error.message}`);
        }
      });
      child.on("error", (error) => {
        handleChildEnd(session, startupSettled ? "failed" : "unavailable", error.message);
        rejectStartup();
      });
      child.on("exit", (code, signal) => {
        const status = exitStatus(session, code);
        session.exitedStatus = status;
        session.exitedError = exitError(status, code, signal);
        if (!startupSettled) {
          handleChildEnd(session, status, session.exitedError);
          rejectStartup();
        }
      });
      child.on("close", (code, signal) => {
        const status = session.exitedStatus ?? exitStatus(session, code);
        handleChildEnd(session, status, session.exitedError ?? exitError(status, code, signal));
        rejectStartup();
      });
    });
  }

  async function start(input: LspSessionStartInput): Promise<LspSessionInfo> {
    try {
      const session = await startManaged(input, sessionKey(input));
      return snapshot(session);
    } catch (error) {
      if (error instanceof LspStartupError) {
        return error.info;
      }
      return createTerminalInfo(input, "failed", errorMessage(error));
    }
  }

  async function getOrStart(
    input: LspSessionStartInput & { beforeStart?: () => void | Promise<void> },
  ): Promise<LspSessionAcquireResult> {
    const key = sessionKey(input);
    const retained = findRetainedSession(key);
    if (retained) {
      return acquireSession(retained, false);
    }

    let createdByThisCall = false;
    let starting = startingByKey.get(key);
    if (!starting) {
      createdByThisCall = true;
      starting = (async () => {
        await input.beforeStart?.();
        return await startManaged(input, key);
      })();
      startingByKey.set(key, starting);
      void starting
        .finally(() => {
          if (startingByKey.get(key) === starting) {
            startingByKey.delete(key);
          }
        })
        .catch(() => undefined);
    }

    try {
      const session = await starting;
      return acquireSession(session, createdByThisCall);
    } catch (error) {
      return failedAcquireResult(input, createdByThisCall, error);
    }
  }

  function list(): LspSessionInfo[] {
    return [...sessions.values()].map((session) => snapshot(session));
  }

  function status(input: { sessionId: string }): LspSessionInfo | undefined {
    const session = sessions.get(input.sessionId);
    return session ? snapshot(session) : undefined;
  }

  function markInitialized(input: { sessionId: string; serverCapabilities?: unknown }): void {
    const session = sessions.get(input.sessionId);
    if (!session) {
      return;
    }
    session.info.initialized = true;
    session.info.serverCapabilities = input.serverCapabilities;
  }

  async function notify(input: {
    sessionId: string;
    method: string;
    params?: unknown;
  }): Promise<LspNotificationResult> {
    const session = sessions.get(input.sessionId);
    if (!session || !isUsableRunningSession(session)) {
      return {
        sessionId: input.sessionId,
        status: "failed",
        error: "LSP session is not running.",
      };
    }

    try {
      session.activeNotificationCount += 1;
      await writeJsonRpc(session.child, {
        jsonrpc: "2.0",
        method: input.method,
        params: input.params ?? {},
      });
      touchSession(session);
      return { sessionId: input.sessionId, status: "sent" };
    } catch (error) {
      const message = `LSP notification write failed: ${errorMessage(error)}`;
      markSessionFailed(session, message);
      return {
        sessionId: input.sessionId,
        status: "failed",
        error: message,
      };
    } finally {
      session.activeNotificationCount = Math.max(0, session.activeNotificationCount - 1);
    }
  }

  function request(input: {
    sessionId: string;
    method: string;
    params?: unknown;
    timeoutMs?: number;
  }): Promise<LspRequestResult> {
    const session = sessions.get(input.sessionId);
    if (!session || !isUsableRunningSession(session)) {
      return Promise.resolve({
        sessionId: input.sessionId,
        status: "failed",
        error: "LSP session is not running.",
      });
    }
    if (session.nextRequestId > Number.MAX_SAFE_INTEGER) {
      const message = "LSP request id exceeded Number.MAX_SAFE_INTEGER.";
      markSessionFailed(session, message);
      return Promise.resolve({
        sessionId: input.sessionId,
        status: "failed",
        error: message,
      });
    }

    const id = session.nextRequestId;
    session.nextRequestId += 1;
    const timeoutMs = input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const payload = {
      jsonrpc: "2.0",
      id,
      method: input.method,
      params: input.params ?? {},
    };

    return new Promise<LspRequestResult>((resolve) => {
      const timer = setTimeout(() => {
        if (!session.pending.delete(id)) {
          return;
        }
        addTimedOutRequestId(session, id);
        touchSession(session);
        resolve({
          sessionId: input.sessionId,
          status: "timed_out",
          error: `LSP request timed out after ${timeoutMs}ms.`,
        });
      }, timeoutMs);

      session.pending.set(id, { resolve, timer });
      touchSession(session);
      void writeJsonRpc(session.child, payload).catch((error) => {
        const pending = session.pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          session.pending.delete(id);
          pending.resolve({
            sessionId: input.sessionId,
            status: "failed",
            error: `LSP request write failed: ${errorMessage(error)}`,
          });
        }
        markSessionFailed(session, `LSP request write failed: ${errorMessage(error)}`);
      });
    });
  }

  async function runExclusive<T>(input: { sessionId: string; operation: () => Promise<T> }): Promise<T> {
    const session = sessions.get(input.sessionId);
    if (!session || !isUsableRunningSession(session)) {
      throw new Error("LSP session is not running.");
    }

    session.queuedOperationCount += 1;
    const run = session.queue.then(async () => {
      session.queuedOperationCount = Math.max(0, session.queuedOperationCount - 1);
      session.activeOperationCount += 1;
      touchSession(session);
      try {
        return await input.operation();
      } finally {
        touchSession(session);
        session.activeOperationCount = Math.max(0, session.activeOperationCount - 1);
      }
    });
    session.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  }

  async function ensureDocumentOpen(input: {
    sessionId: string;
    uri: string;
    languageId: string;
    version: number;
    text: string;
  }): Promise<LspDocumentOpenResult> {
    const session = sessions.get(input.sessionId);
    if (!session || !isUsableRunningSession(session)) {
      return {
        sessionId: input.sessionId,
        status: "failed",
        openedByThisCall: false,
        error: "LSP session is not running.",
      };
    }
    if (session.openDocuments.has(input.uri)) {
      return {
        sessionId: input.sessionId,
        status: "sent",
        openedByThisCall: false,
      };
    }
    const inFlightOpen = session.openingDocuments.get(input.uri);
    if (inFlightOpen) {
      const result = await inFlightOpen;
      return {
        sessionId: input.sessionId,
        status: result.status,
        openedByThisCall: false,
        error: result.error,
      };
    }

    const open = (async (): Promise<LspDocumentOpenResult> => {
      const result = await notify({
        sessionId: input.sessionId,
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: input.uri,
            languageId: input.languageId,
            version: input.version,
            text: input.text,
          },
        },
      });
      if (result.status === "sent") {
        session.openDocuments.add(input.uri);
        session.info.openDocumentCount = session.openDocuments.size;
        return { ...result, openedByThisCall: true };
      }
      session.openDocuments.delete(input.uri);
      session.info.openDocumentCount = session.openDocuments.size;
      return { ...result, openedByThisCall: false };
    })();
    session.openingDocuments.set(input.uri, open);
    try {
      return await open;
    } finally {
      if (session.openingDocuments.get(input.uri) === open) {
        session.openingDocuments.delete(input.uri);
      }
    }
  }

  async function closeDocument(input: { sessionId: string; uri: string }): Promise<LspNotificationResult> {
    const session = sessions.get(input.sessionId);
    if (!session || !isUsableRunningSession(session)) {
      return {
        sessionId: input.sessionId,
        status: "failed",
        error: "LSP session is not running.",
      };
    }
    const opening = session.openingDocuments.get(input.uri);
    if (opening) {
      await opening;
      if (!isUsableRunningSession(session)) {
        return {
          sessionId: input.sessionId,
          status: "failed",
          error: "LSP session is not running.",
        };
      }
    }
    if (!session.openDocuments.has(input.uri)) {
      return { sessionId: input.sessionId, status: "sent" };
    }

    const result = await notify({
      sessionId: input.sessionId,
      method: "textDocument/didClose",
      params: { textDocument: { uri: input.uri } },
    });
    session.openDocuments.delete(input.uri);
    session.info.openDocumentCount = session.openDocuments.size;
    return result;
  }

  async function stop(input: { sessionId: string; force?: boolean }): Promise<LspSessionInfo> {
    const session = sessions.get(input.sessionId);
    if (!session) {
      const now = new Date().toISOString();
      return {
        sessionId: input.sessionId,
        repoRoot: "",
        language: "",
        command: "",
        args: [],
        status: "stopped",
        startedAt: now,
        lastUsedAt: now,
        openDocumentCount: 0,
      };
    }
    if (!input.force && isBusySession(session)) {
      return {
        ...snapshot(session),
        error: appendError(snapshot(session).error, "LSP session is busy; use force to stop it."),
      };
    }

    return await new Promise<LspSessionInfo>((resolve) => {
      let settled = false;
      let escalated = false;
      let timer: NodeJS.Timeout;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.child.off("close", finish);
        handleChildEnd(session, "stopped");
        resolve({ ...snapshot(session), status: "stopped" });
      };
      timer = setTimeout(() => {
        if (input.force && !escalated) {
          escalated = true;
          session.child.kill("SIGKILL");
          clearTimeout(timer);
          timer = setTimeout(finish, STOP_GRACE_MS);
          return;
        }
        if (!input.force) {
          if (settled) {
            return;
          }
          settled = true;
          session.child.off("close", finish);
          session.stopRequested = false;
          session.info.status = "running";
          resolve({
            ...snapshot(session),
            status: "running",
            error: appendError(session.info.error, "LSP session did not exit after SIGTERM; use force to stop it."),
          });
          return;
        }
        finish();
      }, STOP_GRACE_MS);

      session.child.on("close", finish);
      if (session.child.exitCode !== null || session.lifecycleHandled) {
        finish();
        return;
      }
      session.stopRequested = true;
      if (input.force) {
        clearRetainedSession(session);
      }
      session.child.kill("SIGTERM");
    });
  }

  async function stopIdle(input: { idleTimeoutMs?: number; nowMs?: number } = {}): Promise<LspSessionInfo[]> {
    const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    const nowMs = input.nowMs ?? Date.now();
    const stopped: LspSessionInfo[] = [];
    for (const session of [...sessions.values()]) {
      if (session.info.status !== "running") {
        continue;
      }
      if (isBusySession(session)) {
        continue;
      }
      if (nowMs - session.lastUsedAtMs < idleTimeoutMs) {
        continue;
      }
      const stoppedInfo = await stop({ sessionId: session.info.sessionId });
      if (stoppedInfo.status === "stopped") {
        stopped.push(stoppedInfo);
      }
    }
    return stopped;
  }

  async function stopAll(): Promise<void> {
    await Promise.all([...sessions.keys()].map((sessionId) => stop({ sessionId, force: true })));
  }

  return {
    start,
    getOrStart,
    list,
    status,
    markInitialized,
    notify,
    request,
    runExclusive,
    ensureDocumentOpen,
    closeDocument,
    stop,
    stopIdle,
    stopAll,
  };
}

function drainResponses(session: ManagedSession): void {
  while (true) {
    const headerEnd = session.buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }
    const header = session.buffer.subarray(0, headerEnd).toString("ascii");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match?.[1]) {
      session.buffer = Buffer.alloc(0);
      return;
    }
    const contentLength = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (session.buffer.length < bodyEnd) {
      return;
    }
    const rawBody = session.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    session.buffer = session.buffer.subarray(bodyEnd);

    let response: NonNullable<LspRequestResult["response"]>;
    try {
      response = JSON.parse(rawBody) as NonNullable<LspRequestResult["response"]>;
    } catch (error) {
      session.info.error = appendError(session.info.error, `Invalid JSON-RPC response: ${errorMessage(error)}`);
      continue;
    }
    if (typeof response.id !== "number") {
      continue;
    }
    const pending = session.pending.get(response.id);
    if (!pending) {
      if (session.timedOutRequestIds.delete(response.id)) {
        session.timedOutRequestOrder = session.timedOutRequestOrder.filter((id) => id !== response.id);
      }
      continue;
    }
    clearTimeout(pending.timer);
    session.pending.delete(response.id);
    touchSession(session);
    pending.resolve({
      sessionId: session.info.sessionId,
      status: "completed",
      response,
    });
  }
}

function writeJsonRpc(child: ChildProcessWithoutNullStreams, payload: unknown): Promise<void> {
  const message = JSON.stringify(payload);
  const framed = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`;
  return new Promise((resolve, reject) => {
    if (
      child.stdin.destroyed ||
      !child.stdin.writable ||
      child.stdin.writableEnded ||
      child.stdin.closed ||
      child.stdin.errored
    ) {
      reject(new Error("LSP stdin is not writable."));
      return;
    }
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      child.stdin.off("error", onError);
    };
    const onError = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(`LSP JSON-RPC write timed out after ${JSON_RPC_WRITE_TIMEOUT_MS}ms.`));
    }, JSON_RPC_WRITE_TIMEOUT_MS);
    child.stdin.once("error", onError);
    try {
      child.stdin.write(framed, (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    } catch (error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    }
  });
}

function sessionKey(input: Pick<LspSessionStartInput, "repoRoot" | "language" | "command" | "args">): string {
  return JSON.stringify({
    repoRoot: path.resolve(input.repoRoot),
    language: input.language,
    command: input.command,
    args: input.args ?? [],
  });
}

function clampStartupTimeout(value: number | undefined): number {
  const requested = value ?? DEFAULT_STARTUP_TIMEOUT_MS;
  return Math.max(1, Math.min(requested, MAX_STARTUP_TIMEOUT_MS));
}

function createTerminalInfo(
  input: LspSessionStartInput,
  status: Exclude<LspSessionStatus, "running">,
  error?: string,
): LspSessionInfo {
  const now = new Date().toISOString();
  return {
    sessionId: `lsp:${randomUUID()}`,
    repoRoot: path.resolve(input.repoRoot),
    language: input.language,
    command: input.command,
    args: [...(input.args ?? [])],
    status,
    startedAt: now,
    lastUsedAt: now,
    openDocumentCount: 0,
    error,
  };
}

function isUsableRunningSession(session: ManagedSession): boolean {
  return (
    session.info.status === "running" &&
    !session.lifecycleHandled &&
    session.child.exitCode === null &&
    session.child.signalCode === null
  );
}

function isBusySession(session: ManagedSession): boolean {
  return (
    session.activeOperationCount > 0 ||
    session.queuedOperationCount > 0 ||
    session.activeNotificationCount > 0 ||
    session.pending.size > 0 ||
    session.leaseCount > 0
  );
}

function touchSession(session: ManagedSession): void {
  session.lastUsedAtMs = Date.now();
  session.info.lastUsedAt = new Date(session.lastUsedAtMs).toISOString();
}

function addTimedOutRequestId(session: ManagedSession, id: number): void {
  session.timedOutRequestIds.add(id);
  session.timedOutRequestOrder.push(id);
  while (session.timedOutRequestOrder.length > MAX_TIMED_OUT_REQUEST_IDS) {
    const oldest = session.timedOutRequestOrder.shift();
    if (oldest !== undefined) {
      session.timedOutRequestIds.delete(oldest);
    }
  }
}

function exitStatus(session: ManagedSession, code: number | null): LspSessionStatus {
  if (session.stopRequested || code === 0) {
    return "stopped";
  }
  return "failed";
}

function exitError(status: LspSessionStatus, code: number | null, signal: NodeJS.Signals | null): string | undefined {
  if (status === "stopped") {
    return undefined;
  }
  if (signal) {
    return `Exited with signal ${signal}`;
  }
  return `Exited with code ${code ?? "unknown"}`;
}

function appendError(current: string | undefined, next: string | undefined): string | undefined {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return `${current}${current.endsWith("\n") ? "" : "\n"}${next}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
