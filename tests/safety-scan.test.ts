import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  reviewOperationRisk,
  scanRepoForSecrets,
  scanTextForSecrets,
} from "../src/safety-scan.js";

describe("safety scan", () => {
  it("detects and redacts likely secrets in text", () => {
    const findings = scanTextForSecrets({
      source: ".env",
      text: "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456\n",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual(
      expect.objectContaining({
        source: ".env",
        kind: "secret",
        secretType: "openai-api-key",
        line: 1,
        severity: "high",
      }),
    );
    expect(findings[0]?.redacted).toContain("sk-...3456");
  });

  it("scans repositories while skipping dependency and VCS directories", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-secret-scan-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    mkdirSync(path.join(repoRoot, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "config.ts"), "const token = 'ghp_1234567890abcdef1234567890abcdef1234';\n");
    writeFileSync(path.join(repoRoot, "node_modules", "pkg", "ignored.js"), "AWS_SECRET_ACCESS_KEY=ignored\n");

    try {
      const result = scanRepoForSecrets({ repoRoot });

      expect(result.findings.map((finding) => finding.source)).toEqual(["src/config.ts"]);
      expect(result.scannedFiles).toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("flags destructive operations before an agent runs them", () => {
    expect(
      reviewOperationRisk({
        command: "git",
        args: ["push", "--force", "origin", "main"],
      }),
    ).toEqual(
      expect.objectContaining({
        riskLevel: "high",
        requiresExplicitApproval: true,
      }),
    );

    expect(reviewOperationRisk({ command: "npm", args: ["test"] })).toEqual(
      expect.objectContaining({
        riskLevel: "low",
        requiresExplicitApproval: false,
      }),
    );
  });
});
