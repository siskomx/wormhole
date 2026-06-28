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

  it("ranks code context above doc context for equal query matches", () => {
    const store = createContextStore();
    const doc = store.record({
      source: "docs/accounting.md",
      sourceType: "doc",
      text: "Accounting period closing uses ledger validation.",
      tags: ["accounting"],
    });
    const code = store.record({
      source: "src/features/accounting/AccountingService.ts",
      sourceType: "file",
      text: "Accounting period closing uses ledger validation.",
      tags: ["accounting"],
    });

    const query = store.query({ query: "accounting period ledger", limit: 2 });

    expect(query.results.map((record) => record.contextId)).toEqual([code.contextId, doc.contextId]);
    expect(query.results[0]?.sourceAuthority?.authority).toBe("current_code");
    expect(query.results[1]?.sourceAuthority?.authority).toBe("supporting_doc");
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

  it("reviews context pack budget with pinned, stale, and changed-file eviction reasons", () => {
    const store = createContextStore();
    const pinned = store.record({
      source: "src/critical.ts",
      sourceType: "file",
      text: "Critical payment routing evidence must stay in the pack.",
      tags: ["payment", "routing"],
    });
    const changed = store.record({
      source: "src/changed.ts",
      sourceType: "file",
      text: "Changed file context is relevant to the current mission delta.",
      tags: ["delta"],
    });
    const stale = store.record({
      source: "src/stale.ts",
      sourceType: "file",
      text: "Old stale implementation notes should be replaced.",
      tags: ["old"],
    });
    const unrelated = store.record({
      source: "docs/noise.md",
      sourceType: "doc",
      text: "Unrelated background text that should be evicted under the budget.",
      tags: ["noise"],
    });

    const review = store.reviewPackBudget({
      objective: "Refresh payment routing plan",
      query: "payment changed routing",
      maxChars: 180,
      recordIds: [unrelated.contextId, stale.contextId, changed.contextId, pinned.contextId],
      pinnedRecordIds: [pinned.contextId],
      staleRecordIds: [stale.contextId],
      changedFiles: ["src/changed.ts"],
    });

    expect(review.retained.map((record) => record.contextId)).toEqual([pinned.contextId, changed.contextId]);
    expect(review.evicted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contextId: stale.contextId,
          reason: "stale",
        }),
        expect.objectContaining({
          contextId: unrelated.contextId,
          reason: "budget",
        }),
      ]),
    );
    expect(review.stats.evictedCount).toBe(2);
    expect(review.stats.retainedChars).toBeLessThanOrEqual(180);
  });

  it("refreshes a context pack from budget review retained records", () => {
    const store = createContextStore();
    const retained = store.record({
      source: "src/mission.ts",
      sourceType: "file",
      text: "Mission state and context refresh should remain available.",
      tags: ["mission"],
    });
    const stale = store.record({
      source: "src/old.ts",
      sourceType: "file",
      text: "Old context should leave refreshed packs.",
      tags: ["stale"],
    });

    const refreshed = store.refreshPack({
      objective: "Refresh mission context",
      query: "mission context",
      maxChars: 160,
      recordIds: [retained.contextId, stale.contextId],
      staleRecordIds: [stale.contextId],
    });

    expect(refreshed.pack.contextIds).toEqual([retained.contextId]);
    expect(refreshed.review.evicted.map((record) => record.contextId)).toEqual([stale.contextId]);
    expect(store.renderPack({ packId: refreshed.pack.packId })).toContain("Mission state");
  });
});
