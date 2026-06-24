import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const publicTextFiles = [
  "README.md",
  "docs/architecture/orchestration-adaptive-capabilities.md",
  "docs/contracts/capability-manifest.md",
  "docs/planning/wormhole-canonical-plan.md",
  "plugins/wormhole-claude-desktop/manifest.json",
  "plugins/wormhole/.codex-plugin/plugin.json",
];

describe("public capability naming", () => {
  it("uses capability areas instead of version-track product labels", () => {
    const combined = publicTextFiles
      .map((filePath) => readFileSync(path.resolve(filePath), "utf8"))
      .join("\n");

    expect(combined).not.toMatch(/\b[Vv][123]\b|v[123]\./);
    expect(combined).toContain("core");
    expect(combined).toContain("orchestration");
    expect(combined).toContain("adaptive");
  });
});
