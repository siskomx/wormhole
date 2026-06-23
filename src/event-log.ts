import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { EventRecord } from "./kernel.js";

export type EventLog = {
  append(event: EventRecord): void;
};

export function createJsonlEventLog(logPath: string): EventLog {
  const absolutePath = path.resolve(logPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });

  return {
    append(event: EventRecord): void {
      appendFileSync(absolutePath, `${JSON.stringify(event)}\n`, "utf8");
    },
  };
}
