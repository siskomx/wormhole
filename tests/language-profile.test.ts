import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectLanguageProfile, languageForPath } from "../src/language-profile.js";

describe("language profile", () => {
  it("reports supported source language coverage from indexed files", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-language-profile-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = true;\n");
    writeFileSync(path.join(repoRoot, "src", "lib.rs"), "pub fn run() {}\n");

    const profile = detectLanguageProfile({ repoRoot, indexedFiles: ["src/app.ts"] });
    const byLanguage = new Map(profile.languages.map((language) => [language.language, language]));

    expect(byLanguage.get("typescript")).toMatchObject({ supportLevel: "supported", status: "ok" });
    expect(byLanguage.get("rust")).toMatchObject({ supportLevel: "supported", status: "blocker" });
    expect(profile.health.status).toBe("blocker");
  });

  it("preserves profile walk metadata and prefixes walker limit health reasons", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-language-profile-walk-"));
    mkdirSync(path.join(repoRoot, "src", "deep"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "app.ts"), "export const app = true;\n");
    writeFileSync(path.join(repoRoot, "src", "deep", "hidden.ts"), "export const hidden = true;\n");

    const profile = detectLanguageProfile({
      repoRoot,
      indexedFiles: ["src/app.ts"],
      maxDepth: 1,
    });

    expect(profile.walk).toEqual(
      expect.objectContaining({
        hitLimit: true,
        reasons: ["depth_limit"],
        skipped: expect.arrayContaining([{ path: "src/app.ts", reason: "depth_limit" }]),
      }),
    );
    expect(profile.health.reasons).toContain("profile_walk_depth_limit");
  });

  it("keeps Go and Java outside the supported parser set until package compatibility is verified", () => {
    expect(languageForPath("main.go")).toBe("unknown");
    expect(languageForPath("src/App.java")).toBe("unknown");
  });
});
