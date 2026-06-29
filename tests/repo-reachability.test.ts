import { describe, expect, it } from "vitest";
import { analyzeRepoReachability } from "../src/repo-reachability.js";
import type { RepoIndex } from "../src/repo-index.js";

describe("repo reachability analysis", () => {
  it("marks unreferenced source as a candidate pending review without deletion authority", () => {
    const index = fixtureIndex({
      files: {
        "src/main.ts": "import { run } from './used';\nrun();\n",
        "src/used.ts": "export function run() { return 'ok'; }\n",
        "src/unused.ts": "export function staleHelper() { return 'stale'; }\n",
      },
      symbols: [
        { path: "src/main.ts", name: "main", kind: "function", line: 1 },
        { path: "src/used.ts", name: "run", kind: "function", line: 1 },
        { path: "src/unused.ts", name: "staleHelper", kind: "function", line: 1 },
      ],
      edges: [
        {
          from: "src/main.ts",
          to: "src/used.ts",
          kind: "imports",
          provenance: "extracted",
          confidence: 1,
          line: 1,
          label: "./used",
        },
      ],
    });

    const result = analyzeRepoReachability({
      repoRoot: "/repo",
      index,
      entrypoints: ["src/main.ts"],
    });

    expect(result.requiresHumanApproval).toBe(true);
    expect(JSON.stringify(result)).not.toContain("safe_remove");
    expect(result.summary.categories.candidate_remove_pending_review).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        path: "src/unused.ts",
        category: "candidate_remove_pending_review",
        blockers: [],
      }),
    );
    expect(result.findings.find((finding) => finding.path === "src/unused.ts")?.advisoryCommands.join(" ")).not.toMatch(
      /\brm\b|Remove-Item|del\s/i,
    );
  });

  it("keeps framework routes, dynamic import targets, and manual evidence out of removal candidates", () => {
    const index = fixtureIndex({
      files: {
        "src/main.ts": "const name = 'panel';\nvoid import(`./widgets/${name}`);\n",
        "src/widgets/panel.ts": "export const panel = true;\n",
        "src/widgets-extra/panel.ts": "export const unrelated = true;\n",
        "src/app/api/users/route.ts": "export function GET() { return Response.json([]); }\n",
        "src/rss/RssFetcher.ts": "export async function fetchRss() { return []; }\n",
      },
      symbols: [
        { path: "src/widgets/panel.ts", name: "panel", kind: "constant", line: 1 },
        { path: "src/app/api/users/route.ts", name: "GET", kind: "function", line: 1 },
        { path: "src/rss/RssFetcher.ts", name: "fetchRss", kind: "function", line: 1 },
      ],
      edges: [],
    });

    const result = analyzeRepoReachability({
      repoRoot: "/repo",
      index,
      entrypoints: ["src/main.ts"],
      knownUsedFiles: ["src/rss/RssFetcher.ts"],
    });

    expect(result.findings).toContainEqual(
      expect.objectContaining({ path: "src/widgets/panel.ts", category: "manual_review" }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ path: "src/widgets-extra/panel.ts", category: "candidate_remove_pending_review" }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ path: "src/app/api/users/route.ts", category: "likely_used" }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ path: "src/rss/RssFetcher.ts", category: "likely_used" }),
    );
  });

  it("treats Knip input as heuristic evidence and preserves workspace boundary blockers", () => {
    const index = fixtureIndex({
      files: {
        "packages/server/src/index.ts": "import { shared } from '../../shared/src/shared';\nshared();\n",
        "packages/shared/src/shared.ts": "export function shared() { return true; }\n",
      },
      symbols: [{ path: "packages/shared/src/shared.ts", name: "shared", kind: "function", line: 1 }],
      edges: [
        {
          from: "packages/server/src/index.ts",
          to: "packages/shared/src/shared.ts",
          kind: "imports",
          provenance: "extracted",
          confidence: 1,
          line: 1,
          label: "../../shared/src/shared",
        },
      ],
    });

    const result = analyzeRepoReachability({
      repoRoot: "/repo",
      index,
      entrypoints: ["packages/server/src/index.ts"],
      packageRoots: ["packages/server", "packages/shared"],
      knipUnusedFiles: ["packages/shared/src/shared.ts"],
    });

    const shared = result.findings.find((finding) => finding.path === "packages/shared/src/shared.ts");
    expect(shared).toEqual(expect.objectContaining({ category: "likely_used" }));
    expect(shared?.blockers).toContainEqual(expect.objectContaining({ kind: "boundary_blocker" }));
    expect(shared?.evidence).toContainEqual(expect.objectContaining({ source: "knip" }));
  });

  it("returns unknown instead of a removal candidate when reachability coverage is incomplete", () => {
    const index = fixtureIndex({
      files: {
        "src/orphan.ts": "export const orphan = true;\n",
      },
      symbols: [{ path: "src/orphan.ts", name: "orphan", kind: "constant", line: 1 }],
      edges: [],
      truncated: true,
    });

    const result = analyzeRepoReachability({
      repoRoot: "/repo",
      index,
      entrypoints: [],
    });

    expect(result.findings).toContainEqual(expect.objectContaining({ path: "src/orphan.ts", category: "unknown" }));
    expect(result.summary.categories.candidate_remove_pending_review).toBe(0);
  });
});

function fixtureIndex(input: {
  files: Record<string, string>;
  symbols: Array<{ path: string; name: string; kind: "function" | "class" | "interface" | "type" | "constant"; line: number }>;
  edges: RepoIndex["edges"];
  truncated?: boolean;
}): RepoIndex {
  return {
    repoRoot: "/repo",
    builtAt: "2026-06-29T00:00:00.000Z",
    buildOptions: { preset: "default", maxFiles: 1000, maxFileBytes: 1000, maxTotalBytes: 100000 },
    fingerprint: "fingerprint",
    files: Object.entries(input.files).map(([path, content]) => ({
      path,
      language: path.endsWith(".tsx") ? "typescript" : path.endsWith(".ts") ? "typescript" : "text",
      lineCount: content.split("\n").length,
      byteLength: content.length,
      mtimeMs: 0,
      hash: path,
      symbols: [],
      content,
    })),
    symbols: input.symbols.map((symbol) => ({
      id: `${symbol.path}#${symbol.name}:${symbol.line}`,
      ...symbol,
    })),
    edges: input.edges,
    truncated: input.truncated ?? false,
    skippedFiles: [],
  };
}
