import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectLanguageServerConfigs,
  lspProbe,
  normalizeLspLocation,
} from "../src/lsp-ground-truth.js";

describe("LSP ground truth", () => {
  it("detects language-server configs from project files without spawning servers", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-probe-"));
    writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({ devDependencies: { typescript: "^6.0.0" } }),
    );
    writeFileSync(path.join(repoRoot, "tsconfig.json"), "{}\n");
    writeFileSync(path.join(repoRoot, "pyproject.toml"), "[project]\nname='demo'\n");

    try {
      const configs = detectLanguageServerConfigs({ repoRoot });
      const probe = lspProbe({ repoRoot });

      expect(configs.map((config) => config.language)).toEqual(["typescript", "python"]);
      expect(configs[0]).toEqual(
        expect.objectContaining({
          command: "typescript-language-server",
          args: ["--stdio"],
          transport: "stdio",
        }),
      );
      expect(probe.status).toBe("configured");
      expect(probe.servers).toHaveLength(2);
      expect(probe.notes).toContain("No long-lived language server process was started.");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("normalizes protocol locations into one-based editor positions", () => {
    const location = normalizeLspLocation({
      uri: "file:///repo/src/app.ts",
      range: {
        start: { line: 0, character: 4 },
        end: { line: 0, character: 12 },
      },
    });

    expect(location).toEqual({
      file: "/repo/src/app.ts",
      line: 1,
      column: 5,
      endLine: 1,
      endColumn: 13,
    });
  });
});
