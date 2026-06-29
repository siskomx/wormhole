import { describe, expect, it } from "vitest";
import { loadTreeSitterLanguage, supportedTreeSitterLanguages } from "../src/tree-sitter-loader.js";

describe("tree-sitter loader", () => {
  it("advertises the parser-backed language set explicitly", () => {
    expect(supportedTreeSitterLanguages()).toEqual([
      "csharp",
      "javascript",
      "python",
      "rust",
      "tsx",
      "typescript",
    ]);
  });

  it("loads the TypeScript grammar through the shared loader", () => {
    const loaded = loadTreeSitterLanguage("typescript");

    expect(loaded.available).toBe(true);
  });
});
