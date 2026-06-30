import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createLspSessionManager, type LspSessionInfo } from "../src/lsp-session-manager.js";

type JsonRecord = {
  id?: number;
  method?: string;
  params?: unknown;
  jsonrpc?: string;
};

const itCanIgnoreSigterm = process.platform === "win32" ? it.skip : it;

describe("LSP session manager", () => {
  it("returns structured unavailable status when a server command is missing", async () => {
    const manager = createLspSessionManager();
    const started = await manager.start({
      repoRoot: process.cwd(),
      language: "typescript",
      command: "definitely-missing-wormhole-lsp",
      args: [],
      startupTimeoutMs: 200,
    });

    expect(started.status).toBe("unavailable");
    expect(started.error).toMatch(/definitely-missing/);
    expect(manager.list()).toHaveLength(0);
  });

  it("starts, requests, and stops a JSON-RPC language-server-like process", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-session-"));
    const manager = createLspSessionManager();

    try {
      const started = await manager.start({
        repoRoot,
        language: "typescript",
        command: process.execPath,
        args: ["-e", basicJsonRpcServerScript()],
        startupTimeoutMs: 20,
      });
      manager.markInitialized({
        sessionId: started.sessionId,
        serverCapabilities: { referencesProvider: true },
      });
      const response = await manager.request({
        sessionId: started.sessionId,
        method: "initialize",
        params: { rootUri: `file://${repoRoot}` },
        timeoutMs: 1_000,
      });
      const status = manager.status({ sessionId: started.sessionId });
      const stopped = await manager.stop({ sessionId: started.sessionId });

      expect(started.status).toBe("running");
      expect(started.lastUsedAt).toEqual(expect.any(String));
      expect(started.openDocumentCount).toBe(0);
      expect(status).toEqual(
        expect.objectContaining({
          initialized: true,
          serverCapabilities: { referencesProvider: true },
        }),
      );
      expect(response.status).toBe("completed");
      expect(response.response?.result).toEqual({ method: "initialize", ok: true });
      expect(stopped.status).toBe("stopped");
      expect(manager.list()).toHaveLength(0);
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("parses JSON-RPC responses using byte Content-Length for non-ASCII payloads", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-non-ascii-"));
    const manager = createLspSessionManager();

    try {
      const started = await manager.start(startInput(repoRoot, nonAsciiResponseServerScript(), 20));
      const response = await manager.request({
        sessionId: started.sessionId,
        method: "hover",
        timeoutMs: 500,
      });

      expect(response.status).toBe("completed");
      expect(response.response?.result).toEqual({ label: "caf\u00e9" });
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("waits beyond the old 50ms startup cap and returns stopped when the child exits during startup", async () => {
    const manager = createLspSessionManager();
    const started = await manager.start({
      repoRoot: process.cwd(),
      language: "typescript",
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 80);"],
      startupTimeoutMs: 200,
    });

    expect(started.status).toBe("stopped");
    expect(manager.list()).toHaveLength(0);
  });

  it("uses a short default startup grace instead of waiting for the maximum startup window", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-default-startup-"));
    const manager = createLspSessionManager();
    const startedAt = Date.now();

    try {
      const started = await manager.start({
        repoRoot,
        language: "typescript",
        command: process.execPath,
        args: ["-e", basicJsonRpcServerScript()],
      });
      const elapsedMs = Date.now() - startedAt;

      expect(started.status).toBe("running");
      expect(elapsedMs).toBeLessThan(2_000);
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("notify sends a JSON-RPC notification without an id", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-notify-"));
    const logPath = path.join(repoRoot, "rpc.jsonl");
    const manager = createLspSessionManager();

    try {
      const started = await startLoggedServer(manager, repoRoot, logPath);
      const notified = await manager.notify({
        sessionId: started.sessionId,
        method: "initialized",
        params: { ready: true },
      });

      await waitFor(() => {
        expect(readJsonLines(logPath)).toEqual([
          expect.objectContaining({ jsonrpc: "2.0", method: "initialized", params: { ready: true } }),
        ]);
      });
      expect(notified).toEqual({ sessionId: started.sessionId, status: "sent" });
      expect(readJsonLines(logPath)[0]).not.toHaveProperty("id");
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("tracks document open and close notifications by URI", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-docs-"));
    const logPath = path.join(repoRoot, "rpc.jsonl");
    const manager = createLspSessionManager();

    try {
      const started = await startLoggedServer(manager, repoRoot, logPath);
      const uri = `file://${repoRoot.replace(/\\/g, "/")}/src/demo.ts`;
      const first = await manager.ensureDocumentOpen({
        sessionId: started.sessionId,
        uri,
        languageId: "typescript",
        version: 1,
        text: "export const demo = 1;\n",
      });
      const second = await manager.ensureDocumentOpen({
        sessionId: started.sessionId,
        uri,
        languageId: "typescript",
        version: 1,
        text: "export const demo = 1;\n",
      });
      const openStatus = manager.status({ sessionId: started.sessionId });
      const closed = await manager.closeDocument({ sessionId: started.sessionId, uri });
      const closeStatus = manager.status({ sessionId: started.sessionId });

      await waitFor(() => {
        const methods = readJsonLines(logPath).map((record) => record.method);
        expect(methods).toEqual(["textDocument/didOpen", "textDocument/didClose"]);
      });
      expect(first.openedByThisCall).toBe(true);
      expect(second.openedByThisCall).toBe(false);
      expect(openStatus?.openDocumentCount).toBe(1);
      expect(closed.status).toBe("sent");
      expect(closeStatus?.openDocumentCount).toBe(0);
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("closes a document after an overlapping in-flight open completes", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-doc-open-close-race-"));
    const logPath = path.join(repoRoot, "rpc.jsonl");
    const manager = createLspSessionManager();

    try {
      const started = await manager.start(startInput(repoRoot, pausedMethodLoggingJsonRpcServerScript(logPath), 20));
      expect(started.status).toBe("running");
      const uri = `file://${repoRoot.replace(/\\/g, "/")}/src/overlap.ts`;
      const opened = manager.ensureDocumentOpen({
        sessionId: started.sessionId,
        uri,
        languageId: "typescript",
        version: 1,
        text: "x".repeat(1024 * 1024),
      });
      await delay(20);
      const closed = manager.closeDocument({ sessionId: started.sessionId, uri });

      await expect(opened).resolves.toEqual(
        expect.objectContaining({ status: "sent", openedByThisCall: true }),
      );
      await expect(closed).resolves.toEqual(expect.objectContaining({ status: "sent" }));
      await waitFor(() => {
        expect(readJsonLines(logPath).map((record) => record.method)).toEqual([
          "textDocument/didOpen",
          "textDocument/didClose",
        ]);
      });
      expect(manager.status({ sessionId: started.sessionId })?.openDocumentCount).toBe(0);
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("coalesces concurrent document opens for the same URI into one didOpen notification", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-doc-race-"));
    const logPath = path.join(repoRoot, "rpc.jsonl");
    const manager = createLspSessionManager();

    try {
      const started = await manager.start(startInput(repoRoot, slowLoggingJsonRpcServerScript(logPath), 20));
      expect(started.status).toBe("running");
      const uri = `file://${repoRoot.replace(/\\/g, "/")}/src/race.ts`;
      const [first, second] = await Promise.all([
        manager.ensureDocumentOpen({
          sessionId: started.sessionId,
          uri,
          languageId: "typescript",
          version: 1,
          text: "export const race = 1;\n",
        }),
        manager.ensureDocumentOpen({
          sessionId: started.sessionId,
          uri,
          languageId: "typescript",
          version: 1,
          text: "export const race = 1;\n",
        }),
      ]);

      await waitFor(() => {
        const didOpenCount = readJsonLines(logPath).filter((record) => record.method === "textDocument/didOpen").length;
        expect(didOpenCount).toBe(1);
      });
      expect([first.openedByThisCall, second.openedByThisCall].filter(Boolean)).toHaveLength(1);
      expect(manager.status({ sessionId: started.sessionId })?.openDocumentCount).toBe(1);
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("getOrStart reuses a retained session for the same repo, language, command, and args", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-reuse-"));
    const manager = createLspSessionManager();
    const leases: Array<{ release: () => void }> = [];

    try {
      const input = startInput(repoRoot, basicJsonRpcServerScript());
      const first = await manager.getOrStart(input);
      const second = await manager.getOrStart(input);
      leases.push(first, second);

      expect(first.info.status).toBe("running");
      expect(second.info.status).toBe("running");
      expect(second.info.sessionId).toBe(first.info.sessionId);
      expect(first.createdByThisCall).toBe(true);
      expect(second.createdByThisCall).toBe(false);
      expect(manager.list()).toHaveLength(1);

      first.release();
    } finally {
      for (const lease of leases) {
        lease.release();
      }
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("concurrent getOrStart calls share one startup and attribute creation to one caller", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-concurrent-"));
    const manager = createLspSessionManager();
    let beforeStartCalls = 0;
    const leases: Array<{ release: () => void }> = [];

    try {
      const input = startInput(repoRoot, basicJsonRpcServerScript());
      const [first, second] = await Promise.all([
        manager.getOrStart({
          ...input,
          beforeStart: async () => {
            beforeStartCalls += 1;
            await delay(30);
          },
        }),
        manager.getOrStart({
          ...input,
          beforeStart: () => {
            beforeStartCalls += 1;
          },
        }),
      ]);

      expect(first.info.sessionId).toBe(second.info.sessionId);
      expect(beforeStartCalls).toBe(1);
      expect([first.createdByThisCall, second.createdByThisCall].filter(Boolean)).toHaveLength(1);
      expect(manager.list()).toHaveLength(1);

      leases.push(first, second);
    } finally {
      for (const lease of leases) {
        lease.release();
      }
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("clears a failed concurrent startup so a later getOrStart can retry", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-retry-"));
    const manager = createLspSessionManager();
    const leases: Array<{ release: () => void }> = [];

    try {
      const input = startInput(repoRoot, failOnceThenStayAliveScript(path.join(repoRoot, "started.marker")), 1_000);
      const [first, second] = await Promise.all([
        manager.getOrStart(input),
        manager.getOrStart(input),
      ]);
      const retry = await manager.getOrStart(input);
      leases.push(retry);

      expect(first.info.status).toBe("failed");
      expect(second.info.status).toBe("failed");
      expect(manager.list()).toHaveLength(1);
      expect(retry.info.status).toBe("running");
    } finally {
      for (const lease of leases) {
        lease.release();
      }
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("runExclusive serializes async operations on the same session", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-lock-"));
    const manager = createLspSessionManager();
    const order: string[] = [];

    try {
      const started = await manager.start(startInput(repoRoot, basicJsonRpcServerScript()));
      const first = manager.runExclusive({
        sessionId: started.sessionId,
        operation: async () => {
          order.push("first-start");
          await delay(40);
          order.push("first-end");
          return "first";
        },
      });
      const second = manager.runExclusive({
        sessionId: started.sessionId,
        operation: async () => {
          order.push("second-start");
          await delay(1);
          order.push("second-end");
          return "second";
        },
      });

      await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
      expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("stopIdle skips active, pending, leased, and fresh sessions while stopping stale sessions", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-idle-"));
    const manager = createLspSessionManager();
    let finishActive!: () => void;
    const activeFinished = new Promise<void>((resolve) => {
      finishActive = resolve;
    });

    try {
      const active = await manager.start(startInput(repoRoot, basicJsonRpcServerScript()));
      const activeStarted = deferred<void>();
      const activeRun = manager.runExclusive({
        sessionId: active.sessionId,
        operation: async () => {
          activeStarted.resolve();
          await activeFinished;
        },
      });
      await activeStarted.promise;

      const pending = await manager.start(startInput(repoRoot, basicJsonRpcServerScript()));
      const pendingRequest = manager.request({
        sessionId: pending.sessionId,
        method: "never",
        timeoutMs: 1_000,
      });

      const leased = await manager.getOrStart(startInput(repoRoot, basicJsonRpcServerScript()));
      const stale = await manager.start(startInput(repoRoot, basicJsonRpcServerScript()));
      await delay(40);
      const fresh = await manager.start(startInput(repoRoot, basicJsonRpcServerScript()));
      await manager.runExclusive({ sessionId: fresh.sessionId, operation: async () => undefined });

      const stopped = await manager.stopIdle({ idleTimeoutMs: 30, nowMs: Date.now() });
      const stoppedIds = stopped.map((info) => info.sessionId);

      expect(stoppedIds).toContain(stale.sessionId);
      expect(stoppedIds).not.toContain(active.sessionId);
      expect(stoppedIds).not.toContain(pending.sessionId);
      expect(stoppedIds).not.toContain(leased.info.sessionId);
      expect(stoppedIds).not.toContain(fresh.sessionId);
      expect(manager.status({ sessionId: active.sessionId })?.status).toBe("running");
      expect(manager.status({ sessionId: pending.sessionId })?.status).toBe("running");
      expect(manager.status({ sessionId: leased.info.sessionId })?.status).toBe("running");
      expect(manager.status({ sessionId: fresh.sessionId })?.status).toBe("running");

      finishActive();
      await activeRun;
      const timedOut = await pendingRequest;
      expect(timedOut.status).toBe("timed_out");
      leased.release();
    } finally {
      finishActive?.();
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("treats in-flight notifications as busy for stopIdle and safe stop", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-notify-busy-"));
    const manager = createLspSessionManager();

    try {
      const started = await manager.start(startInput(repoRoot, idleStdinServerScript(), 20));
      const uri = `file://${repoRoot.replace(/\\/g, "/")}/src/large.ts`;
      const didOpen = manager.ensureDocumentOpen({
        sessionId: started.sessionId,
        uri,
        languageId: "typescript",
        version: 1,
        text: "x".repeat(1024 * 1024),
      });
      await delay(50);

      const stoppedIdle = await manager.stopIdle({ idleTimeoutMs: 0, nowMs: Date.now() });
      const safeStop = await manager.stop({ sessionId: started.sessionId });

      expect(stoppedIdle.map((info) => info.sessionId)).not.toContain(started.sessionId);
      expect(safeStop.status).toBe("running");
      expect(safeStop.error).toMatch(/busy|notification|write/i);
      expect(manager.status({ sessionId: started.sessionId })?.status).toBe("running");

      const openResult = await didOpen;
      expect(openResult.status).toBe("failed");
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("stopAll force-stops leased and active sessions", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-stop-all-"));
    const manager = createLspSessionManager();
    let finishActive!: () => void;
    const activeFinished = new Promise<void>((resolve) => {
      finishActive = resolve;
    });
    const leases: Array<{ release: () => void }> = [];

    try {
      const leased = await manager.getOrStart(startInput(repoRoot, basicJsonRpcServerScript()));
      leases.push(leased);
      const active = await manager.start(startInput(repoRoot, basicJsonRpcServerScript()));
      const activeStarted = deferred<void>();
      const activeRun = manager.runExclusive({
        sessionId: active.sessionId,
        operation: async () => {
          activeStarted.resolve();
          await activeFinished;
        },
      });
      await activeStarted.promise;

      await manager.stopAll();

      expect(manager.list()).toHaveLength(0);
      finishActive();
      await activeRun;
    } finally {
      for (const lease of leases) {
        lease.release();
      }
      finishActive?.();
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("stop without force does not terminate leased or active sessions", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-safe-stop-"));
    const manager = createLspSessionManager();
    let finishActive!: () => void;
    const activeFinished = new Promise<void>((resolve) => {
      finishActive = resolve;
    });

    try {
      const leased = await manager.getOrStart(startInput(repoRoot, basicJsonRpcServerScript()));
      const leasedStop = await manager.stop({ sessionId: leased.info.sessionId });
      const active = await manager.start(startInput(repoRoot, basicJsonRpcServerScript()));
      const activeStarted = deferred<void>();
      const activeRun = manager.runExclusive({
        sessionId: active.sessionId,
        operation: async () => {
          activeStarted.resolve();
          await activeFinished;
        },
      });
      await activeStarted.promise;
      const activeStop = await manager.stop({ sessionId: active.sessionId });

      expect(leasedStop.status).toBe("running");
      expect(leasedStop.error).toMatch(/busy|leased|active/i);
      expect(activeStop.status).toBe("running");
      expect(activeStop.error).toMatch(/busy|leased|active/i);
      expect(manager.status({ sessionId: leased.info.sessionId })?.status).toBe("running");
      expect(manager.status({ sessionId: active.sessionId })?.status).toBe("running");

      leased.release();
      finishActive();
      await activeRun;
    } finally {
      finishActive?.();
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("keeps tracking a child that ignores non-force stop and force stop cleans it up", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-ignore-stop-"));
    const manager = createLspSessionManager();

    try {
      const started = await manager.start(startInput(repoRoot, ignoreSigtermServerScript(), 20));
      const safeStop = await manager.stop({ sessionId: started.sessionId });
      const stillTracked = manager.status({ sessionId: started.sessionId });

      if (process.platform !== "win32") {
        expect(safeStop.status).toBe("running");
        expect(safeStop.error).toMatch(/did not exit|force/i);
        expect(stillTracked?.status).toBe("running");
      }

      const forcedStop = await manager.stop({ sessionId: started.sessionId, force: true });
      expect(forcedStop.status).toBe("stopped");
      expect(manager.status({ sessionId: started.sessionId })).toBeUndefined();
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  itCanIgnoreSigterm("classifies a later nonzero exit as failed after non-force stop times out", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-stop-timeout-exit-"));
    const manager = createLspSessionManager();

    try {
      const started = await manager.start(startInput(repoRoot, ignoreSigtermExitOnRequestServerScript(), 20));
      const safeStop = await manager.stop({ sessionId: started.sessionId });
      expect(safeStop.status).toBe("running");
      expect(safeStop.error).toMatch(/did not exit|force/i);

      const pending = manager.request({
        sessionId: started.sessionId,
        method: "exitNonZero",
        timeoutMs: 1_000,
      });

      await expect(pending).resolves.toEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.stringMatching(/Exited with code 1/),
        }),
      );
      expect(manager.status({ sessionId: started.sessionId })).toBeUndefined();
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("timed-out requests ignore stale late responses and do not poison later requests", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-timeout-"));
    const manager = createLspSessionManager();

    try {
      const started = await manager.start(startInput(repoRoot, delayedResponseServerScript()));
      const slow = await manager.request({
        sessionId: started.sessionId,
        method: "slow",
        timeoutMs: 20,
      });
      const fast = await manager.request({
        sessionId: started.sessionId,
        method: "fast",
        timeoutMs: 500,
      });
      await delay(120);
      const afterLate = await manager.request({
        sessionId: started.sessionId,
        method: "fast",
        timeoutMs: 500,
      });

      expect(slow.status).toBe("timed_out");
      expect(fast.status).toBe("completed");
      expect(fast.response?.result).toEqual({ method: "fast" });
      expect(afterLate.status).toBe("completed");
      expect(afterLate.response?.result).toEqual({ method: "fast" });
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("completes a final response written immediately before the child exits", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-final-response-"));
    const manager = createLspSessionManager();

    try {
      const started = await manager.start(startInput(repoRoot, finalResponseThenExitServerScript(), 20));
      const response = await manager.request({
        sessionId: started.sessionId,
        method: "final",
        timeoutMs: 1_000,
      });

      expect(response.status).toBe("completed");
      expect(response.response?.result).toEqual({ ok: true });
      await waitFor(() => {
        expect(manager.status({ sessionId: started.sessionId })).toBeUndefined();
      });
    } finally {
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("child exit resolves pending requests and removes retained sessions", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-exit-"));
    const manager = createLspSessionManager();
    const leases: Array<{ release: () => void }> = [];

    try {
      const input = startInput(repoRoot, exitOnRequestServerScript(), 20);
      const acquired = await manager.getOrStart(input);
      leases.push(acquired);
      const pending = manager.request({
        sessionId: acquired.info.sessionId,
        method: "hangThenExit",
        timeoutMs: 1_000,
      });
      const failed = await pending;
      const retry = await manager.getOrStart(input);

      expect(failed.status).toBe("failed");
      expect(manager.status({ sessionId: acquired.info.sessionId })).toBeUndefined();
      expect(retry.info.status).toBe("running");
      expect(retry.info.sessionId).not.toBe(acquired.info.sessionId);
      leases.push(retry);
    } finally {
      for (const lease of leases) {
        lease.release();
      }
      await forceStopAll(manager);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("notification write failure terminates and removes the failed session", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-write-failure-"));
    const markerPath = path.join(repoRoot, "stdin-closed.marker");
    const manager = createLspSessionManager();

    try {
      const started = await manager.start(startInput(repoRoot, closeStdinAfterRequestServerScript(markerPath), 20));
      const pending = manager.request({
        sessionId: started.sessionId,
        method: "holdAndCloseStdin",
        timeoutMs: 2_000,
      });
      await waitFor(() => {
        expect(existsSync(markerPath)).toBe(true);
      }, 3_000);
      const notified = await manager.notify({
        sessionId: started.sessionId,
        method: "initialized",
        params: { payload: "x".repeat(1024 * 1024) },
      });
      const pendingResult = await pending;

      expect(notified.status).toBe("failed");
      expect(pendingResult.status).toBe("failed");
      await waitFor(() => {
        expect(manager.status({ sessionId: started.sessionId })).toBeUndefined();
      });
    } finally {
      await manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

async function startLoggedServer(
  manager: ReturnType<typeof createLspSessionManager>,
  repoRoot: string,
  logPath: string,
): Promise<LspSessionInfo> {
  const started = await manager.start(startInput(repoRoot, loggingJsonRpcServerScript(logPath), 20));
  expect(started.status).toBe("running");
  return started;
}

function startInput(repoRoot: string, script: string, startupTimeoutMs = 20) {
  return {
    repoRoot,
    language: "typescript",
    command: process.execPath,
    args: ["-e", script],
    startupTimeoutMs,
  };
}

function basicJsonRpcServerScript(): string {
  return [
    "let buffer='';",
    "function send(msg){const body=JSON.stringify(msg);process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
    parseLoopScript("if(req.id!==undefined&&req.method!=='never')send({jsonrpc:'2.0',id:req.id,result:{method:req.method,ok:true}});"),
    "setInterval(()=>{},1000);",
  ].join("");
}

function nonAsciiResponseServerScript(): string {
  return [
    "let buffer='';",
    "function send(msg){const body=JSON.stringify(msg);process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
    parseLoopScript("if(req.id!==undefined)send({jsonrpc:'2.0',id:req.id,result:{label:'caf\\u00e9'}});"),
    "setInterval(()=>{},1000);",
  ].join("");
}

function loggingJsonRpcServerScript(logPath: string): string {
  return [
    "const fs=require('node:fs');",
    `const logPath=${JSON.stringify(logPath)};`,
    "let buffer='';",
    "function log(msg){fs.appendFileSync(logPath,`${JSON.stringify(msg)}\\n`);}",
    "function send(msg){const body=JSON.stringify(msg);process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
    parseLoopScript("log(req);if(req.id!==undefined&&req.method!=='never')send({jsonrpc:'2.0',id:req.id,result:{method:req.method,ok:true}});"),
    "setInterval(()=>{},1000);",
  ].join("");
}

function slowLoggingJsonRpcServerScript(logPath: string): string {
  return [
    "const fs=require('node:fs');",
    `const logPath=${JSON.stringify(logPath)};`,
    "let buffer='';",
    "function log(msg){fs.appendFileSync(logPath,`${JSON.stringify(msg)}\\n`);}",
    "function send(msg){const body=JSON.stringify(msg);process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
    parseLoopScript(
      "if(req.method==='textDocument/didOpen')setTimeout(()=>log(req),60);else log(req);if(req.id!==undefined&&req.method!=='never')send({jsonrpc:'2.0',id:req.id,result:{method:req.method,ok:true}});",
    ),
    "setInterval(()=>{},1000);",
  ].join("");
}

function pausedMethodLoggingJsonRpcServerScript(logPath: string): string {
  return [
    "const fs=require('node:fs');",
    `const logPath=${JSON.stringify(logPath)};`,
    "let buffer='';",
    "process.stdin.pause();setTimeout(()=>process.stdin.resume(),100);",
    "function log(msg){fs.appendFileSync(logPath,`${JSON.stringify({method:msg.method})}\\n`);}",
    "function send(msg){const body=JSON.stringify(msg);process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
    parseLoopScript("log(req);if(req.id!==undefined&&req.method!=='never')send({jsonrpc:'2.0',id:req.id,result:{method:req.method,ok:true}});"),
    "setInterval(()=>{},1000);",
  ].join("");
}

function delayedResponseServerScript(): string {
  return [
    "let buffer='';",
    "function send(msg){const body=JSON.stringify(msg);process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
    parseLoopScript(
      "if(req.method==='slow')setTimeout(()=>send({jsonrpc:'2.0',id:req.id,result:{method:'slow'}}),80);else send({jsonrpc:'2.0',id:req.id,result:{method:req.method}});",
    ),
    "setInterval(()=>{},1000);",
  ].join("");
}

function exitOnRequestServerScript(): string {
  return [
    "let buffer='';",
    "function send(msg){const body=JSON.stringify(msg);process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
    parseLoopScript(
      "if(req.method==='hangThenExit')setTimeout(()=>process.exit(1),20);else if(req.id!==undefined)send({jsonrpc:'2.0',id:req.id,result:{method:req.method}});",
    ),
    "setInterval(()=>{},1000);",
  ].join("");
}

function finalResponseThenExitServerScript(): string {
  return [
    "const fs=require('node:fs');",
    "let buffer='';",
    "function send(msg){const body=JSON.stringify(msg);fs.writeSync(1,`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
    parseLoopScript("if(req.id!==undefined){send({jsonrpc:'2.0',id:req.id,result:{ok:true}});process.exit(0);}"),
  ].join("");
}

function closeStdinAfterRequestServerScript(markerPath: string): string {
  return [
    "const fs=require('node:fs');",
    `const markerPath=${JSON.stringify(markerPath)};`,
    "let buffer='';",
    "process.stdin.once('close',()=>fs.writeFileSync(markerPath,'closed'));",
    parseLoopScript("if(req.method==='holdAndCloseStdin')setTimeout(()=>process.stdin.destroy(),10);"),
    "setInterval(()=>{},1000);",
  ].join("");
}

function idleStdinServerScript(): string {
  return "setInterval(()=>{},1000);";
}

function ignoreSigtermServerScript(): string {
  return "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);";
}

function ignoreSigtermExitOnRequestServerScript(): string {
  return [
    "process.on('SIGTERM',()=>{});",
    "let buffer='';",
    parseLoopScript("if(req.method==='exitNonZero')setTimeout(()=>process.exit(1),20);"),
    "setInterval(()=>{},1000);",
  ].join("");
}

function failOnceThenStayAliveScript(markerPath: string): string {
  return [
    "const fs=require('node:fs');",
    `const markerPath=${JSON.stringify(markerPath)};`,
    "if(!fs.existsSync(markerPath)){fs.writeFileSync(markerPath,'started');process.exit(1);}else{setInterval(()=>{},1000);}",
  ].join("");
}

function parseLoopScript(onRequest: string): string {
  return [
    "process.stdin.on('data',(chunk)=>{",
    "buffer+=chunk.toString();",
    "while(true){",
    "const headerEnd=buffer.indexOf('\\r\\n\\r\\n');",
    "if(headerEnd<0)return;",
    "const header=buffer.slice(0,headerEnd);",
    "const match=header.match(/Content-Length:\\s*(\\d+)/i);",
    "if(!match)return;",
    "const length=Number(match[1]);",
    "const bodyStart=headerEnd+4;",
    "if(buffer.length<bodyStart+length)return;",
    "const req=JSON.parse(buffer.slice(bodyStart,bodyStart+length));",
    "buffer=buffer.slice(bodyStart+length);",
    onRequest,
    "}",
    "});",
  ].join("");
}

function readJsonLines(filePath: string): JsonRecord[] {
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
}

async function waitFor(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(10);
    }
  }
  throw lastError;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function forceStopAll(manager: ReturnType<typeof createLspSessionManager>): Promise<void> {
  await Promise.all(manager.list().map((info) => manager.stop({ sessionId: info.sessionId, force: true })));
}
