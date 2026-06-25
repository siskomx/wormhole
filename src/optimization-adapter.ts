import { createOptimizedCommandRunner } from "./optimized-command-runner.js";
import {
  optimizeText,
  type OptimizationKind,
  type OptimizationRequestKind,
  type OptimizationResult,
} from "./optimization.js";

export type OptimizationAdapterDescriptor = {
  adapterId: string;
  transport: "native" | "cli" | "http";
  capabilities: OptimizationKind[];
  installation: "installed" | "available" | "disabled";
  command?: string;
  args?: string[];
  endpoint?: string;
};

export type OptimizationAdapterSnapshot = {
  adapters: OptimizationAdapterDescriptor[];
};

export type OptimizationAdapterRunResult = {
  adapterId: string;
  status: "completed" | "failed" | "unavailable";
  result?: OptimizationResult;
  output?: string;
  error?: string;
};

export function createOptimizationAdapterRegistry(
  snapshot: Partial<OptimizationAdapterSnapshot> = {},
  onChange?: (snapshot: OptimizationAdapterSnapshot) => void,
) {
  const adapters = new Map<string, OptimizationAdapterDescriptor>(
    (snapshot.adapters ?? []).map((adapter) => [adapter.adapterId, { ...adapter }]),
  );

  function snapshotState(): OptimizationAdapterSnapshot {
    return { adapters: [...adapters.values()].map((adapter) => ({ ...adapter })) };
  }

  return {
    register(input: OptimizationAdapterDescriptor): OptimizationAdapterDescriptor {
      adapters.set(input.adapterId, { ...input });
      onChange?.(snapshotState());
      return { ...input };
    },
    list(): OptimizationAdapterDescriptor[] {
      return snapshotState().adapters;
    },
    select(input: { capability: OptimizationKind }): OptimizationAdapterDescriptor {
      const selected = [...adapters.values()].find(
        (adapter) =>
          adapter.installation === "installed" && adapter.capabilities.includes(input.capability),
      );
      if (!selected) {
        throw new Error(`No installed optimization adapter provides ${input.capability}`);
      }
      return { ...selected };
    },
    async run(input: {
      adapterId: string;
      kind: OptimizationRequestKind;
      content: string;
      timeoutMs?: number;
    }): Promise<OptimizationAdapterRunResult> {
      const adapter = adapters.get(input.adapterId);
      if (!adapter || adapter.installation !== "installed") {
        return {
          adapterId: input.adapterId,
          status: "unavailable",
          error: `Optimization adapter is not installed: ${input.adapterId}`,
        };
      }
      if (adapter.transport === "native") {
        return {
          adapterId: adapter.adapterId,
          status: "completed",
          result: optimizeText({ kind: input.kind, content: input.content }),
        };
      }
      if (adapter.transport === "cli") {
        if (!adapter.command) {
          return {
            adapterId: adapter.adapterId,
            status: "failed",
            error: "CLI adapter requires a command.",
          };
        }
        const result = await createOptimizedCommandRunner().run({
          command: adapter.command,
          args: adapter.args,
          stdin: input.content,
          timeoutMs: input.timeoutMs,
        });
        return {
          adapterId: adapter.adapterId,
          status: result.status === "completed" ? "completed" : "failed",
          output: result.stdout,
          error: result.stderr || undefined,
        };
      }
      return {
        adapterId: adapter.adapterId,
        status: "unavailable",
        error: "HTTP optimization adapters require host integration and are not executed by the local runtime.",
      };
    },
    snapshot: snapshotState,
  };
}
