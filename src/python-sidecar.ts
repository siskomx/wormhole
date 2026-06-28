import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
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

export type PythonRuntimeStatus = {
  required: true;
  ok: boolean;
  command: string;
  args: string[];
  cwd: string;
  pythonPathRoot: string;
  timeoutMs: number;
  setupHint: string;
  runtime?: string;
  packageName?: string;
  sidecarVersion?: string;
  pythonVersion?: string;
  error?: string;
  timedOut?: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  evidenceHash?: string;
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
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUIRED_RUNTIME_TIMEOUT_MS = 5_000;
const PYTHON_RUNTIME_SETUP_HINT =
  "Install Python 3, keep the repo-local python/wormhole_sidecar package available, or set WORMHOLE_PYTHON and WORMHOLE_PYTHONPATH.";

type ResolvedPythonSidecarConfig = {
  command: string;
  args: string[];
  timeoutMs: number;
  cwd: string;
  pythonPathRoot: string;
};

type ProbePayload = {
  runtime?: unknown;
  package?: unknown;
  version?: unknown;
  pythonVersion?: unknown;
};

export class PythonRuntimeRequiredError extends Error {
  readonly status: PythonRuntimeStatus;

  constructor(status: PythonRuntimeStatus) {
    super(
      [
        "Python runtime is required for Wormhole startup, but the sidecar probe failed.",
        status.error,
        status.setupHint,
      ]
        .filter(Boolean)
        .join(" "),
    );
    this.name = "PythonRuntimeRequiredError";
    this.status = status;
  }
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function defaultCommand(): string {
  return process.env.WORMHOLE_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
}

function defaultArgs(): string[] {
  return ["-m", "wormhole_sidecar.runner"];
}

function defaultPythonPathRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const parentDir = path.dirname(moduleDir);
  const repoRoot = path.basename(parentDir) === "dist" ? path.dirname(parentDir) : parentDir;
  return path.join(repoRoot, "python");
}

function resolvePythonPathRoot(config: PythonSidecarConfig): string {
  return config.pythonPathRoot ?? process.env.WORMHOLE_PYTHONPATH ?? defaultPythonPathRoot();
}

function resolvePythonSidecarConfig(config: PythonSidecarConfig = {}): ResolvedPythonSidecarConfig {
  return {
    command: config.command ?? defaultCommand(),
    args: config.args ?? defaultArgs(),
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    cwd: config.cwd ?? process.cwd(),
    pythonPathRoot: resolvePythonPathRoot(config),
  };
}

function buildPythonPath(pythonPathRoot: string): string | undefined {
  const existing = process.env.PYTHONPATH;
  if (existing) {
    return `${pythonPathRoot}${path.delimiter}${existing}`;
  }
  return pythonPathRoot;
}

function buildEnv(resolved: ResolvedPythonSidecarConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pythonPath = buildPythonPath(resolved.pythonPathRoot);
  if (pythonPath) {
    env.PYTHONPATH = pythonPath;
  }
  return env;
}

function isProbePayload(value: unknown): value is ProbePayload {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function runtimeStatusFromProbe(
  result: PythonSidecarJobResult,
  resolved: ResolvedPythonSidecarConfig,
): PythonRuntimeStatus {
  const payload = isProbePayload(result.result) ? result.result : {};
  const packageName = stringValue(payload.package);
  const runtime = stringValue(payload.runtime);
  const probeLooksValid = runtime === "python" && packageName === "wormhole_sidecar";
  const failureReason = (result.error ?? result.stderr.trim()) || "unknown error";
  const error = result.ok
    ? probeLooksValid
      ? undefined
      : "Python sidecar probe did not report the wormhole_sidecar package."
    : `Python runtime probe failed: ${failureReason}`;

  return {
    required: true,
    ok: result.ok && probeLooksValid,
    command: resolved.command,
    args: resolved.args,
    cwd: resolved.cwd,
    pythonPathRoot: resolved.pythonPathRoot,
    timeoutMs: resolved.timeoutMs,
    setupHint: PYTHON_RUNTIME_SETUP_HINT,
    runtime,
    packageName,
    sidecarVersion: stringValue(payload.version),
    pythonVersion: stringValue(payload.pythonVersion),
    error,
    timedOut: result.timedOut,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    evidenceHash: result.evidenceHash,
  };
}

export function createPythonSidecar(config: PythonSidecarConfig = {}): PythonSidecar {
  const resolved = resolvePythonSidecarConfig(config);

  return {
    async run(input: PythonSidecarJobRequest): Promise<PythonSidecarJobResult> {
      if (!allowedJobs.has(input.job)) {
        throw new Error(`Unsupported Python sidecar job: ${input.job}`);
      }

      const startedAt = Date.now();
      const requestJson = JSON.stringify(input);

      return await new Promise((resolve) => {
        const child = spawn(resolved.command, [...resolved.args, requestJson], {
          cwd: resolved.cwd,
          shell: false,
          env: buildEnv(resolved),
        });

        const stdoutCapture = createCapturedOutput();
        const stderrCapture = createCapturedOutput();
        let settled = false;
        let timedOut = false;

        const finalize = (exitCode: number | null) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          const durationMs = Date.now() - startedAt;
          const stdout = stdoutCapture.value();
          const stderr = stderrCapture.value();
          const stdoutTruncated = stdoutCapture.truncated();
          const stderrTruncated = stderrCapture.truncated();
          const evidenceHash = sha256(
            JSON.stringify({
              input,
              stdout,
              stderr,
              stdoutTruncated,
              stderrTruncated,
              exitCode,
              timedOut,
            }),
          );

          if (timedOut) {
            resolve({
              ok: false,
              job: input.job,
              error: `Python sidecar job ${input.job} timed out after ${resolved.timeoutMs}ms`,
              timedOut,
              exitCode,
              stdout,
              stderr,
              stdoutTruncated,
              stderrTruncated,
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
              stdoutTruncated,
              stderrTruncated,
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
              stdoutTruncated,
              stderrTruncated,
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
              stdoutTruncated,
              stderrTruncated,
              durationMs,
              evidenceHash,
            });
          }
        };

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, resolved.timeoutMs);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdoutCapture.append(chunk);
        });
        child.stderr.on("data", (chunk: string) => {
          stderrCapture.append(chunk);
        });
        child.on("error", (error) => {
          stderrCapture.append(error.message);
          finalize(null);
        });
        child.on("close", (code) => {
          finalize(code);
        });
      });
    },
  };
}

function createCapturedOutput(): {
  append(chunk: string): void;
  value(): string;
  truncated(): boolean;
} {
  const chunks: string[] = [];
  let capturedChars = 0;
  let truncated = false;
  return {
    append(chunk) {
      const remaining = MAX_CAPTURED_OUTPUT_CHARS - capturedChars;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (chunk.length > remaining) {
        chunks.push(chunk.slice(0, remaining));
        capturedChars += remaining;
        truncated = true;
        return;
      }
      chunks.push(chunk);
      capturedChars += chunk.length;
    },
    value() {
      return chunks.join("");
    },
    truncated() {
      return truncated;
    },
  };
}

export async function probePythonRuntime(
  config: PythonSidecarConfig = {},
): Promise<PythonRuntimeStatus> {
  const resolved = resolvePythonSidecarConfig({
    ...config,
    timeoutMs: config.timeoutMs ?? DEFAULT_REQUIRED_RUNTIME_TIMEOUT_MS,
  });
  const sidecar = createPythonSidecar(resolved);
  const result = await sidecar.run({ job: "probe", payload: {} });
  return runtimeStatusFromProbe(result, resolved);
}

export async function requirePythonRuntime(
  config: PythonSidecarConfig = {},
): Promise<PythonRuntimeStatus> {
  const status = await probePythonRuntime(config);
  if (!status.ok) {
    throw new PythonRuntimeRequiredError(status);
  }
  return status;
}
