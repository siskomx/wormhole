import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGraphArtifacts } from "../src/graph-artifacts.js";
import { buildRepoIndex } from "../src/repo-index.js";

describe("graph artifacts", () => {
  it("exports graph.json, report markdown, and static html from a repo index", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-graph-artifacts-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "api.ts"),
      [
        'import { db } from "./db";',
        "",
        "export function api() {",
        '  return `<script>${db}</script>`;',
        "}",
      ].join("\n"),
    );
    writeFileSync(
      path.join(repoRoot, "src", "db.ts"),
      ["export const db = 'sqlite';", ""].join("\n"),
    );

    try {
      const index = buildRepoIndex({ repoRoot });
      const artifacts = createGraphArtifacts(index, {
        communities: [
          {
            id: "community-1<script>",
            members: ["src/api.ts", "src/db.ts", "<script>alert(1)</script>"],
          },
        ],
      });
      const graph = JSON.parse(artifacts.graphJson) as {
        repoRoot: string;
        builtAt: string;
        files: Array<{ path: string }>;
        symbols: Array<{ id: string }>;
        edges: Array<{ from: string; to: string }>;
        communities: Array<{ id: string; members: string[] }>;
      };

      expect(graph.repoRoot).toBe(repoRoot);
      expect(graph.builtAt).toBe(index.builtAt);
      expect(graph.files.map((file) => file.path)).toEqual(
        expect.arrayContaining(["src/api.ts", "src/db.ts"]),
      );
      expect(graph.symbols.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
      expect(graph.communities).toEqual([
        {
          id: "community-1<script>",
          members: ["src/api.ts", "src/db.ts", "<script>alert(1)</script>"],
        },
      ]);
      expect(artifacts.reportMarkdown).toContain("# Wormhole Graph Report");
      expect(artifacts.reportMarkdown).toContain("Native Repo Graph Report");
      expect(artifacts.reportMarkdown).toContain("community-1");
      expect(artifacts.reportMarkdown).toContain("&lt;script&gt;alert\\(1\\)&lt;/script&gt;");
      expect(artifacts.reportMarkdown).not.toContain("<script>");
      expect(artifacts.graphHtml).toContain("<!doctype html>");
      expect(artifacts.graphHtml).toContain("Top Files");
      expect(artifacts.graphHtml).toContain("&lt;script&gt;");
      expect(artifacts.graphHtml).not.toContain("<script>");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
