import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

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
  error?: string;
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

type ManagedSession = {
  info: LspSessionInfo;
  child: ChildProcessWithoutNullStreams;
  buffer: string;
  pending: Map<
    number,
    {
      resolve: (result: LspRequestResult) => void;
      timer: NodeJS.Timeout;
    }
  >;
  nextRequestId: number;
};

export function createLspSessionManager() {
  const sessions = new Map<string, ManagedSession>();

  function removeSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }
    for (const [id, pending] of session.pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        sessionId,
        status: "failed",
        error: `LSP session closed before response ${id}.`,
      });
    }
    session.pending.clear();
    sessions.delete(sessionId);
  }

  return {
    start(input: LspSessionStartInput): Promise<LspSessionInfo> {
      const sessionId = `lsp:${randomUUID()}`;
      const repoRoot = path.resolve(input.repoRoot);
      const info: LspSessionInfo = {
        sessionId,
        repoRoot,
        language: input.language,
        command: input.command,
        args: input.args ?? [],
        status: "running",
        startedAt: new Date().toISOString(),
      };

      return new Promise((resolve) => {
        let settled = false;
        const child = spawn(input.command, input.args ?? [], {
          cwd: repoRoot,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const session: ManagedSession = {
          info,
          child,
          buffer: "",
          pending: new Map(),
          nextRequestId: 1,
        };

        const settle = (next: LspSessionInfo) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(next);
        };

        const timer = setTimeout(() => {
          sessions.set(sessionId, session);
          settle({ ...info });
        }, Math.min(input.startupTimeoutMs ?? 50, 50));

        child.stdout.on("data", (chunk: Buffer) => {
          session.buffer += chunk.toString("utf8");
          drainResponses(session);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          session.info.error = `${session.info.error ?? ""}${chunk.toString("utf8")}`;
        });
        child.on("error", (error) => {
          const failed: LspSessionInfo = {
            ...info,
            status: "unavailable",
            error: error.message,
          };
          removeSession(sessionId);
          settle(failed);
        });
        child.on("close", (code) => {
          const current = sessions.get(sessionId);
          if (current) {
            current.info.status = code === 0 ? "stopped" : "failed";
            current.info.error = current.info.error ?? (code === 0 ? undefined : `Exited with code ${code}`);
          }
          removeSession(sessionId);
          if (!settled) {
            settle({
              ...info,
              status: code === 0 ? "stopped" : "failed",
              error: code === 0 ? undefined : `Exited with code ${code}`,
            });
          }
        });
      });
    },
    list(): LspSessionInfo[] {
      return [...sessions.values()].map((session) => ({ ...session.info }));
    },
    status(input: { sessionId: string }): LspSessionInfo | undefined {
      const session = sessions.get(input.sessionId);
      return session ? { ...session.info } : undefined;
    },
    request(input: {
      sessionId: string;
      method: string;
      params?: unknown;
      timeoutMs?: number;
    }): Promise<LspRequestResult> {
      const session = sessions.get(input.sessionId);
      if (!session) {
        return Promise.resolve({
          sessionId: input.sessionId,
          status: "failed",
          error: "LSP session is not running.",
        });
      }
      const id = session.nextRequestId++;
      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: input.method,
        params: input.params ?? {},
      });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          session.pending.delete(id);
          resolve({
            sessionId: input.sessionId,
            status: "timed_out",
            error: `LSP request timed out after ${input.timeoutMs ?? 5_000}ms.`,
          });
        }, input.timeoutMs ?? 5_000);
        session.pending.set(id, { resolve, timer });
        session.child.stdin.write(`Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
      });
    },
    stop(input: { sessionId: string }): Promise<LspSessionInfo> {
      const session = sessions.get(input.sessionId);
      if (!session) {
        return Promise.resolve({
          sessionId: input.sessionId,
          repoRoot: "",
          language: "",
          command: "",
          args: [],
          status: "stopped",
          startedAt: new Date().toISOString(),
        });
      }
      const info = { ...session.info, status: "stopped" as const };
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          removeSession(input.sessionId);
          resolve(info);
        }, 250);
        session.child.once("close", () => {
          clearTimeout(timer);
          removeSession(input.sessionId);
          resolve(info);
        });
        session.child.kill("SIGTERM");
      });
    },
    async stopAll(): Promise<void> {
      await Promise.all([...sessions.keys()].map((sessionId) => this.stop({ sessionId })));
    },
  };
}

function drainResponses(session: ManagedSession): void {
  while (true) {
    const headerEnd = session.buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }
    const header = session.buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match?.[1]) {
      session.buffer = "";
      return;
    }
    const contentLength = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (session.buffer.length < bodyEnd) {
      return;
    }
    const rawBody = session.buffer.slice(bodyStart, bodyEnd);
    session.buffer = session.buffer.slice(bodyEnd);
    const response = JSON.parse(rawBody) as NonNullable<LspRequestResult["response"]>;
    if (response.id === undefined) {
      continue;
    }
    const pending = session.pending.get(response.id);
    if (!pending) {
      continue;
    }
    clearTimeout(pending.timer);
    session.pending.delete(response.id);
    pending.resolve({
      sessionId: session.info.sessionId,
      status: "completed",
      response,
    });
  }
}
