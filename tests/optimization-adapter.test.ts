import { describe, expect, it } from "vitest";
import { createOptimizationAdapterRegistry } from "../src/optimization-adapter.js";

describe("optimization adapter registry", () => {
  it("registers, selects, and runs native optimization adapters", async () => {
    const registry = createOptimizationAdapterRegistry();
    registry.register({
      adapterId: "native-compact",
      transport: "native",
      capabilities: ["command_output_compaction"],
      installation: "installed",
    });

    const selected = registry.select({ capability: "command_output_compaction" });
    const result = await registry.run({
      adapterId: selected.adapterId,
      kind: "command_output_compaction",
      content: ["head", ...Array.from({ length: 120 }, (_, index) => `line ${index}`), "tail"].join("\n"),
    });

    expect(selected.adapterId).toBe("native-compact");
    expect(result.status).toBe("completed");
    expect(result.result?.kind).toBe("command_output_compaction");
  });

  it("runs CLI optimization adapters without a shell", async () => {
    const registry = createOptimizationAdapterRegistry();
    registry.register({
      adapterId: "upper-cli",
      transport: "cli",
      capabilities: ["dense_summary"],
      installation: "installed",
      command: process.execPath,
      args: ["-e", "process.stdin.on('data', chunk => process.stdout.write(String(chunk).toUpperCase()))"],
    });

    const result = await registry.run({
      adapterId: "upper-cli",
      kind: "dense_summary",
      content: "hello adapter",
      timeoutMs: 2_000,
    });

    expect(result.status).toBe("completed");
    expect(result.output).toBe("HELLO ADAPTER");
  });
});
