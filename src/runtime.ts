import path from "node:path";
import { createJsonlEventLog } from "./event-log.js";
import { createInMemoryKernel } from "./kernel.js";

export function resolveDefaultEventLogPath(cwd: string): string {
  return path.join(path.resolve(cwd), ".wormhole", "events.jsonl");
}

export function createDefaultKernel(cwd: string = process.cwd()) {
  return createInMemoryKernel({
    eventLog: createJsonlEventLog(resolveDefaultEventLogPath(cwd)),
  });
}
