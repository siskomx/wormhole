import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateToolScaffold,
  validateToolScaffold,
  writeToolScaffold,
  type ToolFactoryInput,
} from "../src/tool-factory.js";

describe("tool factory scaffold generation", () => {
  it("creates a deterministic scaffold with the required files and manifest fields", () => {
    const input: ToolFactoryInput = {
      toolId: "example-tool",
      displayName: "Example Tool",
      description: "Example tool scaffold",
      commandName: "example-tool",
      capabilities: ["repo-index", "planning"],
      inputs: [
        { name: "repoRoot", type: "string", required: true },
        { name: "dryRun", type: "boolean", required: false },
      ],
    };

    const first = generateToolScaffold(input);
    const second = generateToolScaffold(input);

    expect(first).toEqual(second);
    expect(first.toolId).toBe("example-tool");
    expect(Object.keys(first.files).sort()).toEqual([
      "README.md",
      "manifest.json",
      "package.json",
      "src/cli.ts",
      "src/mcp-server.ts",
      "tests/cli.test.ts",
    ]);
    expect(first.files["manifest.json"]).not.toContain("REPLACE_ME");
    expect(JSON.parse(first.files["manifest.json"])).toMatchObject({
      toolId: "example-tool",
      displayName: "Example Tool",
      description: "Example tool scaffold",
      commandName: "example-tool",
      capabilities: ["repo-index", "planning"],
      inputs: [
        { name: "repoRoot", type: "string", required: true },
        { name: "dryRun", type: "boolean", required: false },
      ],
    });
  });

  it("writes generated scaffolds to a safe target directory and validates them", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-factory-"));
    const input: ToolFactoryInput = {
      toolId: "example-tool",
      displayName: "Example Tool",
      description: "Example tool scaffold",
      commandName: "example-tool",
      capabilities: ["repo-index"],
      inputs: [{ name: "repoRoot", type: "string", required: true }],
    };

    try {
      const scaffold = generateToolScaffold(input);
      const written = writeToolScaffold(scaffold, { targetDir: root });
      const validation = validateToolScaffold(scaffold);

      expect(written.files).toContain(path.join(root, "src", "mcp-server.ts"));
      expect(existsSync(path.join(root, "manifest.json"))).toBe(true);
      expect(readFileSync(path.join(root, "README.md"), "utf8")).toContain("Example Tool");
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects generated scaffold paths that escape the target directory", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-tool-factory-escape-"));

    try {
      expect(() =>
        writeToolScaffold({
          toolId: "bad",
          files: {
            "../escape.txt": "bad",
          },
        }, { targetDir: root }),
      ).toThrow(/outside target directory/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
