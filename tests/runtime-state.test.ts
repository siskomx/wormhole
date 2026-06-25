import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createJsonRuntimeStateStore } from "../src/runtime-state.js";

describe("JSON runtime state store", () => {
  it("persists updates across store instances", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-runtime-state-"));
    const statePath = path.join(root, "state.json");

    try {
      const first = createJsonRuntimeStateStore<{ runs: string[] }>({
        statePath,
        defaultState: { runs: [] },
      });
      first.update((state) => ({ runs: [...state.runs, "run-1"] }));

      const second = createJsonRuntimeStateStore<{ runs: string[] }>({
        statePath,
        defaultState: { runs: [] },
      });

      expect(second.read()).toEqual({ runs: ["run-1"] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
