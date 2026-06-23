import { describe, expect, it } from "vitest";
import { reconcileArtifacts } from "../src/reconciliation.js";

describe("artifact reconciliation", () => {
  it("merges compatible child artifacts and keeps provenance", () => {
    const result = reconcileArtifacts([
      {
        artifactId: "A1",
        taskId: "repo",
        summary: "Reuse the existing server route pattern.",
        evidenceIds: ["E1"],
        readSet: ["src/server.ts"],
        writeSet: ["src/server.ts"],
        risks: ["Route validation may need tests."],
      },
      {
        artifactId: "A2",
        taskId: "tests",
        summary: "Add endpoint tests before implementation.",
        evidenceIds: ["E2"],
        readSet: ["tests/server.test.ts"],
        writeSet: ["tests/server.test.ts"],
        risks: ["Fixture setup can hide behavior."],
      },
    ]);

    expect(result.status).toBe("merged");
    expect(result.evidenceIds).toEqual(["E1", "E2"]);
    expect(result.provenance).toEqual(["A1", "A2"]);
    expect(result.conflicts).toEqual([]);
  });

  it("detects write/write conflicts for parent review", () => {
    const result = reconcileArtifacts([
      {
        artifactId: "A1",
        taskId: "repo",
        summary: "Change server behavior.",
        evidenceIds: ["E1"],
        readSet: ["src/server.ts"],
        writeSet: ["src/server.ts"],
        risks: [],
      },
      {
        artifactId: "A2",
        taskId: "api",
        summary: "Change server routing.",
        evidenceIds: ["E2"],
        readSet: ["src/server.ts"],
        writeSet: ["src/server.ts"],
        risks: [],
      },
    ]);

    expect(result.status).toBe("needs_review");
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        path: "src/server.ts",
        kind: "write_write",
      }),
    );
  });
});
