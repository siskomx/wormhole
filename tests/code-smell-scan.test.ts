import { describe, expect, it } from "vitest";
import { scanCodeSmells } from "../src/code-smell-scan.js";
import type { RepoIndex } from "../src/repo-index.js";

describe("code smell scan", () => {
  it("flags changed orphan symbols and complex functions", () => {
    const index = fixtureIndex({
      files: {
        "src/a.ts":
          "export function unusedThing() {\n if (a) { if (b) { if (c) return 1; } }\n return 0;\n}\n",
      },
      symbols: [{ path: "src/a.ts", name: "unusedThing", kind: "function", line: 1 }],
      edges: [],
    });

    const result = scanCodeSmells({
      repoRoot: "/repo",
      index,
      changedFiles: ["src/a.ts"],
      maxComplexity: 2,
    });

    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["potential_dead_code", "complex_function"]),
    );
    expect(result.scope).toBe("changed_files_only");
    expect(result.warning).toContain("not repo-wide reachability");
  });

  it("flags duplicate normalized blocks in changed files", () => {
    const duplicate = "const a = 1;\nconst b = 2;\nconst c = a + b;\nreturn c;\n";
    const index = fixtureIndex({
      files: {
        "src/a.ts": `function one(){\n${duplicate}}\nfunction two(){\n${duplicate}}\n`,
      },
      symbols: [],
      edges: [],
    });

    const result = scanCodeSmells({
      repoRoot: "/repo",
      index,
      changedFiles: ["src/a.ts"],
      duplicateMinLines: 4,
    });

    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "duplicate_block" }));
  });

  it("flags added dependencies that are not referenced by changed files", () => {
    const index = fixtureIndex({
      files: {
        "package.json": '{"dependencies":{"left-pad":"^1.3.0"}}',
        "src/app.ts": "export function run() { return 1; }\n",
      },
      symbols: [],
      edges: [],
    });

    const result = scanCodeSmells({
      repoRoot: "/repo",
      index,
      changedFiles: ["package.json", "src/app.ts"],
      diffText: [
        "diff --git a/package.json b/package.json",
        "@@ -1,3 +1,5 @@",
        ' "dependencies": {',
        '+  "left-pad": "^1.3.0"',
        " }",
        "",
      ].join("\n"),
    });

    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: "needless_dependency", subject: "left-pad" }),
    );
  });
});

function fixtureIndex(input: {
  files: Record<string, string>;
  symbols: Array<{ path: string; name: string; kind: "function" | "class" | "interface" | "type" | "constant"; line: number }>;
  edges: RepoIndex["edges"];
}): RepoIndex {
  return {
    repoRoot: "/repo",
    builtAt: "2026-06-29T00:00:00.000Z",
    buildOptions: { preset: "default", maxFiles: 1000, maxFileBytes: 1000, maxTotalBytes: 100000 },
    fingerprint: "fingerprint",
    files: Object.entries(input.files).map(([path, content]) => ({
      path,
      language: path.endsWith(".ts") ? "typescript" : "json",
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
    truncated: false,
    skippedFiles: [],
  };
}
