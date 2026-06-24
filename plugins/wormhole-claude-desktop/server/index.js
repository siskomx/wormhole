#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serverDir, "../../..");
const cliPath = path.join(repoRoot, "dist", "src", "cli.js");

if (!existsSync(cliPath)) {
  console.error(`Wormhole build not found at ${cliPath}. Run npm run build before installing this extension.`);
  process.exit(1);
}

const child = spawn(process.execPath, [cliPath], {
  cwd: repoRoot,
  stdio: ["inherit", "inherit", "inherit"],
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
