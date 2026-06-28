import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { EventRecord } from "./kernel.js";

export type EventLog = {
  append(event: EventRecord): void;
};

export type JsonlEventReplayOptions =
  | {
      tolerateTrailingCorruption?: false;
      report?: false;
    }
  | {
      tolerateTrailingCorruption: true;
      report?: false;
    }
  | {
      tolerateTrailingCorruption: true;
      report: true;
    };

export type JsonlEventReplayReport = {
  events: EventRecord[];
  skippedLineCount: number;
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

export function readJsonlEvents(logPath: string): EventRecord[];
export function readJsonlEvents(
  logPath: string,
  options: { tolerateTrailingCorruption: true; report: true },
): JsonlEventReplayReport;
export function readJsonlEvents(
  logPath: string,
  options?: JsonlEventReplayOptions,
): EventRecord[] | JsonlEventReplayReport {
  const absolutePath = path.resolve(logPath);
  if (!existsSync(absolutePath)) {
    return options?.report ? { events: [], skippedLineCount: 0 } : [];
  }

  const content = readFileSync(absolutePath, "utf8");
  if (content.trim().length === 0) {
    return options?.report ? { events: [], skippedLineCount: 0 } : [];
  }

  const lines = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const events: EventRecord[] = [];
  let skippedLineCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    try {
      events.push(JSON.parse(line) as EventRecord);
    } catch (error) {
      if (options?.tolerateTrailingCorruption && index === lines.length - 1) {
        skippedLineCount += 1;
        continue;
      }
      throw new Error(`Invalid JSONL event at line ${index + 1}: ${(error as Error).message}`);
    }
  }
  return options?.report ? { events, skippedLineCount } : events;
}
