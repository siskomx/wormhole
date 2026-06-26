import path from "node:path";

export type CodexAdapterConfig = {
  pluginName: "wormhole";
  pluginPath: string;
  mcpServer: {
    command: "node";
    args: string[];
  };
  defaultPrompts: string[];
};

export type CodexAdapterValidation = {
  valid: boolean;
  errors: string[];
};

export function createCodexAdapterConfig(repoRoot: string): CodexAdapterConfig {
  const absoluteRoot = path.resolve(repoRoot);
  return {
    pluginName: "wormhole",
    pluginPath: path.join(absoluteRoot, "plugins", "wormhole"),
    mcpServer: {
      command: "node",
      args: [path.join(absoluteRoot, "dist", "src", "cli.js")],
    },
    defaultPrompts: [
      "Use Wormhole to implement this repo change: choose the workflow, gather evidence, act, verify, then summarize.",
      "Run the appropriate Wormhole workflow; for coding work continue into implementation and verification instead of stopping at a plan.",
      "Only emit a cited plan when the user explicitly asks for a plan, spec, design, or planning-only artifact.",
    ],
  };
}

export function validateCodexAdapterConfig(config: CodexAdapterConfig): CodexAdapterValidation {
  const errors: string[] = [];
  if (config.pluginName !== "wormhole") {
    errors.push("pluginName must be wormhole");
  }
  if (!config.pluginPath.replaceAll("\\", "/").endsWith("plugins/wormhole")) {
    errors.push("pluginPath must point to plugins/wormhole");
  }
  if (config.mcpServer.command !== "node") {
    errors.push("mcpServer.command must be node");
  }
  if (!config.mcpServer.args[0]?.replaceAll("\\", "/").endsWith("dist/src/cli.js")) {
    errors.push("mcpServer.args[0] must point to dist/src/cli.js");
  }
  if (config.defaultPrompts.length !== 3) {
    errors.push("defaultPrompts must include exactly three prompts");
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
