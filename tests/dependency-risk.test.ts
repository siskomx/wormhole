import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

  it("parses pnpm audit advisories and outdated rows", () => {
    const audit = parseDependencyAuditJson({
      repoRoot: "/repo",
      auditJson: JSON.stringify({
        advisories: {
          "1106913": {
            module_name: "lodash",
            severity: "high",
            title: "Command Injection in lodash",
            url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
            vulnerable_versions: "<4.17.21",
            patched_versions: ">=4.17.21",
            github_advisory_id: "GHSA-35jh-r3h4-6jhm",
            findings: [{ paths: [".>lodash"] }],
          },
        },
      }),
    });
    const outdated = parseDependencyOutdatedJson({
      repoRoot: "/repo",
      outdatedJson: JSON.stringify({
        lodash: { wanted: "4.17.20", latest: "4.18.1", dependencyType: "dependencies" },
      }),
    });

    expect(audit.vulnerabilities).toContainEqual(
      expect.objectContaining({
        packageName: "lodash",
        severity: "high",
        range: "<4.17.21",
        identifiers: ["GHSA-35jh-r3h4-6jhm"],
        nodes: [".>lodash"],
      }),
    );
    expect(outdated.outdated).toContainEqual(
      expect.objectContaining({
        packageName: "lodash",
        current: "4.17.20",
        latest: "4.18.1",
        type: "dependencies",
        drift: "minor",
      }),
    );
  });

  it("parses bun audit JSON with CLI footer and bun outdated table output", () => {
    const audit = parseDependencyAuditJson({
      repoRoot: "/repo",
      auditJson:
        '{"lodash":[{"id":1106913,"url":"https://github.com/advisories/GHSA-35jh-r3h4-6jhm","title":"Command Injection in lodash","severity":"high","vulnerable_versions":"<4.17.21"}]}\n\u001b[0m\u001b[1mbun audit \u001b[0m\u001b[2mv1.3.0\u001b[0m',
    });
    const outdated = parseDependencyOutdatedJson({
      repoRoot: "/repo",
      outdatedJson:
        "bun outdated v1.3.0\n| Package  | Current | Update  | Latest |\n| lodash   | 4.17.20 | 4.17.20 | 4.18.1 |\n",
    });

    expect(audit.vulnerabilities).toContainEqual(
      expect.objectContaining({
        packageName: "lodash",
        severity: "high",
        identifiers: ["GHSA-35jh-r3h4-6jhm"],
        range: "<4.17.21",
      }),
    );
    expect(audit.warnings).toEqual([]);
    expect(outdated.outdated).toContainEqual(
      expect.objectContaining({
        packageName: "lodash",
        current: "4.17.20",
        wanted: "4.17.20",
        latest: "4.18.1",
        drift: "minor",
      }),
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

  it("runs pnpm audit through an injected runner", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-dep-live-pnpm-"));
    const calls: Array<{ command: string; args: string[] }> = [];
    try {
      writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ dependencies: { zod: "4.0.0" } }));
      writeFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

      const report = runDependencyAuditLive(
        { repoRoot, includeOutdated: true },
        (command, args) => {
          calls.push({ command, args });
          return {
            status: 0,
            stdout: "{}",
            stderr: "",
          };
        },
      );

      expect(report.refused).toBe(false);
      expect(report.packageManager).toBe("pnpm");
      expect(calls.map((call) => [call.command, ...call.args].join(" "))).toEqual([
        "pnpm audit --json",
        "pnpm outdated --format json",
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("runs bun audit and outdated through an injected runner", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-dep-live-bun-"));
    const calls: Array<{ command: string; args: string[] }> = [];
    try {
      writeFileSync(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ packageManager: "bun@1.3.0", dependencies: { lodash: "4.17.20" } }),
      );
      writeFileSync(path.join(repoRoot, "bun.lock"), "");

      const report = runDependencyAuditLive(
        { repoRoot, includeOutdated: true },
        (command, args) => {
          calls.push({ command, args });
          return {
            status: 0,
            stdout: args.includes("outdated")
              ? "bun outdated v1.3.0\n| Package  | Current | Update  | Latest |\n| lodash   | 4.17.20 | 4.17.20 | 4.18.1 |\n"
              : '{"lodash":[{"id":1106913,"url":"https://github.com/advisories/GHSA-35jh-r3h4-6jhm","title":"Command Injection in lodash","severity":"high","vulnerable_versions":"<4.17.21"}]}\n\u001b[0m\u001b[1mbun audit \u001b[0m\u001b[2mv1.3.0\u001b[0m',
            stderr: "",
          };
        },
      );

      expect(report.refused).toBe(false);
      expect(report.packageManager).toBe("bun");
      expect(report.audit?.vulnerabilities).toHaveLength(1);
      expect(report.outdated?.outdated).toHaveLength(1);
      expect(calls.map((call) => [call.command, ...call.args].join(" "))).toEqual([
        "bun audit --json",
        "bun outdated",
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  const itHasWindowsPackageManagerShims =
    process.platform === "win32" && commandAvailableThroughShell("npm") && commandAvailableThroughShell("pnpm")
      ? it
      : it.skip;

  itHasWindowsPackageManagerShims("runs Windows package-manager shims through the default runner", () => {
    const repos = [
      {
        manager: "npm",
        prefix: "wormhole-dep-live-npm-shim-",
        files: { "package-lock.json": JSON.stringify({ packages: {} }) },
      },
      {
        manager: "pnpm",
        prefix: "wormhole-dep-live-pnpm-shim-",
        files: { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
      },
    ];
    for (const repo of repos) {
      const repoRoot = mkdtempSync(path.join(os.tmpdir(), repo.prefix));
      try {
        writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ packageManager: `${repo.manager}@1.0.0` }));
        for (const [file, content] of Object.entries(repo.files)) {
          writeFileSync(path.join(repoRoot, file), content);
        }

        const report = runDependencyAuditLive({ repoRoot, timeoutMs: 5_000 });

        expect(report.commands[0]?.status).not.toBeNull();
        expect(report.commands[0]?.stderr ?? "").not.toMatch(/ENOENT|EINVAL/);
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
      }
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

function commandAvailableThroughShell(command: string): boolean {
  return spawnSync(`${command} --version`, { encoding: "utf8", shell: true, timeout: 10_000 }).status === 0;
}
