import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

export type PythonSidecarJobName =
  | "probe"
  | "graph_metrics"
  | "trace_summary"
  | "graph_communities"
  | "media_dependency_report"
  | "pdf_extract"
  | "image_inspect"
  | "policy_train"
  | "policy_evaluate"
  | "policy_compare_baselines";

export type PythonSidecarJobRequest = {
  job: PythonSidecarJobName;
  payload: unknown;
};

export type PythonSidecarJobResult = {
  ok: boolean;
  job: PythonSidecarJobName;
  result?: unknown;
  error?: string;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  evidenceHash: string;
};

export type PythonSidecarConfig = {
  command?: string;
  args?: string[];
  timeoutMs?: number;
  cwd?: string;
  pythonPathRoot?: string;
};

export type PythonSidecar = {
  run(input: PythonSidecarJobRequest): Promise<PythonSidecarJobResult>;
};

const allowedJobs = new Set<PythonSidecarJobName>([
  "probe",
  "graph_metrics",
  "trace_summary",
  "graph_communities",
  "media_dependency_report",
  "pdf_extract",
  "image_inspect",
  "policy_train",
  "policy_evaluate",
  "policy_compare_baselines",
]);
const MAX_CAPTURED_OUTPUT_CHARS = 2_000_000;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function defaultCommand(): string {
  return process.env.WORMHOLE_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
}

function defaultArgs(): string[] {
  return ["-m", "wormhole_sidecar.runner"];
}

function buildPythonPath(config: PythonSidecarConfig): string | undefined {
  const root = config.pythonPathRoot ?? process.env.WORMHOLE_PYTHONPATH ?? path.resolve(process.cwd(), "python");
  const existing = process.env.PYTHONPATH;
  if (existing) {
    return `${root}${path.delimiter}${existing}`;
  }
  return root;
}

function buildEnv(config: PythonSidecarConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pythonPath = buildPythonPath(config);
  if (pythonPath) {
    env.PYTHONPATH = pythonPath;
  }
  return env;
}

export function createPythonSidecar(config: PythonSidecarConfig = {}): PythonSidecar {
  const command = config.command ?? defaultCommand();
  const baseArgs = config.args ?? defaultArgs();
  const timeoutMs = config.timeoutMs ?? 10_000;
  const cwd = config.cwd ?? process.cwd();

  return {
    async run(input: PythonSidecarJobRequest): Promise<PythonSidecarJobResult> {
      if (!allowedJobs.has(input.job)) {
        throw new Error(`Unsupported Python sidecar job: ${input.job}`);
      }

      const startedAt = Date.now();
      const requestJson = JSON.stringify(input);

      return await new Promise((resolve) => {
        const child = spawn(command, [...baseArgs, requestJson], {
          cwd,
          shell: false,
          env: buildEnv(config),
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        let timedOut = false;

        const finalize = (exitCode: number | null) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          const durationMs = Date.now() - startedAt;
          const evidenceHash = sha256(
            JSON.stringify({
              input,
              stdout,
              stderr,
              exitCode,
              timedOut,
            }),
          );

          if (timedOut) {
            resolve({
              ok: false,
              job: input.job,
              error: `Python sidecar job ${input.job} timed out after ${timeoutMs}ms`,
              timedOut,
              exitCode,
              stdout,
              stderr,
              durationMs,
              evidenceHash,
            });
            return;
          }

          if (exitCode !== 0) {
            resolve({
              ok: false,
              job: input.job,
              error: stderr.trim() || `Python sidecar exited with code ${exitCode}`,
              timedOut,
              exitCode,
              stdout,
              stderr,
              durationMs,
              evidenceHash,
            });
            return;
          }

          try {
            const parsed = JSON.parse(stdout) as {
              ok: boolean;
              job?: PythonSidecarJobName;
              result?: unknown;
              error?: string;
            };
            resolve({
              ok: Boolean(parsed.ok),
              job: parsed.job ?? input.job,
              result: parsed.result,
              error: parsed.error,
              timedOut,
              exitCode,
              stdout,
              stderr,
              durationMs,
              evidenceHash,
            });
          } catch {
            resolve({
              ok: false,
              job: input.job,
              error: "Invalid sidecar JSON",
              timedOut,
              exitCode,
              stdout,
              stderr,
              durationMs,
              evidenceHash,
            });
          }
        };

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeoutMs);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          if (stdout.length < MAX_CAPTURED_OUTPUT_CHARS) {
            stdout = (stdout + chunk).slice(0, MAX_CAPTURED_OUTPUT_CHARS);
          }
        });
        child.stderr.on("data", (chunk: string) => {
          if (stderr.length < MAX_CAPTURED_OUTPUT_CHARS) {
            stderr = (stderr + chunk).slice(0, MAX_CAPTURED_OUTPUT_CHARS);
          }
        });
        child.on("error", (error) => {
          stderr += error.message;
          finalize(null);
        });
        child.on("close", (code) => {
          finalize(code);
        });
      });
    },
  };
}
