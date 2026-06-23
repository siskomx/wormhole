import { describe, expect, it } from "vitest";
import {
  compactCommandOutput,
  compressContext,
  createDenseSummary,
  reviewMinimality,
} from "../src/optimization.js";

describe("first-party optimization primitives", () => {
  it("compacts command output while preserving important diagnostics", () => {
    const content = [
      "starting build",
      ...Array.from({ length: 40 }, (_, index) => `info line ${index}`),
      "ERROR failed to compile src/kernel.ts",
      ...Array.from({ length: 40 }, (_, index) => `debug tail ${index}`),
      "build exited with code 1",
    ].join("\n");

    const result = compactCommandOutput({
      content,
      maxLines: 12,
      maxChars: 800,
    });

    expect(result.kind).toBe("command_output_compaction");
    expect(result.content).toContain("ERROR failed to compile src/kernel.ts");
    expect(result.content).toContain("build exited with code 1");
    expect(result.content).toContain("omitted");
    expect(result.droppedLineCount).toBeGreaterThan(0);
    expect(result.optimizedCharCount).toBeLessThan(result.originalCharCount);
  });

  it("compresses context items without dropping provenance ids", () => {
    const result = compressContext({
      items: [
        {
          id: "E1",
          source: "src/kernel.ts",
          text: "The kernel owns mission state, gate state, evidence records, and final artifact emission.",
        },
        {
          id: "E2",
          source: "src/tools.ts",
          text: "The tool layer forwards generic MCP-style inputs into the kernel.",
        },
      ],
      maxCharsPerItem: 42,
    });

    expect(result.kind).toBe("context_compression");
    expect(result.content).toContain("[E1] src/kernel.ts");
    expect(result.content).toContain("[E2] src/tools.ts");
    expect(result.content).toContain("...");
  });

  it("creates dense summaries as short deterministic bullets", () => {
    const result = createDenseSummary({
      text: "Wormhole records evidence before plans. The gate blocks final artifacts when blocking questions remain. This keeps planning grounded in repo facts.",
      maxBullets: 2,
      maxBulletLength: 80,
    });

    expect(result.kind).toBe("dense_summary");
    expect(result.bullets).toHaveLength(2);
    expect(result.content).toContain("- Wormhole records evidence before plans.");
    expect(result.content).toContain("- The gate blocks final artifacts");
  });

  it("reviews plans for minimality risks", () => {
    const result = reviewMinimality({
      objective: "Add audit logging to the existing service.",
      planSteps: [
        "Create a new Kubernetes microservice with a distributed event bus.",
        "Wire the existing request handler to emit audit events.",
      ],
    });

    expect(result.kind).toBe("minimality_review");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        severity: "high",
        phrase: "kubernetes",
      }),
    );
    expect(result.content).toContain("Prefer the smallest change");
  });
});
