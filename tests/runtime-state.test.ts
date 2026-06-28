import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

  it("preserves corrupt JSON before falling back to defaults", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-runtime-state-corrupt-"));
    const statePath = path.join(root, "state.json");
    writeFileSync(statePath, "{not-json", "utf8");

    try {
      const store = createJsonRuntimeStateStore<{ runs: string[] }>({
        statePath,
        defaultState: { runs: [] },
      });

      expect(store.read()).toEqual({ runs: [] });
      expect(readdirSync(root).some((name) => name.endsWith(".corrupt"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
