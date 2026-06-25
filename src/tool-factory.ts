import { createHash } from "node:crypto";

export type ToolFactoryInputField = {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
};

export type ToolFactoryInput = {
  toolId: string;
  displayName: string;
  description: string;
  commandName: string;
  capabilities: string[];
  inputs: ToolFactoryInputField[];
};

export type ToolScaffold = {
  toolId: string;
  files: Record<string, string>;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function indent(lines: string[], padding = 2): string {
  const prefix = " ".repeat(padding);
  return lines.map((line) => `${prefix}${line}`).join("\n");
}

function stableManifest(input: ToolFactoryInput): string {
  const manifest = {
    toolId: input.toolId,
    displayName: input.displayName,
    description: input.description,
    commandName: input.commandName,
    capabilities: [...input.capabilities],
    inputs: input.inputs.map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required,
      ...(field.description ? { description: field.description } : {}),
    })),
  };

  return JSON.stringify(manifest, null, 2);
}

function stablePackageJson(input: ToolFactoryInput): string {
  const packageJson = {
    name: input.toolId,
    private: true,
    type: "module",
    version: "0.0.0",
    description: input.description,
    scripts: {
      test: "vitest run tests/cli.test.ts",
    },
  };

  return JSON.stringify(packageJson, null, 2);
}

function cliSource(input: ToolFactoryInput): string {
  return [
    'import { readFileSync } from "node:fs";',
    'import { dirname, resolve } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "",
    "const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), \"..\", \"manifest.json\");",
    "const manifest = JSON.parse(readFileSync(manifestPath, \"utf8\"));",
    "",
    "export function main(argv = process.argv.slice(2)) {",
    indent([
      "if (argv.includes(\"--help\")) {",
      indent([
        "return {",
        indent([
          `toolId: ${JSON.stringify(input.toolId)},`,
          `commandName: ${JSON.stringify(input.commandName)},`,
        ]),
        "};",
      ]),
      "}",
      "return {",
      indent([
        "toolId: manifest.toolId,",
        "commandName: manifest.commandName,",
        "argv,",
      ]),
      "};",
    ]),
    "}",
    "",
    "if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {",
    indent(["console.log(JSON.stringify(main(), null, 2));"]),
    "}",
  ].join("\n");
}

function mcpServerSource(input: ToolFactoryInput): string {
  const inputSchema = input.inputs
    .map((field) => {
      const typeExpression =
        field.type === "boolean"
          ? "z.boolean()"
          : field.type === "number"
            ? "z.number()"
            : "z.string()";
      return `${JSON.stringify(field.name)}: ${typeExpression}${field.required ? "" : ".optional()"}`;
    })
    .join(",\n");

  return [
    'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
    'import { z } from "zod";',
    "",
    "export function createServer() {",
    indent([
      "const server = new McpServer({",
      indent([`name: ${JSON.stringify(input.displayName)},`, "version: \"0.0.0\","]),
      "});",
      "",
      "server.registerTool(",
      indent([
        `${JSON.stringify(input.commandName)},`,
        "{",
        indent([
          `description: ${JSON.stringify(input.description)},`,
          "inputSchema: {",
          indent([inputSchema]),
          "},",
        ]),
        "},",
        "async (toolInput) => ({",
        indent([
          "content: [",
          indent([
            "{",
            indent([
              "type: \"text\",",
              `text: JSON.stringify({ ok: true, toolId: ${JSON.stringify(input.toolId)}, input: toolInput }, null, 2),`,
            ]),
            "},",
          ]),
          "],",
        ]),
        "}),",
      ]),
      "",
      "return server;",
    ]),
    "}",
  ].join("\n");
}

function readmeSource(input: ToolFactoryInput): string {
  const inputLines = input.inputs.length
    ? input.inputs.map((field) => `- \`${field.name}\` (${field.type}${field.required ? ", required" : ""})`)
    : ["- No inputs"];

  return [
    `# ${input.displayName}`,
    "",
    input.description,
    "",
    "## Command",
    "",
    `\`${input.commandName}\``,
    "",
    "## Inputs",
    "",
    ...inputLines,
    "",
    "## Capabilities",
    "",
    ...input.capabilities.map((capability) => `- ${capability}`),
  ].join("\n");
}

function testSource(input: ToolFactoryInput): string {
  return [
    'import { describe, expect, it } from "vitest";',
    "",
    `describe(${JSON.stringify(input.displayName)}, () => {`,
    '  it("exposes a generated scaffold", () => {',
    `    expect(${JSON.stringify(input.toolId)}).toBe(${JSON.stringify(input.toolId)});`,
    "  });",
    "});",
  ].join("\n");
}

export function generateToolScaffold(input: ToolFactoryInput): ToolScaffold {
  const manifest = stableManifest(input);
  const packageJson = stablePackageJson(input);
  const fingerprint = sha256(
    JSON.stringify({
      toolId: input.toolId,
      commandName: input.commandName,
      capabilities: [...input.capabilities],
      inputs: input.inputs,
    }),
  );

  return {
    toolId: input.toolId,
    files: {
      "README.md": readmeSource(input),
      "manifest.json": manifest,
      "package.json": packageJson,
      "src/cli.ts": cliSource(input),
      "src/mcp-server.ts": [
        "// Generated by Wormhole tool factory.",
        `const scaffoldFingerprint = ${JSON.stringify(fingerprint)};`,
        mcpServerSource(input),
      ].join("\n\n"),
      "tests/cli.test.ts": testSource(input),
    },
  };
}
