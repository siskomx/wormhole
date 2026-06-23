import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDefaultEventLogPath } from "../src/runtime.js";

describe("runtime defaults", () => {
  it("stores the default event log under .wormhole in the working directory", () => {
    const cwd = path.resolve("C:/work/repo");

    expect(resolveDefaultEventLogPath(cwd)).toBe(
      path.join(cwd, ".wormhole", "events.jsonl"),
    );
  });
});
