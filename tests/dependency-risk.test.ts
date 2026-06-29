import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDependencyRiskReport,
  parseDependencyAuditJson,
  parseDependencyOutdatedJson,
  runDependencyAuditLive,
} from "../src/dependency-risk.js";

describe("dependency risk", () => {
  it("parses npm audit vulnerabilities with CVE and fix metadata", () => {
    const report = parseDependencyAuditJson({
      repoRoot: "/repo",
      auditJson: JSON.stringify({
        vulnerabilities: {
          lodash: {
            name: "lodash",
            severity: "high",
            range: "<4.17.21",
            via: [
              {
                source: 1106913,
                name: "CVE-2021-23337",
                title: "Command Injection",
                url: "https://example.test/cve",
                severity: "high",
              },
            ],
            effects: [],
            nodes: ["node_modules/lodash"],
            fixAvailable: { name: "lodash", version: "4.17.21", isSemVerMajor: false },
          },
        },
      }),
    });

    expect(report.vulnerabilities).toContainEqual(
      expect.objectContaining({
        packageName: "lodash",
        severity: "high",
        identifiers: ["CVE-2021-23337"],
        fixAvailable: true,
        fixVersion: "4.17.21",
      }),
    );
  });

  it("parses npm outdated rows and classifies drift", () => {
    const report = parseDependencyOutdatedJson({
      repoRoot: "/repo",
      outdatedJson: JSON.stringify({
        leftpad: { current: "1.0.0", wanted: "1.0.1", latest: "2.0.0", type: "dependencies" },
        zod: { current: "4.0.0", wanted: "4.1.0", latest: "4.1.0", type: "devDependencies" },
      }),
    });

    expect(report.outdated).toContainEqual(
      expect.objectContaining({ packageName: "leftpad", drift: "major", current: "1.0.0", latest: "2.0.0" }),
    );
    expect(report.outdated).toContainEqual(
      expect.objectContaining({ packageName: "zod", drift: "minor", wanted: "4.1.0" }),
    );
  });

  it("combines local license findings with audit and outdated provider output", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-dep-risk-"));
    try {
      writeFileSync(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ dependencies: { lodash: "4.17.20" }, devDependencies: { vitest: "4.0.0" } }),
      );
      writeFileSync(
        path.join(repoRoot, "package-lock.json"),
        JSON.stringify({
          packages: {
            "": { dependencies: { lodash: "4.17.20" }, devDependencies: { vitest: "4.0.0" } },
            "node_modules/lodash": { version: "4.17.20" },
            "node_modules/vitest": { version: "4.0.0", license: "MIT" },
          },
        }),
      );

      const report = createDependencyRiskReport({
        repoRoot,
        auditJson: JSON.stringify({
          vulnerabilities: {
            lodash: { name: "lodash", severity: "high", range: "<4.17.21", via: ["prototype pollution"] },
          },
        }),
        outdatedJson: JSON.stringify({
          lodash: { current: "4.17.20", wanted: "4.17.21", latest: "4.17.21", type: "dependencies" },
        }),
      });

      expect(report.local.findings).toContainEqual(expect.objectContaining({ kind: "missing-license" }));
      expect(report.audit.vulnerabilities).toHaveLength(1);
      expect(report.outdated.outdated).toHaveLength(1);
      expect(report.summary.highestSeverity).toBe("high");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("runs npm audit through an injected runner and clamps timeout", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-dep-live-"));
    const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
    try {
      writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ dependencies: { zod: "4.0.0" } }));
      writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));

      const report = runDependencyAuditLive(
        { repoRoot, includeOutdated: true, timeoutMs: 999_999 },
        (command, args, options) => {
          calls.push({ command, args, timeoutMs: options.timeoutMs });
          return {
            status: 0,
            stdout: args.includes("outdated") ? "{}" : JSON.stringify({ vulnerabilities: {} }),
            stderr: "",
          };
        },
      );

      expect(report.refused).toBe(false);
      expect(calls.map((call) => [call.command, ...call.args].join(" "))).toEqual([
        "npm audit --json",
        "npm outdated --json",
      ]);
      expect(calls.every((call) => call.timeoutMs === 120_000)).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("refuses unsupported package managers for live audit", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-dep-cargo-"));
    try {
      writeFileSync(path.join(repoRoot, "Cargo.toml"), "[package]\nname = \"app\"\nversion = \"0.1.0\"\n");

      const report = runDependencyAuditLive({ repoRoot });

      expect(report.refused).toBe(true);
      expect(report.hint).toContain("npm");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
