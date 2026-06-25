import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLspSessionManager } from "../src/lsp-session-manager.js";

describe("LSP session manager", () => {
  it("returns structured unavailable status when a server command is missing", async () => {
    const manager = createLspSessionManager();
    const started = await manager.start({
      repoRoot: process.cwd(),
      language: "typescript",
      command: "definitely-missing-wormhole-lsp",
      args: [],
      startupTimeoutMs: 200,
    });

    expect(started.status).toBe("unavailable");
    expect(started.error).toMatch(/definitely-missing/);
    expect(manager.list()).toHaveLength(0);
  });

  it("starts, requests, and stops a JSON-RPC language-server-like process", async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-lsp-session-"));
    const serverScript = [
      "let buffer='';",
      "function send(msg){const body=JSON.stringify(msg);process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}`);}",
      "process.stdin.on('data',(chunk)=>{",
      "buffer+=chunk.toString();",
      "while(true){",
      "const headerEnd=buffer.indexOf('\\r\\n\\r\\n');",
      "if(headerEnd<0) return;",
      "const header=buffer.slice(0,headerEnd);",
      "const match=header.match(/Content-Length: (\\d+)/i);",
      "if(!match) return;",
      "const length=Number(match[1]);",
      "const bodyStart=headerEnd+4;",
      "if(buffer.length<bodyStart+length) return;",
      "const req=JSON.parse(buffer.slice(bodyStart,bodyStart+length));",
      "buffer=buffer.slice(bodyStart+length);",
      "send({jsonrpc:'2.0',id:req.id,result:{method:req.method,ok:true}});",
      "}",
      "});",
    ].join("");
    const manager = createLspSessionManager();

    try {
      const started = await manager.start({
        repoRoot,
        language: "typescript",
        command: process.execPath,
        args: ["-e", serverScript],
        startupTimeoutMs: 1_000,
      });
      const response = await manager.request({
        sessionId: started.sessionId,
        method: "initialize",
        params: { rootUri: `file://${repoRoot}` },
        timeoutMs: 1_000,
      });
      const stopped = await manager.stop({ sessionId: started.sessionId });

      expect(started.status).toBe("running");
      expect(response.status).toBe("completed");
      expect(response.response?.result).toEqual({ method: "initialize", ok: true });
      expect(stopped.status).toBe("stopped");
      expect(manager.list()).toHaveLength(0);
    } finally {
      await manager.stopAll();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
