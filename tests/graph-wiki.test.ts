import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionFlowRecord } from "../src/execution-flow-store.js";
import type { GraphCommunityRecord } from "../src/graph-communities.js";
import { renderGraphWiki, writeGraphWiki } from "../src/graph-wiki.js";
import { buildRepoIndex } from "../src/repo-index.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-graph-wiki-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  writeFileSync(path.join(repoRoot, "src", "api.ts"), "export function apiHandler() { return 'ok'; }\n");
  return repoRoot;
}

describe("graph wiki", () => {
  it("renders overview, community, and flow pages from graph structure", () => {
    const repoRoot = createFixtureRepo();
    try {
      const index = buildRepoIndex({ repoRoot });
      const communities: GraphCommunityRecord[] = [
        {
          id: "community:runtime",
          sidecarId: "community-1",
          label: "src",
          members: ["src/api.ts"],
          fileCount: 1,
          symbolCount: 1,
          topFiles: ["src/api.ts"],
        },
      ];
      const flows: ExecutionFlowRecord[] = [
        {
          id: "flow:api",
          name: "api apiHandler",
          kind: "api",
          entrypointId: "entrypoint:api:src/api.ts",
          path: "src/api.ts",
          symbol: "apiHandler",
          downstreamFiles: [],
          communityIds: ["community:runtime"],
          evidence: [],
        },
      ];

      const pages = renderGraphWiki({ repoRoot, index, communities, flows });

      expect(pages.map((page) => page.relativePath)).toEqual(
        expect.arrayContaining([
          ".wormhole/graph-wiki/index.md",
          ".wormhole/graph-wiki/communities/community-runtime.md",
          ".wormhole/graph-wiki/flows/flow-api.md",
        ]),
      );
      expect(pages.find((page) => page.relativePath.endsWith("index.md"))?.content).toContain(
        "Graph Wiki",
      );
      expect(pages.find((page) => page.relativePath.includes("communities"))?.content).toContain(
        "src/api.ts",
      );
      expect(pages.find((page) => page.relativePath.includes("flows"))?.content).toContain(
        "apiHandler",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("writes wiki pages inside the repo and rejects escaping paths", () => {
    const repoRoot = createFixtureRepo();
    try {
      const written = writeGraphWiki({
        repoRoot,
        pages: [
          {
            relativePath: ".wormhole/graph-wiki/index.md",
            content: "# Graph Wiki\n",
          },
        ],
      });

      expect(written.files[0]).toEqual(
        expect.objectContaining({
          relativePath: ".wormhole/graph-wiki/index.md",
          bytes: expect.any(Number),
        }),
      );
      expect(existsSync(path.join(repoRoot, ".wormhole", "graph-wiki", "index.md"))).toBe(true);
      expect(readFileSync(path.join(repoRoot, ".wormhole", "graph-wiki", "index.md"), "utf8")).toContain(
        "Graph Wiki",
      );

      expect(() =>
        writeGraphWiki({
          repoRoot,
          pages: [{ relativePath: "../escape.md", content: "bad\n" }],
        }),
      ).toThrow("Graph wiki path must stay within repoRoot");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
