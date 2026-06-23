import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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

export function readJsonlEvents(logPath: string): EventRecord[] {
  const absolutePath = path.resolve(logPath);
  if (!existsSync(absolutePath)) {
    return [];
  }

  const content = readFileSync(absolutePath, "utf8");
  if (content.trim().length === 0) {
    return [];
  }

  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as EventRecord;
      } catch (error) {
        throw new Error(`Invalid JSONL event at line ${index + 1}: ${(error as Error).message}`);
      }
    });
}
