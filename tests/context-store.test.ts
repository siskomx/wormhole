import { describe, expect, it } from "vitest";
import { createContextStore } from "../src/context-store.js";

describe("native context store", () => {
  it("records context with stable content ids and retrieves ranked results", () => {
    const store = createContextStore();
    const first = store.record({
      source: "src/kernel.ts",
      sourceType: "file",
      text: "The kernel owns mission state, gate state, and evidence records.",
      tags: ["kernel", "evidence"],
    });
    const second = store.record({
      source: "docs/architecture/orchestration-adaptive-capabilities.md",
      sourceType: "doc",
      text: "The graph index supports query, explain, and dependency path tools.",
      tags: ["graph"],
    });

    const query = store.query({ query: "evidence gate state", limit: 2 });

    expect(first.contextId).toMatch(/^ctx:sha256:/);
    expect(second.contentHash).toMatch(/^sha256:/);
    expect(query.results[0]).toEqual(
      expect.objectContaining({
        contextId: first.contextId,
        score: expect.any(Number),
      }),
    );
  });

  it("creates and renders budgeted context packs with provenance", () => {
    const store = createContextStore();
    const first = store.record({
      source: "src/a.ts",
      sourceType: "file",
      text: "Database pool setup belongs in the existing connector module.",
      tags: ["database"],
    });
    store.record({
      source: "src/b.ts",
      sourceType: "file",
      text: "A new unrelated analytics dashboard can wait.",
      tags: ["analytics"],
    });

    const pack = store.createPack({
      objective: "Plan database connector changes",
      query: "database connector",
      maxChars: 160,
    });
    const rendered = store.renderPack({ packId: pack.packId });

    expect(pack.contextIds).toContain(first.contextId);
    expect(pack.rendered).toContain("[1] src/a.ts");
    expect(pack.stats.includedCount).toBeGreaterThan(0);
    expect(rendered).toBe(pack.rendered);
  });

  it("restores records and packs from a snapshot", () => {
    const first = createContextStore();
    const record = first.record({
      source: "src/tools.ts",
      sourceType: "file",
      text: "Runtime state wires context packs into persisted handler state.",
      tags: ["runtime"],
    });
    const pack = first.createPack({
      objective: "Persist runtime context",
      query: "runtime context",
      maxChars: 240,
    });

    const second = createContextStore(first.snapshot());

    expect(second.query({ query: "runtime context", limit: 1 }).results[0]?.contextId).toBe(
      record.contextId,
    );
    expect(second.renderPack({ packId: pack.packId })).toBe(pack.rendered);
  });
});
