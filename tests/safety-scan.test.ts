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
      expect(result.candidateFiles).toBe(1);
      expect(result.scannedFiles).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.skippedFiles).toEqual([]);
      expect(result.skipReasons).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports deterministic skipped files and combined skip reasons", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-secret-scan-limits-"));
    writeFileSync(path.join(repoRoot, "a-large.txt"), "x".repeat(12));
    writeFileSync(path.join(repoRoot, "b-first.txt"), "OPENAI_API_KEY=placeholder\n");
    writeFileSync(path.join(repoRoot, "c-over-limit.txt"), "OPENAI_API_KEY=placeholder\n");

    try {
      const result = scanRepoForSecrets({ repoRoot, maxFiles: 2, maxFileBytes: 4 });

      expect(result.candidateFiles).toBe(2);
      expect(result.scannedFiles).toBe(0);
      expect(result.truncated).toBe(true);
      expect(result.skippedFiles).toEqual([
        { path: "c-over-limit.txt", reason: "file_limit" },
        { path: "a-large.txt", reason: "file_size_limit" },
        { path: "b-first.txt", reason: "file_size_limit" },
      ]);
      expect(result.skipReasons).toEqual(["file_limit", "file_size_limit"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports real env files generically during repository scans", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-secret-scan-env-"));
    writeFileSync(path.join(repoRoot, ".env"), "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456\n");
    writeFileSync(path.join(repoRoot, ".env.example"), "OPENAI_API_KEY=\n");

    try {
      const result = scanRepoForSecrets({ repoRoot, maxFileBytes: 4 });
      const serialized = JSON.stringify(result);

      expect(result.findings).toContainEqual(
        expect.objectContaining({
          source: ".env",
          secretType: "sensitive-env-file",
          redacted: "[sensitive env file]",
        }),
      );
      expect(result.scannedFiles).toBe(1);
      expect(result.skippedFiles).toEqual([{ path: ".env.example", reason: "file_size_limit" }]);
      expect(result.skipReasons).toEqual(["file_size_limit"]);
      expect(serialized).not.toContain("openai-api-key");
      expect(serialized).not.toContain("sk-proj");
      expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
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
