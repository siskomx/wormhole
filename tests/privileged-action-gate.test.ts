import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createPrivilegedActionGate } from "../src/privileged-action-gate.js";
import { createToolHandlers } from "../src/tools.js";

describe("privileged action gate", () => {
  it("blocks high-risk commands in strict mode", () => {
    const gate = createPrivilegedActionGate({ mode: "strict" });

    const decision = gate.review({
      toolName: "optimized_command_run",
      kind: "command",
      operations: [{ kind: "command", command: "git", args: ["reset", "--hard"] }],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.approval).toBe("required");
    expect(() => gate.assertAllowed({
      toolName: "optimized_command_run",
      kind: "command",
      operations: [{ kind: "command", command: "git", args: ["reset", "--hard"] }],
    })).toThrow(/Privileged action blocked/);
  });

  it("blocks optimized_command_run before spawn in strict mode", () => {
    const tools = createToolHandlers(createInMemoryKernel(), {
      privilegedActionPolicy: { mode: "strict" },
    });

    expect(() =>
      tools.optimizedCommandRun({
        command: "git",
        args: ["reset", "--hard"],
      }),
    ).toThrow(/Privileged action blocked/);
  });

  it("blocks verification_run commands through the handler in strict mode", () => {
    const tools = createToolHandlers(createInMemoryKernel(), {
      privilegedActionPolicy: { mode: "strict" },
    });

    expect(() =>
      tools.verificationRun({
        commands: [
          {
            name: "danger",
            command: "git",
            args: ["reset", "--hard"],
          },
        ],
      }),
    ).toThrow(/Privileged action blocked/);
  });

  it("blocks disabled tools even in trusted local mode", () => {
    const targetDir = mkdtempSync(path.join(os.tmpdir(), "wormhole-gate-tool-factory-"));
    const tools = createToolHandlers(createInMemoryKernel(), {
      privilegedActionPolicy: {
        mode: "trusted_local",
        disabledTools: ["tool_factory_write"],
      },
    });
    const scaffold = tools.toolFactoryGenerate({
      toolId: "demo-tool",
      displayName: "Demo Tool",
      description: "Generated demo tool.",
      commandName: "demo",
      capabilities: ["demo"],
      inputs: [],
    });

    try {
      expect(() => tools.toolFactoryWrite({ scaffold, targetDir })).toThrow(/tool_factory_write is disabled/);
      expect(existsSync(path.join(targetDir, "manifest.json"))).toBe(false);
    } finally {
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
