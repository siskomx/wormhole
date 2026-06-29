import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createShellHookManager, type ShellKind, type ShellHookPlan } from "../src/shell-hooks.js";

const shells: ShellKind[] = [
  "powershell",
  "windows-powershell",
  "bash",
  "zsh",
  "fish",
  "nushell",
  "cmd",
];

function tempHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "wormhole-hooks-"));
}

function isUnderHome(homeDir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(homeDir), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function markerCount(content: string): number {
  return content.split("# >>> wormhole shell hook >>>").length - 1;
}

describe("shell hooks", () => {
  it("renders marker blocks for every supported shell", () => {
    const manager = createShellHookManager({ homeDir: "C:/Users/Test", repoRoot: "C:/repo" });

    for (const shell of shells) {
      const block = manager.renderHook({
        shell,
        eventLogPath: "C:/repo/.wormhole/shell-events.jsonl",
      });

      expect(block).toContain("# >>> wormhole shell hook >>>");
      expect(block).toContain("# <<< wormhole shell hook <<<");
      expect(block).toContain("shell-events.jsonl");
      expect(block).toContain(shell);
    }
  });

  it("discovers known profile paths under the configured home directory", () => {
    const home = tempHome();
    const manager = createShellHookManager({ homeDir: home, repoRoot: home });

    try {
      const discovered = manager.discover();

      expect(discovered.map((entry) => entry.shell)).toEqual(shells);
      for (const entry of discovered) {
        if (entry.profilePath) {
          expect(isUnderHome(home, entry.profilePath)).toBe(true);
        }
      }
      expect(discovered.find((entry) => entry.shell === "bash")?.profilePath).toBe(path.join(home, ".bashrc"));
      expect(discovered.find((entry) => entry.shell === "cmd")?.warning).toContain("registry");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("plans install without modifying files during dry run", () => {
    const home = tempHome();
    const profile = path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
    const manager = createShellHookManager({ homeDir: home, repoRoot: home });

    try {
      const plan: ShellHookPlan = manager.planInstall({ shells: ["powershell"], dryRun: true });

      expect(plan.planToken).toMatch(/^shell-plan:/);
      expect(plan.operations[0]).toEqual(
        expect.objectContaining({
          shell: "powershell",
          path: profile,
          action: "insert",
        }),
      );
      expect(existsSync(profile)).toBe(false);
      expect(existsSync(path.dirname(profile))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("installs with a backup and replaces marker blocks idempotently", () => {
    const home = tempHome();
    const profile = path.join(home, ".bashrc");
    writeFileSync(profile, "export KEEP=1\n");
    const manager = createShellHookManager({
      homeDir: home,
      repoRoot: home,
      now: () => new Date("2026-06-25T01:02:03.000Z"),
    });

    try {
      const first = manager.install({ shells: ["bash"] });
      const firstContent = readFileSync(profile, "utf8");

      expect(first.operations[0]).toEqual(
        expect.objectContaining({
          shell: "bash",
          action: "insert",
          backupPath: expect.any(String),
          beforeHash: expect.any(String),
          afterHash: expect.any(String),
        }),
      );
      expect(readFileSync(first.operations[0].backupPath ?? "", "utf8")).toBe("export KEEP=1\n");
      expect(firstContent).toContain("export KEEP=1\n");
      expect(markerCount(firstContent)).toBe(1);

      const second = manager.install({ shells: ["bash"] });
      const secondContent = readFileSync(profile, "utf8");

      expect(second.operations[0].action).toBe("replace");
      expect(secondContent).toContain("export KEEP=1\n");
      expect(markerCount(secondContent)).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("uninstalls only the marked block", () => {
    const home = tempHome();
    const profile = path.join(home, ".bashrc");
    writeFileSync(
      profile,
      [
        "export KEEP=1",
        "# >>> wormhole shell hook >>>",
        "wormhole",
        "# <<< wormhole shell hook <<<",
        "",
      ].join("\n"),
    );
    const manager = createShellHookManager({ homeDir: home, repoRoot: home });

    try {
      const plan = manager.uninstall({ shells: ["bash"] });

      expect(plan.operations[0].action).toBe("remove");
      expect(readFileSync(profile, "utf8")).toBe("export KEEP=1\n");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("plans uninstall operations with a distinct plan token", () => {
    const home = tempHome();
    const profile = path.join(home, ".bashrc");
    writeFileSync(
      profile,
      [
        "export KEEP=1",
        "# >>> wormhole shell hook >>>",
        "wormhole",
        "# <<< wormhole shell hook <<<",
        "",
      ].join("\n"),
    );
    const manager = createShellHookManager({ homeDir: home, repoRoot: home });

    try {
      const plan = manager.planUninstall({ shells: ["bash"] });

      expect(plan.planToken).toMatch(/^shell-plan:/);
      expect(plan.operations[0]).toEqual(
        expect.objectContaining({
          shell: "bash",
          path: profile,
          action: "remove",
          beforeHash: expect.any(String),
          afterHash: expect.any(String),
        }),
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("verifies existing and missing hook blocks", () => {
    const home = tempHome();
    const profile = path.join(home, ".zshrc");
    writeFileSync(
      profile,
      [
        "# >>> wormhole shell hook >>>",
        "wormhole",
        "# <<< wormhole shell hook <<<",
        "",
      ].join("\n"),
    );
    const manager = createShellHookManager({ homeDir: home, repoRoot: home });

    try {
      const plan = manager.verify({ shells: ["zsh", "fish"] });

      expect(plan.operations).toEqual([
        expect.objectContaining({ shell: "zsh", action: "replace", present: true }),
        expect.objectContaining({ shell: "fish", action: "insert", present: false }),
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("verifies Cmd AutoRun when the registry contains the expected hook command", () => {
    const home = tempHome();
    const eventLogPath = path.join(home, ".wormhole", "shell-events.jsonl").replace(/\\/g, "/");
    const manager = createShellHookManager({
      homeDir: home,
      repoRoot: home,
      cmdAutoRunReader: () => `@echo {"shell":"cmd"}>>"${eventLogPath}"`,
    });

    try {
      const plan = manager.verify({ shells: ["cmd"] });

      expect(plan.operations).toEqual([
        expect.objectContaining({
          shell: "cmd",
          action: "registry-set",
          path: "HKCU\\Software\\Microsoft\\Command Processor\\AutoRun",
          present: true,
        }),
      ]);
      expect(plan.warnings).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects Cmd registry installs unless registry writes are allowed", () => {
    const home = tempHome();
    const manager = createShellHookManager({ homeDir: home, repoRoot: home });

    try {
      expect(() => manager.install({ shells: ["cmd"] })).toThrow(/allowRegistry/);
      const plan = manager.planInstall({ shells: ["cmd"], dryRun: true, allowRegistry: true });

      expect(plan.operations[0]).toEqual(
        expect.objectContaining({
          shell: "cmd",
          action: "registry-set",
          path: "HKCU\\Software\\Microsoft\\Command Processor\\AutoRun",
        }),
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects custom profile paths outside the configured home directory", () => {
    const home = tempHome();
    const outside = path.join(os.tmpdir(), "wormhole-outside-profile");

    try {
      expect(() =>
        createShellHookManager({
          homeDir: home,
          repoRoot: home,
          profilePaths: { bash: outside },
        }),
      ).toThrow(/outside homeDir/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
