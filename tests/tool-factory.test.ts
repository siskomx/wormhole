import { describe, expect, it } from "vitest";
import { generateToolScaffold, type ToolFactoryInput } from "../src/tool-factory.js";

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
});
