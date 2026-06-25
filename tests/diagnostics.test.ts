import { describe, expect, it } from "vitest";
import {
  createDiagnosticStore,
  normalizeCommandDiagnostics,
  normalizeLspDiagnostics,
} from "../src/diagnostics.js";

describe("structured diagnostics", () => {
  it("normalizes TypeScript, test, and generic command diagnostics", () => {
    const diagnostics = normalizeCommandDiagnostics({
      source: "npm test",
      output: [
        "src/app.ts(12,5): error TS2345: Argument of type string is not assignable",
        "FAIL tests/app.test.ts > rejects invalid user",
        "Error: src/server.ts:8:3 route failed",
      ].join("\n"),
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        source: "npm test",
        severity: "error",
        file: "src/app.ts",
        line: 12,
        column: 5,
        code: "TS2345",
      }),
      expect.objectContaining({
        severity: "error",
        file: "tests/app.test.ts",
        message: "FAIL tests/app.test.ts > rejects invalid user",
      }),
      expect.objectContaining({
        severity: "error",
        file: "src/server.ts",
        line: 8,
        column: 3,
      }),
    ]);
  });

  it("normalizes LSP diagnostics and persists diagnostic records", () => {
    const store = createDiagnosticStore();
    const diagnostics = normalizeLspDiagnostics({
      uri: "file:///repo/src/app.ts",
      diagnostics: [
        {
          range: {
            start: { line: 3, character: 2 },
            end: { line: 3, character: 8 },
          },
          severity: 1,
          code: "no-unused-vars",
          message: "Unused variable",
          source: "eslint",
        },
      ],
    });

    const recorded = store.recordMany(diagnostics);

    expect(recorded[0]).toEqual(
      expect.objectContaining({
        file: "/repo/src/app.ts",
        line: 4,
        column: 3,
        severity: "error",
        source: "eslint",
      }),
    );
    expect(store.query({ severity: "error" }).diagnostics).toHaveLength(1);
    expect(createDiagnosticStore(store.snapshot()).query({ file: "app.ts" }).diagnostics[0]?.message).toBe(
      "Unused variable",
    );
  });
});
