import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import type { AgentDescriptor, AgentRunRecord, AgentRunResult } from "./agent-adapter.js";

export type AgentTransportEvidence = {
  transport: string;
  stdout?: string;
  stderr?: string;
  stdoutHash?: string;
  stderrHash?: string;
  statusCode?: number;
  responseText?: string;
  responseHash?: string;
  exitCode?: number | null;
  durationMs: number;
};

const DEFAULT_AGENT_TIMEOUT_MS = 30_000;
const MAX_AGENT_TIMEOUT_MS = 10 * 60_000;

function clampAgentTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  if (!Number.isFinite(value)) {
    return DEFAULT_AGENT_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_AGENT_TIMEOUT_MS);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function runCliAgent(agent: AgentDescriptor, run: AgentRunRecord): Promise<AgentRunResult> {
  const runtime = agent.runtime;
  if (!runtime?.command) {
    throw new Error(`CLI agent ${agent.agentId} requires runtime.command`);
  }
  const startedAt = Date.now();
  const timeoutMs = clampAgentTimeout(run.timeoutMs ?? runtime.timeoutMs);
  const stdin = JSON.stringify({
    missionId: run.missionId,
    taskId: run.taskId,
    objective: run.objective,
    payload: run.payload,
  });

  return new Promise((resolve) => {
    const child = spawn(runtime.command!, runtime.args ?? [], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (exitCode: number | null, timedOut = false, startError?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const evidence: AgentTransportEvidence = {
        transport: "cli",
        stdout,
        stderr,
        stdoutHash: sha256(stdout),
        stderrHash: sha256(stderr),
        exitCode,
        durationMs,
      };
      resolve({
        status: exitCode === 0 && !timedOut ? "completed" : "failed",
        summary: startError
          ? `CLI agent failed to start: ${startError}`
          : timedOut
            ? `CLI agent timed out after ${timeoutMs}ms`
            : exitCode === 0
              ? "CLI agent completed."
              : `CLI agent failed with exit code ${exitCode}`,
        output: evidence,
      });
    };

    const timer = setTimeout(() => {
      stderr += `CLI agent timed out after ${timeoutMs}ms`;
      child.kill("SIGTERM");
      finish(null, true);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      stderr += error.message;
      finish(null, false, error.message);
    });
    child.stdin.on("error", (error) => {
      stderr += error.message;
      child.kill("SIGTERM");
      finish(null, false, error.message);
    });
    child.on("close", (code) => finish(code));
    child.stdin.end(stdin);
  });
}

async function runHttpAgent(agent: AgentDescriptor, run: AgentRunRecord): Promise<AgentRunResult> {
  const runtime = agent.runtime;
  if (!runtime?.endpoint) {
    throw new Error(`HTTP agent ${agent.agentId} requires runtime.endpoint`);
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutMs = clampAgentTimeout(run.timeoutMs ?? runtime.timeoutMs);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(runtime.endpoint, {
      method: runtime.method ?? "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        missionId: run.missionId,
        taskId: run.taskId,
        objective: run.objective,
        payload: run.payload,
      }),
    });
    const responseText = await response.text();
    const evidence: AgentTransportEvidence = {
      transport: "http",
      statusCode: response.status,
      responseText,
      responseHash: sha256(responseText),
      durationMs: Date.now() - startedAt,
    };
    return {
      status: response.ok ? "completed" : "failed",
      summary: response.ok ? "HTTP agent completed." : `HTTP agent failed with status ${response.status}`,
      output: evidence,
    };
  } catch (error) {
    return {
      status: "failed",
      summary: `HTTP agent failed: ${error instanceof Error ? error.message : String(error)}`,
      output: {
        transport: "http",
        durationMs: Date.now() - startedAt,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export function executeAgentTransport(
  agent: AgentDescriptor,
  run: AgentRunRecord,
): Promise<AgentRunResult> {
  if (agent.transport === "cli") {
    return runCliAgent(agent, run);
  }
  if (agent.transport === "http") {
    return runHttpAgent(agent, run);
  }
  throw new Error(`Agent transport execution is not implemented for ${agent.transport}`);
}
