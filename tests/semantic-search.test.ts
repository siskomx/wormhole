import { describe, expect, it } from "vitest";
import { buildSemanticIndex, semanticSearch } from "../src/semantic-search.js";

describe("semantic search", () => {
  it("builds a deterministic fallback index and ranks related records first", () => {
    const index = buildSemanticIndex({
      records: [
        {
          id: "db",
          path: "src/db.ts",
          text: "Database pool connector retries failed transactions.",
        },
        {
          id: "ui",
          path: "src/button.tsx",
          text: "Button color layout and hover styling.",
        },
      ],
    });

    const result = semanticSearch(index, {
      query: "database connection pool",
      limit: 2,
    });

    expect(index.provider).toBe("deterministic-token-overlap");
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        id: "db",
        path: "src/db.ts",
      }),
    );
    expect(result.results[0]?.score).toBeGreaterThan(result.results[1]?.score ?? 0);
  });

  it("returns no results for empty queries", () => {
    const index = buildSemanticIndex({
      records: [{ id: "one", text: "Anything" }],
    });

    expect(semanticSearch(index, { query: "   " }).results).toEqual([]);
  });
});
