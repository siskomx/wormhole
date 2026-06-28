import { describe, expect, it } from "vitest";
import { createIndexHealthSnapshot } from "../src/index-health.js";

describe("index health snapshots", () => {
  it("classifies fresh complete indexes as usable", () => {
    const health = createIndexHealthSnapshot({
      source: "repo_index",
      present: true,
      fresh: true,
      truncated: false,
      builtAt: "2026-06-28T00:00:00.000Z",
      fingerprint: "abc",
      fileCount: 2,
    });

    expect(health).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        source: "repo_index",
        status: "fresh",
        fresh: true,
        truncated: false,
        recommendedAction: "use_as_is",
        skippedFileCount: 0,
      }),
    );
    expect(health.reasons).toEqual([]);
  });

  it("classifies truncated indexes as degraded with capped sorted skipped-file samples", () => {
    const skippedFiles = Array.from({ length: 30 }, (_, index) => `src/${String(30 - index).padStart(2, "0")}.ts`);

    const health = createIndexHealthSnapshot({
      source: "repo_index",
      present: true,
      fresh: true,
      truncated: true,
      fileCount: 10,
      skippedFiles,
    });

    expect(health.status).toBe("degraded");
    expect(health.recommendedAction).toBe("inspect_index_limits");
    expect(health.skippedFileCount).toBe(30);
    expect(health.skippedFiles).toHaveLength(20);
    expect(health.skippedFiles).toEqual([...skippedFiles].sort().slice(0, 20));
    expect(health.reasons).toContain("Index is truncated; some repository files were not indexed.");
  });

  it("calls out skipped generated API contract artifacts", () => {
    const health = createIndexHealthSnapshot({
      source: "durable_repo_index",
      present: true,
      fresh: true,
      truncated: true,
      skippedFiles: [
        "public/api-docs/openapi.json",
        "public/api-docs/openapi-agents.json",
        "src/generated/openapi.ts",
      ],
    });

    expect(health.status).toBe("degraded");
    expect(health.reasons.join("\n")).toContain("Skipped generated/API contract artifacts");
    expect(health.reasons.join("\n")).toContain("src/generated/openapi.ts");
  });

  it("classifies stale, missing, and unknown index state with closed actions", () => {
    expect(
      createIndexHealthSnapshot({
        source: "durable_repo_index",
        present: true,
        fresh: false,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "stale",
        recommendedAction: "refresh_index",
      }),
    );

    expect(
      createIndexHealthSnapshot({
        source: "durable_repo_index",
        present: false,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "missing",
        recommendedAction: "build_index",
      }),
    );

    expect(
      createIndexHealthSnapshot({
        source: "project_model",
        present: true,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "unknown",
        recommendedAction: "refresh_index",
      }),
    );
  });
});
