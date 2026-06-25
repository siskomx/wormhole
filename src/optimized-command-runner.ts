import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createOptimizationStore } from "./optimization.js";
import type { OptimizationStats } from "./optimization-stats.js";

export type OptimizedCommandInput = {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  stdin?: string;
};

export type OptimizedCommandResult = {
  status: "completed" | "failed" | "timed_out";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  optimizedStdout: string;
  stdoutHash: string;
  stderrHash: string;
  durationMs: number;
  optimization: ReturnType<ReturnType<typeof createOptimizationStore>["apply"]>;
};

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createOptimizedCommandRunner(input: { stats?: OptimizationStats } = {}) {
  const store = createOptimizationStore();

  return {
    run(commandInput: OptimizedCommandInput): Promise<OptimizedCommandResult> {
      const startedAt = Date.now();
      const timeoutMs = commandInput.timeoutMs ?? 30_000;

      return new Promise((resolve) => {
        const child = spawn(commandInput.command, commandInput.args ?? [], {
          cwd: commandInput.cwd ?? process.cwd(),
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (status: OptimizedCommandResult["status"], exitCode: number | null) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          const optimization = store.apply({
            kind: "command_output_compaction",
            content: stdout,
            sourceId: `command:${commandInput.command}`,
          });
          input.stats?.record(optimization);
          resolve({
            status,
            exitCode,
            stdout,
            stderr,
            optimizedStdout: optimization.content,
            stdoutHash: sha256(stdout),
            stderrHash: sha256(stderr),
            durationMs: Date.now() - startedAt,
            optimization,
          });
        };

        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          stderr += `Command timed out after ${timeoutMs}ms`;
          finish("timed_out", null);
        }, timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        child.on("error", (error) => {
          stderr += error.message;
        });
        child.on("close", (code) => {
          finish(code === 0 ? "completed" : "failed", code);
        });
        if (commandInput.stdin) {
          child.stdin.write(commandInput.stdin);
        }
        child.stdin.end();
      });
    },
  };
}
