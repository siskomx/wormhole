import { describe, expect, it } from "vitest";
import { extractRepoFileFacts } from "../src/repo-index-extraction.js";

describe("repo index extraction", () => {
  it("extracts TypeScript symbols, imports, and call drafts through the parser path", () => {
    const result = extractRepoFileFacts({
      path: "src/app.ts",
      language: "typescript",
      content: [
        "import { loadUser } from './user';",
        "export function handleRequest() {",
        "  return loadUser();",
        "}",
        "export const value = 1;",
        "",
      ].join("\n"),
    });

    expect(result.parser.language).toBe("typescript");
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(["handleRequest", "value"]),
    );
    expect(result.edgeDrafts).toContainEqual(
      expect.objectContaining({ kind: "imports", specifier: "./user" }),
    );
    expect(result.callDrafts).toContainEqual(
      expect.objectContaining({ callerName: "handleRequest", calleeName: "loadUser" }),
    );
  });

  it("uses fallback extraction for non-parser markdown files", () => {
    const result = extractRepoFileFacts({
      path: "README.md",
      language: "markdown",
      content: "# Title\n\nSee [App](src/app.ts).\n",
    });

    expect(result.parser.engine).toBe("fallback");
    expect(result.symbols).toContainEqual(expect.objectContaining({ name: "Title", kind: "section" }));
    expect(result.edgeDrafts).toContainEqual(
      expect.objectContaining({ kind: "links", specifier: "src/app.ts" }),
    );
  });
});
