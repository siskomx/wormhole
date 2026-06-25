import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

describe("tool factory handlers", () => {
  it("validates and writes generated scaffolds through the tool layer", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-factory-handler-"));
    const targetDir = path.join(repoRoot, "generated");

    try {
      const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
      const scaffold = tools.toolFactoryGenerate({
        toolId: "handler-tool",
        displayName: "Handler Tool",
        description: "Handler generated tool.",
        commandName: "handler-tool",
        capabilities: ["coding-agent-tool"],
        inputs: [{ name: "query", type: "string", required: true }],
      });
      const validation = tools.toolFactoryValidate(scaffold);
      const written = tools.toolFactoryWrite({ scaffold, targetDir });

      expect(validation.valid).toBe(true);
      expect(existsSync(path.join(targetDir, "src", "mcp-server.ts"))).toBe(true);
      expect(written.files).toContain(path.join(targetDir, "manifest.json"));
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
