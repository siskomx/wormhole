import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { DiagnosticRecord } from "../src/diagnostics.js";
import type { LanguageServerConfig } from "../src/lsp-ground-truth.js";
import { createLspSessionManager } from "../src/lsp-session-manager.js";
import { createSymbolContext, type SymbolContextInput } from "../src/lsp-symbol-context.js";
import { buildRepoIndex, type RepoIndex } from "../src/repo-index.js";

function createTempRepo(files: Record<string, string>): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-symbol-context-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repoRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return repoRoot;
}

function buildFixtureIndex(files: Record<string, string>): { repoRoot: string; index: RepoIndex } {
  const repoRoot = createTempRepo(files);
  return { repoRoot, index: buildRepoIndex({ repoRoot }) };
}

function diagnostic(index: number, severity: DiagnosticRecord["severity"]): DiagnosticRecord {
  return {
    diagnosticId: `diag-${index}`,
    source: "test",
    severity,
    message: `message ${index}`,
    file: "src/app.ts",
    line: index + 1,
    column: 2,
    code: `T${index}`,
    recordedAt: "2026-06-30T00:00:00.000Z",
  };
}

describe("lsp symbol context graph-only service", () => {
  it("resolves file and symbol exactly", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": [
        "export function alpha() {",
        "  return 'alpha';",
        "}",
        "",
        "export function beta() {",
        "  return alpha();",
        "}",
      ].join("\n"),
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", symbol: "beta" },
        { index },
      );

      expect(result.target).toEqual(
        expect.objectContaining({
          name: "beta",
          path: "src/app.ts",
          line: 5,
          confidence: "exact",
          source: "repo-index",
        }),
      );
      expect(result.candidates).toHaveLength(1);
      expect(result.query.aspects).toEqual(["definition", "hover"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns ambiguity candidates for symbol-only lookup without choosing a target", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/one.ts": "export function duplicate() { return 1; }\n",
      "src/two.ts": "export function duplicate() { return 2; }\n",
    });

    try {
      const result = await createSymbolContext({ repoRoot, symbol: "duplicate" }, { index });

      expect(result.target).toBeUndefined();
      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        "src/one.ts",
        "src/two.ts",
      ]);
      expect(result.candidates.every((candidate) => candidate.name === "duplicate")).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("uses nearest preceding symbol for file and line fallback with a graph range warning", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": [
        "export function first() {",
        "  return 1;",
        "}",
        "",
        "export function second() {",
        "  return 2;",
        "}",
      ].join("\n"),
    });

    try {
      const result = await createSymbolContext({ repoRoot, file: "src/app.ts", line: 7 }, { index });

      expect(result.target).toEqual(
        expect.objectContaining({
          name: "second",
          confidence: "position-nearest",
        }),
      );
      expect(result.warnings.join("\n")).toContain("graph symbols do not have end ranges");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("sets lsp status to not_configured when no LSP deps are passed", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });

    try {
      const result = await createSymbolContext({ repoRoot, symbol: "alpha" }, { index });

      expect(result.lsp.status).toBe("not_configured");
      expect(result.lsp.sessionId).toBeUndefined();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns inbound and outbound repo-index edges with truncation metadata", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const target = index.symbols.find((symbol) => symbol.name === "alpha");
    if (!target) {
      throw new Error("missing target symbol");
    }
    for (let count = 0; count < 55; count += 1) {
      index.edges.push({
        from: `src/inbound-${count}.ts`,
        to: target.id,
        kind: "references",
        provenance: "inferred",
        confidence: 0.7,
        label: "alpha",
      });
    }
    for (let count = 0; count < 52; count += 1) {
      index.edges.push({
        from: target.id,
        to: `src/outbound-${count}.ts`,
        kind: "calls",
        provenance: "inferred",
        confidence: 0.7,
        label: `outbound${count}`,
      });
    }

    try {
      const result = await createSymbolContext({ repoRoot, symbol: "alpha" }, { index });

      expect(result.graph.inboundEdges).toEqual(
        expect.objectContaining({
          totalCount: 56,
          omittedCount: 6,
          truncated: true,
        }),
      );
      expect(result.graph.inboundEdges.items).toHaveLength(50);
      expect(result.graph.inboundEdges.items.every((edge) => edge.source === "repo-index")).toBe(true);
      expect(result.graph.outboundEdges).toEqual(
        expect.objectContaining({
          totalCount: 52,
          omittedCount: 2,
          truncated: true,
        }),
      );
      expect(result.graph.outboundEdges.items).toHaveLength(50);
      expect(result.graph.outboundEdges.items.every((edge) => edge.source === "repo-index")).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("sorts edges deterministically before truncating", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const target = index.symbols.find((symbol) => symbol.name === "alpha");
    if (!target) {
      throw new Error("missing target symbol");
    }
    index.edges = index.edges.filter((edge) => edge.kind !== "defines");
    const shuffledEdges = [
      { from: "src/z.ts", kind: "references" as const, line: 9, label: "zeta" },
      { from: "src/b.ts", kind: "calls" as const, line: 1, label: "beta" },
      { from: "src/a.ts", kind: "calls" as const, line: 2, label: "alpha" },
      { from: "src/a.ts", kind: "calls" as const, line: 1, label: "alpha" },
      ...Array.from({ length: 56 }, (_, count) => ({
        from: `src/zz-${String(count).padStart(2, "0")}.ts`,
        kind: "references" as const,
        line: count + 10,
        label: `zz-${count}`,
      })),
    ];
    for (let count = 0; count < shuffledEdges.length; count += 1) {
      const fixture = shuffledEdges[count]!;
      index.edges.push({
        from: fixture.from,
        to: target.id,
        kind: fixture.kind,
        provenance: count % 3 === 0 ? "ambiguous" : "inferred",
        confidence: 0.7,
        line: fixture.line,
        label: fixture.label,
      });
    }
    index.edges.reverse();

    try {
      const result = await createSymbolContext({ repoRoot, symbol: "alpha" }, { index });

      expect(result.graph.inboundEdges.items.slice(0, 3)).toEqual([
        expect.objectContaining({ kind: "calls", from: "src/a.ts", line: 1, label: "alpha" }),
        expect.objectContaining({ kind: "calls", from: "src/a.ts", line: 2, label: "alpha" }),
        expect.objectContaining({ kind: "calls", from: "src/b.ts", line: 1, label: "beta" }),
      ]);
      expect(result.graph.inboundEdges).toEqual(
        expect.objectContaining({
          totalCount: 60,
          omittedCount: 10,
          truncated: true,
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("derives compact signature and documentation from indexed content", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": [
        "// Builds the alpha context.",
        "// Keeps graph-only facts compact.",
        "export function alpha() {",
        "  return 1;",
        "}",
      ].join("\n"),
    });

    try {
      const result = await createSymbolContext({ repoRoot, symbol: "alpha" }, { index });

      expect(result.target).toEqual(
        expect.objectContaining({
          signature: "export function alpha() {",
          documentation: "Builds the alpha context. Keeps graph-only facts compact.",
        }),
      );
      expect(result.candidates[0]).toEqual(
        expect.objectContaining({
          signature: "export function alpha() {",
          documentation: "Builds the alpha context. Keeps graph-only facts compact.",
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("only attaches immediately adjacent documentation comments", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": [
        "// Unrelated header comment.",
        "",
        "export function alpha() {",
        "  return 1;",
        "}",
      ].join("\n"),
    });

    try {
      const result = await createSymbolContext({ repoRoot, symbol: "alpha" }, { index });

      expect(result.target?.signature).toBe("export function alpha() {");
      expect(result.target?.documentation).toBeUndefined();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns the nearest 10 same-file symbols by line distance", async () => {
    const functions = [
      ...Array.from({ length: 8 }, (_, index) => `export function before${index}() { return ${index}; }`),
      "export function target() { return 42; }",
      ...Array.from({ length: 8 }, (_, index) => `export function after${index}() { return ${index}; }`),
    ];
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": `${functions.join("\n")}\n`,
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", symbol: "target" },
        { index },
      );

      expect(result.graph.nearbySymbols).toHaveLength(10);
      expect(result.graph.nearbySymbols.map((symbol) => symbol.name)).toEqual([
        "before7",
        "after0",
        "before6",
        "after1",
        "before5",
        "after2",
        "before4",
        "after3",
        "before3",
        "after4",
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("clamps out-of-range line and character and emits a warning", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": ["export function alpha() {", "  return 1;", "}"].join("\n"),
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 99, character: 99 },
        { index },
      );

      expect(result.query.line).toBe(3);
      expect(result.query.character).toBe(2);
      expect(result.warnings.join("\n")).toContain("clamped");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("uses indexed content for clamping when disk read fails and emits a warning", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": ["export function alpha() {", "  return 1;", "}"].join("\n"),
    });
    unlinkSync(path.join(repoRoot, "src", "app.ts"));

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 99, character: 99 },
        { index },
      );

      expect(result.query.line).toBe(3);
      expect(result.query.character).toBe(2);
      expect(result.target).toEqual(expect.objectContaining({ name: "alpha" }));
      expect(result.warnings.join("\n")).toContain("indexed content");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports missing graph status when no index is available", async () => {
    const repoRoot = createTempRepo({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });

    try {
      const result = await createSymbolContext({ repoRoot, symbol: "alpha" }, {});

      expect(result.graph.status).toBe("missing");
      expect(result.graph.fingerprint).toBe("");
      expect(result.graph.inboundEdges.omittedCount).toBe(0);
      expect(result.graph.outboundEdges.omittedCount).toBe(0);
      expect(result.target).toBeUndefined();
      expect(result.candidates).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("defaults present truncated indexes to fresh unless graphStatus is injected", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    index.truncated = true;

    try {
      const result = await createSymbolContext({ repoRoot, symbol: "alpha" }, { index });

      expect(result.graph.status).toBe("fresh");
      expect(result.graph.truncated).toBe(true);
      expect(result.warnings.join("\n")).toContain("Repo index is truncated");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("sanitizes malformed direct-service aspects and non-finite numeric fields", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const input = {
      repoRoot,
      symbol: "alpha",
      aspects: null,
      line: Number.NaN,
      character: Number.POSITIVE_INFINITY,
      referencesLimit: Number.NEGATIVE_INFINITY,
      startupTimeoutMs: Number.NaN,
      requestTimeoutMs: Number.POSITIVE_INFINITY,
    } as unknown as SymbolContextInput;

    try {
      const result = await createSymbolContext(input, { index });

      expect(result.query.aspects).toEqual(["definition", "hover"]);
      expect(result.query.line).toBeUndefined();
      expect(result.query.character).toBeUndefined();
      expect(result.query.referencesLimit).toBeUndefined();
      expect(result.query.startupTimeoutMs).toBeUndefined();
      expect(result.query.requestTimeoutMs).toBeUndefined();
      expect(result.target).toEqual(expect.objectContaining({ name: "alpha" }));
      expect(result.warnings.join("\n")).toContain("Invalid symbol_context aspects");
      expect(result.warnings.join("\n")).toContain("Invalid numeric symbol_context field line ignored.");
      expect(result.warnings.join("\n")).toContain(
        "Invalid numeric symbol_context field requestTimeoutMs ignored.",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("sanitizes finite invalid numeric direct-service fields", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const input = {
      repoRoot,
      symbol: "alpha",
      line: 1.5,
      character: 0,
      referencesLimit: -3,
      startupTimeoutMs: 0,
      requestTimeoutMs: -1,
    } as unknown as SymbolContextInput;

    try {
      const result = await createSymbolContext(input, { index });

      expect(result.query.line).toBeUndefined();
      expect(result.query.character).toBeUndefined();
      expect(result.query.referencesLimit).toBeUndefined();
      expect(result.query.startupTimeoutMs).toBeUndefined();
      expect(result.query.requestTimeoutMs).toBeUndefined();
      expect(result.target).toEqual(expect.objectContaining({ name: "alpha" }));
      expect(result.warnings.join("\n")).toContain("Invalid numeric symbol_context field line ignored.");
      expect(result.warnings.join("\n")).toContain("Invalid numeric symbol_context field character ignored.");
      expect(result.warnings.join("\n")).toContain(
        "Invalid numeric symbol_context field referencesLimit ignored.",
      );
      expect(result.warnings.join("\n")).toContain(
        "Invalid numeric symbol_context field startupTimeoutMs ignored.",
      );
      expect(result.warnings.join("\n")).toContain(
        "Invalid numeric symbol_context field requestTimeoutMs ignored.",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("warns and ignores malformed aspect entries while keeping valid aspects", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const input = {
      repoRoot,
      symbol: "alpha",
      aspects: ["definition", 123, "bogus"],
    } as unknown as SymbolContextInput;

    try {
      const result = await createSymbolContext(input, { index });

      expect(result.query.aspects).toEqual(["definition"]);
      expect(result.warnings.join("\n")).toContain("Non-string symbol_context aspect ignored.");
      expect(result.warnings.join("\n")).toContain("Unknown symbol_context aspect ignored: bogus");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("uses injected graph status and preserves the index fingerprint", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, symbol: "alpha" },
        { index, graphStatus: "stale" },
      );

      expect(result.graph.status).toBe("stale");
      expect(result.graph.fingerprint).toBe(index.fingerprint);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns insufficient_target for empty or unusable target input", async () => {
    const repoRoot = createTempRepo({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });

    try {
      const result = await createSymbolContext({ repoRoot, line: 1, character: 1 }, {});

      expect(result.target).toBeUndefined();
      expect(result.candidates).toEqual([]);
      expect(result.lsp.status).toBe("insufficient_target");
      expect(result.lsp.sessionId).toBeUndefined();
      expect(result.warnings).toContain(
        "symbol_context requires a file, symbol, or file + line + character target.",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("allows empty aspects without LSP deps for graph context and stored diagnostics", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, symbol: "alpha", aspects: [] },
        {
          index,
          diagnostics: [diagnostic(1, "info")],
        },
      );

      expect(result.query.aspects).toEqual([]);
      expect(result.target).toEqual(expect.objectContaining({ name: "alpha" }));
      expect(result.lsp.status).toBe("not_requested");
      expect(result.lsp.sessionId).toBeUndefined();
      expect(result.lsp.diagnostics).toEqual([
        expect.objectContaining({
          severity: "information",
          path: "src/app.ts",
          message: "message 1",
        }),
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not request live aspects when a direct-service aspect array has no valid entries", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const input = {
      repoRoot,
      symbol: "alpha",
      aspects: ["bogus", 123],
    } as unknown as SymbolContextInput;

    try {
      const result = await createSymbolContext(input, { index });

      expect(result.query.aspects).toEqual([]);
      expect(result.lsp.status).toBe("not_requested");
      expect(result.warnings.join("\n")).toContain("Unknown symbol_context aspect ignored: bogus");
      expect(result.warnings.join("\n")).toContain("Non-string symbol_context aspect ignored.");
      expect(result.warnings.join("\n")).toContain(
        "No valid symbol_context aspects were supplied; no live LSP aspects were requested.",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("keeps valid mixed aspects and warns for invalid entries", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const input = {
      repoRoot,
      symbol: "alpha",
      aspects: ["references", "bogus"],
    } as unknown as SymbolContextInput;

    try {
      const result = await createSymbolContext(input, { index });

      expect(result.query.aspects).toEqual(["references"]);
      expect(result.warnings.join("\n")).toContain("Unknown symbol_context aspect ignored: bogus");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not start or authorize live LSP deps when no configs are available", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const authorizeStart = vi.fn(() => {
      throw new Error("live startup should not be used");
    });
    const manager = createLspSessionManager();

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", symbol: "alpha" },
        { index, lsp: { configs: [], manager, authorizeStart } },
      );

      expect(result.target).toEqual(expect.objectContaining({ name: "alpha" }));
      expect(result.lsp.status).toBe("not_configured");
      expect(authorizeStart).not.toHaveBeenCalled();
      expect(manager.list()).toHaveLength(0);
    } finally {
      await manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("normalizes local absolute file input to repo-relative paths", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: path.join(repoRoot, "src", "app.ts"), symbol: "alpha" },
        { index },
      );

      expect(result.query.file).toBe("src/app.ts");
      expect(result.target).toEqual(
        expect.objectContaining({
          path: "src/app.ts",
          external: false,
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("marks externally pathed in-memory symbols as external", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const externalPath = path.join(os.tmpdir(), "external-symbol.ts");
    const target = index.symbols.find((symbol) => symbol.name === "alpha");
    if (!target) {
      throw new Error("missing target symbol");
    }
    target.path = externalPath;
    target.id = `${externalPath}#alpha:1`;
    index.files[0]!.symbols[0] = target;

    try {
      const result = await createSymbolContext({ repoRoot, symbol: "alpha" }, { index });

      expect(result.target).toEqual(
        expect.objectContaining({
          path: externalPath.replace(/\\/g, "/"),
          external: true,
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("filters external graph target and candidates when excludeExternal is true", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/internal.ts": "export function shared() { return 1; }\n",
      "src/external-placeholder.ts": "export function shared() { return 2; }\n",
    });
    const externalPath = path.join(os.tmpdir(), "external-shared.ts");
    const external = index.symbols.find((symbol) => symbol.path === "src/external-placeholder.ts");
    if (!external) {
      throw new Error("missing external symbol");
    }
    external.path = externalPath;
    external.id = `${externalPath}#shared:1`;
    index.files.find((file) => file.path === "src/external-placeholder.ts")!.path = externalPath;

    try {
      const result = await createSymbolContext(
        { repoRoot, file: externalPath, symbol: "shared", excludeExternal: true },
        { index },
      );

      expect(result.target).toBeUndefined();
      expect(result.candidates.map((candidate) => candidate.path)).toEqual(["src/internal.ts"]);
      expect(result.warnings.join("\n")).toContain("Excluded 1 external graph location");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not read outside repoRoot when clamping external file targets", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const externalPath = path.join(os.tmpdir(), "wormhole-external-clamp-missing.ts");

    try {
      const result = await createSymbolContext(
        { repoRoot, file: externalPath, line: 99, character: 99 },
        { index },
      );

      expect(result.query.file).toBe(externalPath.replace(/\\/g, "/"));
      expect(result.query.fileExternal).toBe(true);
      expect(result.query.line).toBe(99);
      expect(result.query.character).toBe(99);
      expect(result.warnings.join("\n")).toContain(
        "External file target skipped disk read for position clamping.",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("keeps repo-relative paths starting with dot-dot-like segments internal", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "..foo/app.ts": "export function alpha() { return 1; }\n",
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "..foo/app.ts", symbol: "alpha" },
        { index },
      );

      expect(result.query.fileExternal).toBe(false);
      expect(result.target).toEqual(
        expect.objectContaining({
          path: "..foo/app.ts",
          external: false,
        }),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("adds references to normalized query aspects when includeReferences is true", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, symbol: "alpha", includeReferences: true },
        { index },
      );

      expect(result.query.aspects).toEqual(["definition", "hover", "references"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("warns and ignores unknown direct-service aspects", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const input = {
      repoRoot,
      symbol: "alpha",
      aspects: ["definition", "bogus"],
    } as unknown as SymbolContextInput;

    try {
      const result = await createSymbolContext(input, { index });

      expect(result.query.aspects).toEqual(["definition"]);
      expect(result.warnings.join("\n")).toContain("Unknown symbol_context aspect ignored: bogus");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("maps stored diagnostics, converts info severity, caps at 50, and warns when capped", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const diagnostics = Array.from({ length: 55 }, (_, index) => diagnostic(index, "info"));

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", symbol: "alpha", aspects: [] },
        { index, diagnostics },
      );

      expect(result.lsp.diagnostics).toHaveLength(50);
      expect(result.lsp.diagnostics.every((entry) => entry.severity === "information")).toBe(true);
      expect(result.warnings.join("\n")).toContain("Diagnostics were capped at 50 records.");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("lsp symbol context live TypeScript enrichment", () => {
  it("opens and closes the document around default definition and hover requests", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": [
        "import { alpha } from './defs';",
        "export function caller() {",
        "  return alpha();",
        "}",
      ].join("\n"),
      "src/defs.ts": "export function alpha() { return 1; }\n",
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: lspLocation(repoRoot, "src/defs.ts", 0, 16),
      hoverResult: { contents: { kind: "markdown", value: "**alpha** docs" } },
      referencesResult: [lspLocation(repoRoot, "src/app.ts", 2, 9)],
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 3, character: 12 },
        { index, lsp: harness.deps },
      );

      await waitFor(() => {
        expect(readRpcLog(harness.logPath).map((entry) => entry.method)).toEqual([
          "initialize",
          "initialized",
          "textDocument/didOpen",
          "textDocument/definition",
          "textDocument/hover",
          "textDocument/didClose",
        ]);
      });
      const didOpen = readRpcLog(harness.logPath).find((entry) => entry.method === "textDocument/didOpen");
      expect(didOpen?.params).toEqual(
        expect.objectContaining({
          textDocument: expect.objectContaining({
            languageId: "typescript",
            text: expect.stringContaining("return alpha();"),
          }),
        }),
      );
      expect(result.lsp.status).toBe("completed");
      expect(result.lsp.definitionStatus).toBe("completed");
      expect(result.lsp.hoverStatus).toBe("completed");
      expect(result.lsp.referencesStatus).toBe("not_requested");
      expect(result.lsp.definitionLocations).toEqual([
        expect.objectContaining({ path: "src/defs.ts", line: 1, source: "lsp" }),
      ]);
      expect(result.lsp.hoverContents).toEqual([{ kind: "markdown", value: "**alpha** docs" }]);
      expect(result.target).toEqual(
        expect.objectContaining({
          name: "alpha",
          path: "src/defs.ts",
          confidence: "lsp-definition",
        }),
      );
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("requests references through includeReferences and references-only aspects", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: lspLocation(repoRoot, "src/app.ts", 0, 16),
      hoverResult: "alpha docs",
      referencesResult: [
        lspLocation(repoRoot, "src/app.ts", 0, 16),
        lspLocation(repoRoot, "src/app.ts", 1, 0),
      ],
    });

    try {
      const includeReferences = await createSymbolContext(
        {
          repoRoot,
          file: "src/app.ts",
          line: 2,
          character: 2,
          includeReferences: true,
          referencesIncludeDeclaration: true,
        },
        { index, lsp: harness.deps },
      );
      const referencesOnly = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2, aspects: ["references"] },
        { index, lsp: harness.deps },
      );

      await waitFor(() => {
        const entries = readRpcLog(harness.logPath);
        expect(entries.filter((entry) => entry.method === "textDocument/references")).toHaveLength(2);
      });
      const firstReferences = readRpcLog(harness.logPath).find(
        (entry) => entry.method === "textDocument/references",
      );
      const methods = readRpcLog(harness.logPath).map((entry) => entry.method);
      expect(includeReferences.lsp.referencesStatus).toBe("completed");
      expect(includeReferences.lsp.referencesReturned).toBe(2);
      expect(firstReferences?.params).toEqual(
        expect.objectContaining({
          context: { includeDeclaration: true },
        }),
      );
      expect(referencesOnly.lsp.definitionStatus).toBe("not_requested");
      expect(referencesOnly.lsp.hoverStatus).toBe("not_requested");
      expect(referencesOnly.lsp.referencesStatus).toBe("completed");
      expect(methods.filter((method) => method === "textDocument/definition")).toHaveLength(1);
      expect(methods.filter((method) => method === "textDocument/hover")).toHaveLength(1);
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("tracks reference truncation and skips the request when referencesLimit is zero", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
    });
    const references = Array.from({ length: 5 }, (_, offset) =>
      lspLocation(repoRoot, "src/app.ts", offset % 2, offset),
    );
    const harness = createLiveHarness(repoRoot, { referencesResult: references });

    try {
      const truncated = await createSymbolContext(
        {
          repoRoot,
          file: "src/app.ts",
          line: 2,
          character: 2,
          aspects: ["references"],
          referencesLimit: 2,
        },
        { index, lsp: harness.deps },
      );
      const skipped = await createSymbolContext(
        {
          repoRoot,
          file: "src/app.ts",
          line: 2,
          character: 2,
          aspects: ["references"],
          referencesLimit: 0,
        },
        { index, lsp: harness.deps },
      );

      await waitFor(() => {
        expect(readRpcLog(harness.logPath).filter((entry) => entry.method === "textDocument/references")).toHaveLength(1);
      });
      expect(truncated.lsp.referenceLocations).toHaveLength(2);
      expect(truncated.lsp.referencesReturned).toBe(2);
      expect(truncated.lsp.referencesTotalKnown).toBe(5);
      expect(truncated.lsp.referencesTruncated).toBe(true);
      expect(skipped.lsp.referencesStatus).toBe("not_requested");
      expect(skipped.lsp.referencesReturned).toBe(0);
      expect(skipped.warnings.join("\n")).toContain("referencesLimit is 0");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("retains external references by default and excludes them before applying limits", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
      "src/other.ts": "alpha();\n",
    });
    const externalUri = pathToFileURL(path.join(os.tmpdir(), "wormhole-external-ref.ts")).href;
    const harness = createLiveHarness(repoRoot, {
      referencesResult: [
        { ...lspLocation(repoRoot, "src/app.ts", 1, 0) },
        { ...lspLocation(repoRoot, "src/other.ts", 0, 0) },
        {
          uri: externalUri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
        },
      ],
    });

    try {
      const retained = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2, aspects: ["references"] },
        { index, lsp: harness.deps },
      );
      const excluded = await createSymbolContext(
        {
          repoRoot,
          file: "src/app.ts",
          line: 2,
          character: 2,
          aspects: ["references"],
          excludeExternal: true,
          referencesLimit: 1,
        },
        { index, lsp: harness.deps },
      );

      expect(retained.lsp.referenceLocations.some((location) => location.external)).toBe(true);
      expect(retained.lsp.referencesTotalKnown).toBe(3);
      expect(excluded.lsp.referenceLocations).toHaveLength(1);
      expect(excluded.lsp.referenceLocations.every((location) => !location.external)).toBe(true);
      expect(excluded.lsp.externalLocationsExcluded).toBe(1);
      expect(excluded.lsp.referencesTotalKnown).toBe(2);
      expect(excluded.lsp.referencesTruncated).toBe(true);
      expect(excluded.warnings.join("\n")).toContain("Excluded 1 external LSP reference");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("filters external LSP definition locations when excludeExternal is true", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function localTarget() { return alpha(); }\n",
      "src/defs.ts": "export function alpha() { return 1; }\n",
    });
    const externalUri = pathToFileURL(path.join(os.tmpdir(), "wormhole-external-definition.ts")).href;
    const harness = createLiveHarness(repoRoot, {
      definitionResult: [
        {
          uri: externalUri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
        },
        lspLocation(repoRoot, "src/defs.ts", 0, 16),
      ],
    });

    try {
      const result = await createSymbolContext(
        {
          repoRoot,
          file: "src/app.ts",
          line: 1,
          character: 40,
          aspects: ["definition"],
          excludeExternal: true,
        },
        { index, lsp: harness.deps },
      );

      expect(result.lsp.definitionStatus).toBe("completed");
      expect(result.lsp.definitionLocations).toEqual([
        expect.objectContaining({ path: "src/defs.ts", external: false }),
      ]);
      expect(result.lsp.definitionLocations.every((location) => !location.external)).toBe(true);
      expect(result.target).toEqual(
        expect.objectContaining({ name: "alpha", path: "src/defs.ts", confidence: "lsp-definition" }),
      );
      expect(result.warnings.join("\n")).toContain("Excluded 1 external LSP definition");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("skips references before capability gating when referencesLimit is zero", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
    });
    const harness = createLiveHarness(repoRoot, {
      capabilities: { definitionProvider: true, hoverProvider: true },
      referencesResult: [lspLocation(repoRoot, "src/app.ts", 1, 0)],
    });

    try {
      const result = await createSymbolContext(
        {
          repoRoot,
          file: "src/app.ts",
          line: 2,
          character: 2,
          aspects: ["references"],
          referencesLimit: 0,
        },
        { index, lsp: harness.deps },
      );

      expect(result.lsp.referencesStatus).toBe("not_requested");
      expect(result.lsp.referencesReturned).toBe(0);
      expect(result.warnings.join("\n")).toContain("referencesLimit is 0");
      expect(result.warnings.join("\n")).not.toContain("referencesProvider");
      expect(readRpcLog(harness.logPath).map((entry) => entry.method)).not.toContain(
        "textDocument/references",
      );
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("keeps successful definition data when hover times out", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: lspLocation(repoRoot, "src/app.ts", 0, 16),
      noResponseMethods: ["textDocument/hover"],
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2, requestTimeoutMs: 50 },
        { index, lsp: harness.deps },
      );

      expect(result.lsp.status).toBe("partial");
      expect(result.lsp.definitionStatus).toBe("completed");
      expect(result.lsp.hoverStatus).toBe("timed_out");
      expect(result.lsp.definitionLocations).toHaveLength(1);
      expect(result.warnings.join("\n")).toContain("hover request timed out");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("keeps successful hover data when definition fails", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
    });
    const harness = createLiveHarness(repoRoot, {
      hoverResult: { contents: { kind: "plaintext", value: "alpha docs" } },
      errors: { "textDocument/definition": "definition failed" },
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2 },
        { index, lsp: harness.deps },
      );

      expect(result.lsp.status).toBe("partial");
      expect(result.lsp.definitionStatus).toBe("failed");
      expect(result.lsp.hoverStatus).toBe("completed");
      expect(result.lsp.hoverContents).toEqual([{ kind: "plaintext", value: "alpha docs" }]);
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("treats malformed definition data as an isolated request failure", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: { not: "a location" },
      hoverResult: ["", { kind: "markdown", value: "valid hover" }],
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2 },
        { index, lsp: harness.deps },
      );

      expect(result.lsp.status).toBe("partial");
      expect(result.lsp.definitionStatus).toBe("failed");
      expect(result.lsp.hoverStatus).toBe("completed");
      expect(result.lsp.hoverContents).toEqual([{ kind: "markdown", value: "valid hover" }]);
      expect(result.warnings.join("\n")).toContain("Malformed LSP definition response");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns graph context when the fake server disconnects", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": [
        "export function graphTarget() {",
        "  return alpha();",
        "}",
      ].join("\n"),
    });
    const harness = createLiveHarness(repoRoot, {
      exitOnMethods: ["textDocument/definition"],
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 10 },
        { index, lsp: harness.deps },
      );

      expect(result.target).toEqual(
        expect.objectContaining({ name: "graphTarget", confidence: "position-nearest" }),
      );
      expect(result.lsp.status).toBe("failed");
      expect(result.lsp.definitionStatus).toBe("failed");
      expect(result.warnings.join("\n")).toContain("definition request failed");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("one-shot mode sends shutdown and exit and removes its own session", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: lspLocation(repoRoot, "src/app.ts", 0, 16),
      hoverResult: "alpha docs",
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 1, character: 18, sessionMode: "one_shot" },
        { index, lsp: harness.deps },
      );

      await waitFor(() => {
        const methods = readRpcLog(harness.logPath).map((entry) => entry.method);
        expect(methods).toContain("shutdown");
        expect(methods).toContain("exit");
      });
      expect(result.lsp.status).toBe("completed");
      expect(harness.manager.list()).toHaveLength(0);
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("one-shot mode does not evict an existing retained reuse session", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: lspLocation(repoRoot, "src/app.ts", 0, 16),
      hoverResult: "alpha docs",
    });

    try {
      const firstReuse = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2 },
        { index, lsp: harness.deps },
      );
      const retainedSessionId = firstReuse.lsp.sessionId;
      expect(retainedSessionId).toEqual(expect.any(String));

      const oneShot = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2, sessionMode: "one_shot" },
        { index, lsp: harness.deps },
      );
      expect(oneShot.lsp.sessionId).not.toBe(retainedSessionId);
      await waitFor(() => {
        expect(harness.manager.status({ sessionId: oneShot.lsp.sessionId ?? "" })).toBeUndefined();
      });

      const secondReuse = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2 },
        { index, lsp: harness.deps },
      );

      expect(secondReuse.lsp.sessionId).toBe(retainedSessionId);
      expect(harness.authorizeStart).toHaveBeenCalledTimes(2);
      expect(harness.manager.list()).toEqual([
        expect.objectContaining({ sessionId: retainedSessionId, status: "running" }),
      ]);
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reuse mode authorizes only the first retained start", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: lspLocation(repoRoot, "src/app.ts", 0, 16),
      hoverResult: "alpha docs",
    });

    try {
      const first = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2 },
        { index, lsp: harness.deps },
      );
      const second = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2 },
        { index, lsp: harness.deps },
      );

      expect(harness.authorizeStart).toHaveBeenCalledTimes(1);
      expect(second.lsp.sessionId).toBe(first.lsp.sessionId);
      expect(harness.manager.list()).toHaveLength(1);
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("serializes two concurrent live calls on one retained session", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/one.ts": "export function one() { return 1; }\n",
      "src/two.ts": "export function two() { return 2; }\n",
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: lspLocation(repoRoot, "src/one.ts", 0, 16),
      hoverResult: "docs",
    });

    try {
      const [first, second] = await Promise.all([
        createSymbolContext(
          { repoRoot, file: "src/one.ts", line: 1, character: 18 },
          { index, lsp: harness.deps },
        ),
        createSymbolContext(
          { repoRoot, file: "src/two.ts", line: 1, character: 18 },
          { index, lsp: harness.deps },
        ),
      ]);

      await waitFor(() => {
        const methods = readRpcLog(harness.logPath).map((entry) => entry.method);
        expect(methods.filter((method) => method === "initialize")).toHaveLength(1);
        expect(methods.filter((method) => method === "initialized")).toHaveLength(1);
        expect(methods.filter((method) => method === "textDocument/didOpen")).toHaveLength(2);
        expect(methods.filter((method) => method === "textDocument/didClose")).toHaveLength(2);
      });
      const liveMethods = readRpcLog(harness.logPath)
        .map((entry) => entry.method)
        .filter((method) => method?.startsWith("textDocument/"));
      expect(liveMethods).toEqual([
        "textDocument/didOpen",
        "textDocument/definition",
        "textDocument/hover",
        "textDocument/didClose",
        "textDocument/didOpen",
        "textDocument/definition",
        "textDocument/hover",
        "textDocument/didClose",
      ]);
      expect(first.lsp.sessionId).toBe(second.lsp.sessionId);
      expect(harness.authorizeStart).toHaveBeenCalledTimes(1);
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports strict authorizeStart failure without throwing", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const harness = createLiveHarness(repoRoot, {}, vi.fn(() => {
      throw new Error("denied by test");
    }));

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 1, character: 18 },
        { index, lsp: harness.deps },
      );

      expect(result.lsp.status).toBe("failed");
      expect(result.lsp.server).toEqual({ language: "typescript", command: process.execPath });
      expect(result.warnings.join("\n")).toContain("denied by test");
      expect(harness.manager.list()).toHaveLength(0);
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns unsupported_language for configured non-TypeScript live mode", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.py": "def alpha():\n    return 1\n",
    });
    const manager = createLspSessionManager();
    const authorizeStart = vi.fn(() => {
      throw new Error("should not authorize unsupported language");
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.py", line: 1, character: 5 },
        {
          index,
          lsp: {
            configs: [pythonConfig(repoRoot)],
            manager,
            authorizeStart,
          },
        },
      );

      expect(result.lsp.status).toBe("unsupported_language");
      expect(authorizeStart).not.toHaveBeenCalled();
      expect(manager.list()).toHaveLength(0);
    } finally {
      await manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not acquire live LSP when aspects is empty", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const harness = createLiveHarness(repoRoot, {}, vi.fn(() => {
      throw new Error("should not authorize graph-only request");
    }));

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", symbol: "alpha", aspects: [] },
        { index, lsp: harness.deps },
      );

      expect(result.lsp.status).toBe("not_requested");
      expect(harness.authorizeStart).not.toHaveBeenCalled();
      expect(harness.manager.list()).toHaveLength(0);
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not acquire live LSP for explicit unknown-only aspects", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const harness = createLiveHarness(repoRoot, {}, vi.fn(() => {
      throw new Error("should not authorize invalid-only aspects");
    }));

    try {
      const input = {
        repoRoot,
        file: "src/app.ts",
        line: 1,
        character: 18,
        aspects: ["bogus"],
      } as unknown as SymbolContextInput;
      const result = await createSymbolContext(input, { index, lsp: harness.deps });

      expect(result.query.aspects).toEqual([]);
      expect(result.lsp.status).toBe("not_requested");
      expect(harness.authorizeStart).not.toHaveBeenCalled();
      expect(harness.manager.list()).toHaveLength(0);
      expect(result.warnings.join("\n")).toContain("Unknown symbol_context aspect ignored: bogus");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not acquire live LSP for external TypeScript target files", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const externalPath = path.join(os.tmpdir(), `wormhole-external-${Date.now()}.ts`);
    writeFileSync(externalPath, "export function externalAlpha() { return 1; }\n");
    const harness = createLiveHarness(repoRoot, {}, vi.fn(() => {
      throw new Error("should not authorize external target");
    }));

    try {
      const result = await createSymbolContext(
        { repoRoot, file: externalPath, line: 1, character: 18 },
        { index, lsp: harness.deps },
      );

      expect(result.query.fileExternal).toBe(true);
      expect(result.lsp.status).toBe("unsupported_language");
      expect(harness.authorizeStart).not.toHaveBeenCalled();
      expect(harness.manager.list()).toHaveLength(0);
      expect(readRpcLog(harness.logPath)).toEqual([]);
      expect(result.warnings.join("\n")).toContain("External file targets are not live-opened");
    } finally {
      rmSync(externalPath, { force: true });
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("normalizes LocationLink definition responses", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: lspLocationLink(repoRoot, "src/app.ts", 0, 16),
      hoverResult: null,
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2, aspects: ["definition"] },
        { index, lsp: harness.deps },
      );

      expect(result.lsp.definitionStatus).toBe("completed");
      expect(result.lsp.definitionLocations).toEqual([
        expect.objectContaining({ path: "src/app.ts", line: 1, character: 17 }),
      ]);
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("keeps the graph fallback when a definition line is before all indexed symbols", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function graphTarget() { return alpha(); }\n",
      "src/defs.ts": ["// header", "", "export function alpha() { return 1; }"].join("\n"),
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: lspLocation(repoRoot, "src/defs.ts", 0, 0),
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 1, character: 40, aspects: ["definition"] },
        { index, lsp: harness.deps },
      );

      expect(result.target).toEqual(
        expect.objectContaining({ name: "graphTarget", confidence: "position-nearest" }),
      );
      expect(result.lsp.definitionStatus).toBe("completed");
      expect(result.warnings.join("\n")).toContain("Unable to map LSP definition");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed LSP coordinates without poisoning hover", async () => {
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": "export function alpha() { return 1; }\nalpha();\n",
    });
    const harness = createLiveHarness(repoRoot, {
      definitionResult: {
        uri: pathToFileURL(path.join(repoRoot, "src", "app.ts")).href,
        range: {
          start: { line: -1, character: 1.5 },
          end: { line: 0, character: 5 },
        },
      },
      hoverResult: "alpha docs",
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 2, character: 2 },
        { index, lsp: harness.deps },
      );

      expect(result.lsp.status).toBe("partial");
      expect(result.lsp.definitionStatus).toBe("failed");
      expect(result.lsp.definitionLocations).toEqual([]);
      expect(result.lsp.hoverStatus).toBe("completed");
      expect(result.lsp.hoverContents).toEqual([{ kind: "plaintext", value: "alpha docs" }]);
      expect(result.warnings.join("\n")).toContain("Malformed LSP definition response");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back to indexed content when disk read fails before didOpen", async () => {
    const content = "export function alpha() { return 1; }\n";
    const { repoRoot, index } = buildFixtureIndex({
      "src/app.ts": content,
    });
    unlinkSync(path.join(repoRoot, "src", "app.ts"));
    const harness = createLiveHarness(repoRoot, {
      definitionResult: lspLocation(repoRoot, "src/app.ts", 0, 16),
      hoverResult: "alpha docs",
    });

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/app.ts", line: 1, character: 18 },
        { index, lsp: harness.deps },
      );

      await waitFor(() => {
        const didOpen = readRpcLog(harness.logPath).find((entry) => entry.method === "textDocument/didOpen");
        expect(didOpen?.params).toEqual(
          expect.objectContaining({
            textDocument: expect.objectContaining({ text: content }),
          }),
        );
      });
      expect(result.lsp.status).toBe("completed");
      expect(result.warnings.join("\n")).toContain("indexed content");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("skips live LSP when didOpen text would exceed the byte limit", async () => {
    const repoRoot = createTempRepo({
      "src/large.ts": `export const large = "${"x".repeat(1024 * 1024)}";\n`,
    });
    const harness = createLiveHarness(repoRoot);

    try {
      const result = await createSymbolContext(
        { repoRoot, file: "src/large.ts", line: 1, character: 15 },
        { lsp: harness.deps },
      );

      expect(result.lsp.status).toBe("failed");
      expect(result.warnings.join("\n")).toContain("exceeds the live LSP didOpen limit");
    } finally {
      await harness.manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

type RpcLogEntry = {
  id?: number;
  method?: string;
  params?: unknown;
};

type FakeLspOptions = {
  capabilities?: unknown;
  definitionResult?: unknown;
  hoverResult?: unknown;
  referencesResult?: unknown;
  errors?: Record<string, string>;
  noResponseMethods?: string[];
  exitOnMethods?: string[];
};

function createLiveHarness(
  repoRoot: string,
  options: FakeLspOptions = {},
  authorizeStart = vi.fn(),
): {
  manager: ReturnType<typeof createLspSessionManager>;
  authorizeStart: ReturnType<typeof vi.fn>;
  logPath: string;
  deps: {
    configs: LanguageServerConfig[];
    manager: ReturnType<typeof createLspSessionManager>;
    authorizeStart: (config: LanguageServerConfig) => void | Promise<void>;
  };
} {
  const manager = createLspSessionManager();
  const fastStartupManager: ReturnType<typeof createLspSessionManager> = {
    ...manager,
    start: (input) => manager.start({ ...input, startupTimeoutMs: input.startupTimeoutMs ?? 20 }),
    getOrStart: (input) =>
      manager.getOrStart({ ...input, startupTimeoutMs: input.startupTimeoutMs ?? 20 }),
  };
  const logPath = path.join(repoRoot, `lsp-${Math.random().toString(36).slice(2)}.jsonl`);
  const config = typescriptConfig(repoRoot, fakeLspServerScript(logPath, options));
  return {
    manager,
    authorizeStart,
    logPath,
    deps: {
      configs: [config],
      manager: fastStartupManager,
      authorizeStart,
    },
  };
}

function typescriptConfig(repoRoot: string, script: string): LanguageServerConfig {
  return {
    language: "typescript",
    command: process.execPath,
    args: ["-e", script],
    transport: "stdio",
    workspaceRoot: repoRoot,
    reason: "test TypeScript fake server",
  };
}

function pythonConfig(repoRoot: string): LanguageServerConfig {
  return {
    language: "python",
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    transport: "stdio",
    workspaceRoot: repoRoot,
    reason: "test Python fake server",
  };
}

function lspLocation(repoRoot: string, relativePath: string, line: number, character: number) {
  return {
    uri: pathToFileURL(path.join(repoRoot, relativePath)).href,
    range: {
      start: { line, character },
      end: { line, character: character + 1 },
    },
  };
}

function lspLocationLink(repoRoot: string, relativePath: string, line: number, character: number) {
  const range = {
    start: { line, character },
    end: { line, character: character + 1 },
  };
  return {
    targetUri: pathToFileURL(path.join(repoRoot, relativePath)).href,
    targetRange: range,
    targetSelectionRange: range,
  };
}

function fakeLspServerScript(logPath: string, options: FakeLspOptions): string {
  return [
    "const fs=require('node:fs');",
    `const logPath=${JSON.stringify(logPath)};`,
    `const options=${JSON.stringify(options)};`,
    "let buffer=Buffer.alloc(0);",
    "function log(req){fs.appendFileSync(logPath,`${JSON.stringify(req)}\\n`);}",
    "function send(id,result){const body=JSON.stringify({jsonrpc:'2.0',id,result});process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
    "function sendError(id,message){const body=JSON.stringify({jsonrpc:'2.0',id,error:{code:-32000,message}});process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
    "function respond(req){",
    "if(options.errors&&options.errors[req.method]){sendError(req.id,options.errors[req.method]);return;}",
    "if((options.noResponseMethods||[]).includes(req.method))return;",
    "if(req.id===undefined)return;",
    "if(req.method==='initialize'){send(req.id,{capabilities:options.capabilities||{definitionProvider:true,hoverProvider:true,referencesProvider:true}});return;}",
    "if(req.method==='shutdown'){send(req.id,null);return;}",
    "if(req.method==='textDocument/definition'){send(req.id,options.definitionResult===undefined?null:options.definitionResult);return;}",
    "if(req.method==='textDocument/hover'){send(req.id,options.hoverResult===undefined?null:options.hoverResult);return;}",
    "if(req.method==='textDocument/references'){send(req.id,options.referencesResult===undefined?[]:options.referencesResult);return;}",
    "send(req.id,null);",
    "}",
    "process.stdin.on('data',(chunk)=>{",
    "buffer=Buffer.concat([buffer,chunk]);",
    "while(true){",
    "const headerEnd=buffer.indexOf(Buffer.from('\\r\\n\\r\\n'));",
    "if(headerEnd<0)return;",
    "const header=buffer.subarray(0,headerEnd).toString('ascii');",
    "const match=header.match(/Content-Length:\\s*(\\d+)/i);",
    "if(!match)return;",
    "const length=Number(match[1]);",
    "const bodyStart=headerEnd+4;",
    "if(buffer.length<bodyStart+length)return;",
    "const req=JSON.parse(buffer.subarray(bodyStart,bodyStart+length).toString('utf8'));",
    "buffer=buffer.subarray(bodyStart+length);",
    "log(req);",
    "if(req.method==='exit'){process.exit(0);}",
    "if((options.exitOnMethods||[]).includes(req.method)){process.exit(1);}",
    "respond(req);",
    "}",
    "});",
    "setInterval(()=>{},1000);",
  ].join("");
}

function readRpcLog(logPath: string): RpcLogEntry[] {
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RpcLogEntry);
}

async function waitFor(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(10);
    }
  }
  throw lastError;
}
