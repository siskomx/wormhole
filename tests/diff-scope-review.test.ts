import { describe, expect, it } from "vitest";
import { reviewDiffScope } from "../src/diff-scope-review.js";

describe("diff scope review", () => {
  it("passes strict review when a changed file is backed by evidence", () => {
    const result = reviewDiffScope({
      repoRoot: "/repo",
      objective: "Add auth route validation",
      diffText: [
        "diff --git a/src/auth/routes.ts b/src/auth/routes.ts",
        "@@ -1,1 +1,2 @@",
        " export const routes = [];",
        "+export const validateAuthRoute = true;",
        "",
      ].join("\n"),
      evidence: [{ sourcePath: "src/auth/routes.ts", summary: "Auth route file owns validation." }],
      strict: true,
    });

    expect(result.decision).toBe("pass");
    expect(result.changedFiles).toEqual(["src/auth/routes.ts"]);
    expect(result.findings).toEqual([]);
  });

  it("fails strict review for unrelated file changes without evidence", () => {
    const result = reviewDiffScope({
      repoRoot: "/repo",
      objective: "Fix billing webhook validation",
      diffText: [
        "diff --git a/src/theme/colors.ts b/src/theme/colors.ts",
        "@@ -1,1 +1,2 @@",
        " export const primary = 'blue';",
        "+export const party = 'pink';",
        "",
      ].join("\n"),
      strict: true,
    });

    expect(result.decision).toBe("fail");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        kind: "unjustified_file",
        path: "src/theme/colors.ts",
        severity: "error",
      }),
    );
  });

  it("warns rather than fails in non-strict mode", () => {
    const result = reviewDiffScope({
      repoRoot: "/repo",
      objective: "Fix billing webhook validation",
      diffText: [
        "diff --git a/src/theme/colors.ts b/src/theme/colors.ts",
        "@@ -1,1 +1,2 @@",
        " export const primary = 'blue';",
        "+export const party = 'pink';",
        "",
      ].join("\n"),
    });

    expect(result.decision).toBe("warn");
    expect(result.findings[0]?.severity).toBe("warning");
  });

  it("allows explicitly approved paths", () => {
    const result = reviewDiffScope({
      repoRoot: "/repo",
      objective: "Fix billing webhook validation",
      diffText: [
        "diff --git a/docs/release-notes.md b/docs/release-notes.md",
        "@@ -1,1 +1,2 @@",
        " # Release",
        "+Billing webhook validation changed.",
        "",
      ].join("\n"),
      approvedPaths: ["docs"],
      strict: true,
    });

    expect(result.decision).toBe("pass");
  });
});
