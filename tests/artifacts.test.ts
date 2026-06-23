import { describe, expect, it } from "vitest";
import { createArtifactRecord } from "../src/artifacts.js";

describe("typed artifact records", () => {
  it("creates richer artifact types with provenance", () => {
    const artifact = createArtifactRecord({
      missionId: "M1",
      type: "html_workbench",
      title: "Workbench",
      content: "<html></html>",
      evidenceIds: ["E1"],
      taskIds: ["T1"],
    });

    expect(artifact.artifactId).toBeDefined();
    expect(artifact.type).toBe("html_workbench");
    expect(artifact.evidenceIds).toEqual(["E1"]);
    expect(artifact.taskIds).toEqual(["T1"]);
  });
});
