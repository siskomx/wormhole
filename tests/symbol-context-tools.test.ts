import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticRecord } from "../src/diagnostics.js";
import { createInMemoryKernel } from "../src/kernel.js";
import {
  createPrivilegedActionGate,
  type PrivilegedActionDecision,
  type PrivilegedActionGate,
  type PrivilegedActionRequest,
} from "../src/privileged-action-gate.js";
import { createToolHandlers } from "../src/tools.js";

const lspGroundTruthMock = vi.hoisted(() => ({
  serverScript: undefined as string | undefined,
}));

vi.mock("../src/lsp-ground-truth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lsp-ground-truth.js")>();
  return {
    ...actual,
    detectLanguageServerConfigs(input: { repoRoot: string }) {
      if (!lspGroundTruthMock.serverScript) {
        return actual.detectLanguageServerConfigs(input);
      }
      return [
        {
          language: "typescript" as const,
          command: process.execPath,
          args: ["-e", lspGroundTruthMock.serverScript],
          transport: "stdio" as const,
          workspaceRoot: input.repoRoot,
          reason: "test fake TypeScript server",
        },
      ];
    },
  };
});

const createdRepos: string[] = [];
const itWindows = process.platform === "win32" ? it : it.skip;

afterEach(() => {
  lspGroundTruthMock.serverScript = undefined;
  for (const repoRoot of createdRepos.splice(0)) {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

describe("symbol_context tool handler", () => {
  it("enforces allowed repo roots", async () => {
    const allowedRoot = createTempRepo({});
    const deniedRoot = createTempRepo({ "src/app.ts": "export function alpha() { return 1; }\n" });
    const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [allowedRoot] });

    await expect(tools.symbolContext({ repoRoot: deniedRoot, symbol: "alpha" })).rejects.toThrow(
      /allowed workspace root/,
    );
  });

  it("returns graph context in strict privileged mode when no LSP is configured", async () => {
    const repoRoot = createTempRepo({
      "src/app.ts": "export function alpha() { return 1; }\n",
    });
    const tools = createToolHandlers(createInMemoryKernel(), {
      allowedRepoRoots: [repoRoot],
      privilegedActionPolicy: { mode: "strict" },
    });

    const result = await tools.symbolContext({ repoRoot, symbol: "alpha" });

    expect(result.target).toEqual(expect.objectContaining({ name: "alpha", path: "src/app.ts" }));
    expect(result.graph.status).toBe("fresh");
    expect(result.lsp.status).toBe("not_configured");
  });

  it("does not invoke the privileged gate for graph-only requests", async () => {
    const repoRoot = createTypeScriptRepo();
    const gate = throwingGate("graph-only request should not require privileged action");
    const tools = createToolHandlers(createInMemoryKernel(), {
      allowedRepoRoots: [repoRoot],
      privilegedActionGate: gate,
    });

    const result = await tools.symbolContext({
      repoRoot,
      file: "src/app.ts",
      symbol: "alpha",
      aspects: [],
    });

    expect(result.target).toEqual(expect.objectContaining({ name: "alpha" }));
    expect(result.lsp.status).toBe("not_requested");
  });

  it("calls the privileged gate for live LSP startup and reuses retained sessions without reauthorizing", async () => {
    const repoRoot = createTypeScriptRepo();
    lspGroundTruthMock.serverScript = fakeLanguageServerScript();
    const strictGate = createPrivilegedActionGate({ mode: "strict", approvedTools: ["symbol_context"] });
    const { gate, requests } = recordingGate(strictGate);
    const tools = createToolHandlers(createInMemoryKernel(), {
      allowedRepoRoots: [repoRoot],
      privilegedActionGate: gate,
    });

    try {
      const first = await tools.symbolContext({
        repoRoot,
        file: "src/app.ts",
        line: 2,
        character: 2,
        startupTimeoutMs: 20,
        requestTimeoutMs: 500,
      });
      const second = await tools.symbolContext({
        repoRoot,
        file: "src/app.ts",
        line: 2,
        character: 2,
        startupTimeoutMs: 20,
        requestTimeoutMs: 500,
      });

      expect(first.lsp.status).toBe("completed");
      expect(second.lsp.sessionId).toBe(first.lsp.sessionId);
      expect(requests).toEqual([
        expect.objectContaining({
          toolName: "symbol_context",
          kind: "command",
          operations: [
            {
              kind: "command",
              command: process.execPath,
              args: ["-e", expect.any(String)],
            },
          ],
          target: expect.objectContaining({
            repoRoot,
            command: process.execPath,
            args: ["-e", expect.any(String)],
          }),
        }),
      ]);
    } finally {
      await stopToolLspSessions(tools);
    }
  });

  it("blocks live LSP startup in strict mode unless approved", async () => {
    const repoRoot = createTypeScriptRepo();
    const tools = createToolHandlers(createInMemoryKernel(), {
      allowedRepoRoots: [repoRoot],
      privilegedActionPolicy: { mode: "strict" },
    });

    const result = await tools.symbolContext({
      repoRoot,
      file: "src/app.ts",
      line: 2,
      character: 2,
      startupTimeoutMs: 20,
      requestTimeoutMs: 50,
    });

    expect(result.lsp.status).toBe("failed");
    expect(result.warnings.join("\n")).toContain("Privileged action blocked");
    expect(tools.lspSessionList()).toHaveLength(0);
  });

  it("returns missing graph status when the repo index cannot be loaded", async () => {
    const parentRoot = createTempRepo({});
    const missingRepoRoot = path.join(parentRoot, "missing-repo");
    const tools = createToolHandlers(createInMemoryKernel(), {
      allowedRepoRoots: [parentRoot],
    });

    const result = await tools.symbolContext({
      repoRoot: missingRepoRoot,
      symbol: "alpha",
      aspects: [],
    });

    expect(result.graph.status).toBe("missing");
    expect(result.graph.fingerprint).toBe("");
    expect(result.warnings.join("\n")).toContain("Unable to load repo index for symbol_context");
  });

  it("passes only file-scoped diagnostics, maps info severity, caps at 50, and warns", async () => {
    const repoRoot = createTempRepo({
      "src/app.ts": "export function alpha() { return 1; }\n",
      "src/other.ts": "export const beta = 2;\n",
    });
    const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
    const diagnostics = [
      ...Array.from({ length: 55 }, (_, index) => diagnostic(index, "src/app.ts", "info")),
      diagnostic(99, "src/other.ts", "error"),
    ];
    tools.diagnosticsRecord({ diagnostics });

    const fileResult = await tools.symbolContext({
      repoRoot,
      file: "src/app.ts",
      symbol: "alpha",
      aspects: [],
    });
    const symbolOnlyResult = await tools.symbolContext({
      repoRoot,
      symbol: "alpha",
      aspects: [],
    });

    expect(fileResult.lsp.diagnostics).toHaveLength(50);
    expect(fileResult.lsp.diagnostics.every((entry) => entry.path === "src/app.ts")).toBe(true);
    expect(fileResult.lsp.diagnostics.every((entry) => entry.severity === "information")).toBe(true);
    expect(fileResult.warnings.join("\n")).toContain("Diagnostics were capped at 50 records.");
    expect(symbolOnlyResult.lsp.diagnostics).toHaveLength(0);
  });

  it("keeps absolute diagnostics scoped to the selected allowed repo", async () => {
    const repoA = createTempRepo({ "src/app.ts": "export function alpha() { return 'a'; }\n" });
    const repoB = createTempRepo({ "src/app.ts": "export function alpha() { return 'b'; }\n" });
    const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoA, repoB] });
    tools.diagnosticsRecord({
      diagnostics: [
        diagnostic(1, path.join(repoA, "src", "app.ts"), "error", "repo A diagnostic"),
        diagnostic(2, path.join(repoB, "src", "app.ts"), "warning", "repo B diagnostic"),
      ],
    });

    const repoAResult = await tools.symbolContext({ repoRoot: repoA, file: "src/app.ts", aspects: [] });
    const repoBResult = await tools.symbolContext({ repoRoot: repoB, file: "src/app.ts", aspects: [] });

    expect(repoAResult.lsp.diagnostics.map((entry) => entry.message)).toEqual(["repo A diagnostic"]);
    expect(repoBResult.lsp.diagnostics.map((entry) => entry.message)).toEqual(["repo B diagnostic"]);
  });

  it("excludes relative diagnostics when the same path exists in multiple allowed repos", async () => {
    const repoA = createTempRepo({ "src/app.ts": "export function alpha() { return 'a'; }\n" });
    const repoB = createTempRepo({ "src/app.ts": "export function alpha() { return 'b'; }\n" });
    const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoA, repoB] });
    tools.diagnosticsRecord({
      diagnostics: [
        diagnostic(1, "src/app.ts", "error", "ambiguous relative diagnostic A"),
        diagnostic(2, "src/app.ts", "warning", "ambiguous relative diagnostic B"),
      ],
    });

    const repoAResult = await tools.symbolContext({ repoRoot: repoA, file: "src/app.ts", aspects: [] });
    const repoBResult = await tools.symbolContext({ repoRoot: repoB, file: "src/app.ts", aspects: [] });

    expect(repoAResult.lsp.diagnostics).toEqual([]);
    expect(repoBResult.lsp.diagnostics).toEqual([]);
  });

  itWindows("does not treat case variants of the same allowed root as ambiguous", async () => {
    const repoRoot = createTempRepo({ "src/app.ts": "export function alpha() { return 1; }\n" });
    const caseVariantRoot = swapPathCase(repoRoot);
    const tools = createToolHandlers(createInMemoryKernel(), {
      allowedRepoRoots: [repoRoot, caseVariantRoot],
    });
    tools.diagnosticsRecord({
      diagnostics: [
        diagnostic(1, "src/app.ts", "error", "same root relative diagnostic"),
      ],
    });

    const result = await tools.symbolContext({ repoRoot, file: "src/app.ts", aspects: [] });

    expect(result.lsp.diagnostics.map((entry) => entry.message)).toEqual([
      "same root relative diagnostic",
    ]);
  });

  it("excludes outside diagnostics that end with the requested relative path", async () => {
    const repoRoot = createTempRepo({ "src/app.ts": "export function alpha() { return 1; }\n" });
    const outsideRoot = createTempRepo({ "src/app.ts": "export function outside() { return 2; }\n" });
    const tools = createToolHandlers(createInMemoryKernel(), { allowedRepoRoots: [repoRoot] });
    tools.diagnosticsRecord({
      diagnostics: [
        diagnostic(1, "src/app.ts", "info", "inside relative diagnostic"),
        diagnostic(2, path.join(outsideRoot, "src", "app.ts"), "error", "outside absolute diagnostic"),
        diagnostic(3, path.join("..", path.basename(outsideRoot), "src", "app.ts"), "warning", "escaping relative diagnostic"),
      ],
    });

    const result = await tools.symbolContext({ repoRoot, file: "src/app.ts", aspects: [] });

    expect(result.lsp.diagnostics.map((entry) => entry.message)).toEqual(["inside relative diagnostic"]);
  });
});

function createTempRepo(files: Record<string, string>): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-symbol-context-tools-"));
  createdRepos.push(repoRoot);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repoRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return repoRoot;
}

function createTypeScriptRepo(): string {
  return createTempRepo({
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2),
    "src/app.ts": ["export function alpha() {", "  return 1;", "}", "alpha();"].join("\n"),
  });
}

function swapPathCase(value: string): string {
  return value.replace(/[A-Za-z]/g, (character) =>
    character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase(),
  );
}

function diagnostic(
  index: number,
  file: string,
  severity: DiagnosticRecord["severity"],
  message = `message ${index}`,
): DiagnosticRecord {
  return {
    diagnosticId: `diag-${index}`,
    source: "test",
    severity,
    message,
    file,
    line: index + 1,
    column: 2,
    code: `T${index}`,
    recordedAt: "2026-06-30T00:00:00.000Z",
  };
}

function throwingGate(message: string): PrivilegedActionGate {
  return {
    review() {
      throw new Error(message);
    },
    assertAllowed() {
      throw new Error(message);
    },
  };
}

function recordingGate(delegate: PrivilegedActionGate): {
  gate: PrivilegedActionGate;
  requests: PrivilegedActionRequest[];
} {
  const requests: PrivilegedActionRequest[] = [];
  return {
    requests,
    gate: {
      review(request) {
        requests.push(request);
        return delegate.review(request);
      },
      assertAllowed(request): PrivilegedActionDecision {
        requests.push(request);
        return delegate.assertAllowed(request);
      },
    },
  };
}

function fakeLanguageServerScript(): string {
  return [
    "let buffer = Buffer.alloc(0);",
    "function send(id, result) {",
    "  const body = JSON.stringify({ jsonrpc: '2.0', id, result });",
    "  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);",
    "}",
    "function locationFor(req) {",
    "  const uri = req.params && req.params.textDocument && req.params.textDocument.uri;",
    "  return { uri, range: { start: { line: 0, character: 16 }, end: { line: 0, character: 17 } } };",
    "}",
    "function respond(req) {",
    "  if (req.method === 'exit') process.exit(0);",
    "  if (req.id === undefined) return;",
    "  if (req.method === 'initialize') {",
    "    send(req.id, { capabilities: { definitionProvider: true, hoverProvider: true, referencesProvider: true } });",
    "    return;",
    "  }",
    "  if (req.method === 'shutdown') { send(req.id, null); return; }",
    "  if (req.method === 'textDocument/definition') { send(req.id, locationFor(req)); return; }",
    "  if (req.method === 'textDocument/hover') {",
    "    send(req.id, { contents: { kind: 'plaintext', value: 'fake hover' } });",
    "    return;",
    "  }",
    "  if (req.method === 'textDocument/references') { send(req.id, [locationFor(req)]); return; }",
    "  send(req.id, null);",
    "}",
    "process.stdin.on('data', (chunk) => {",
    "  buffer = Buffer.concat([buffer, chunk]);",
    "  while (true) {",
    "    const headerEnd = buffer.indexOf(Buffer.from('\\r\\n\\r\\n'));",
    "    if (headerEnd < 0) return;",
    "    const header = buffer.subarray(0, headerEnd).toString('ascii');",
    "    const match = header.match(/Content-Length:\\s*(\\d+)/i);",
    "    if (!match) return;",
    "    const length = Number(match[1]);",
    "    const bodyStart = headerEnd + 4;",
    "    if (buffer.length < bodyStart + length) return;",
    "    const req = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString('utf8'));",
    "    buffer = buffer.subarray(bodyStart + length);",
    "    respond(req);",
    "  }",
    "});",
    "setInterval(() => {}, 1000);",
  ].join("\n");
}

async function stopToolLspSessions(tools: ReturnType<typeof createToolHandlers>): Promise<void> {
  await Promise.all(
    tools.lspSessionList().map((session) => tools.lspSessionStop({ sessionId: session.sessionId })),
  );
}
