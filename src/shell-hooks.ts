import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ShellKind =
  | "powershell"
  | "windows-powershell"
  | "bash"
  | "zsh"
  | "fish"
  | "nushell"
  | "cmd";

export type ShellHookOperation = {
  shell: ShellKind;
  path: string;
  action: "insert" | "replace" | "remove" | "registry-set" | "registry-remove";
  backupPath?: string;
  beforeHash?: string;
  afterHash?: string;
  present?: boolean;
};

export type ShellHookPlan = {
  operations: ShellHookOperation[];
  warnings: string[];
  planToken?: string;
};

type ShellHookManagerConfig = {
  homeDir: string;
  repoRoot: string;
  now?: () => Date;
  profilePaths?: Partial<Record<ShellKind, string>>;
  cmdAutoRunReader?: () => string | undefined;
};

const SHELLS: ShellKind[] = [
  "powershell",
  "windows-powershell",
  "bash",
  "zsh",
  "fish",
  "nushell",
  "cmd",
];

const START_MARKER = "# >>> wormhole shell hook >>>";
const END_MARKER = "# <<< wormhole shell hook <<<";
const CMD_REGISTRY_PATH = "HKCU\\Software\\Microsoft\\Command Processor\\AutoRun";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rejectUnsafeShellPath(value: string): string {
  if (/[\0\r\n'"`;&|<>]/.test(value)) {
    throw new Error("Shell hook paths must not contain control characters or shell metacharacters");
  }
  return value;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function defaultProfilePath(homeDir: string, shell: ShellKind): string | undefined {
  switch (shell) {
    case "powershell":
      return path.join(homeDir, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
    case "windows-powershell":
      return path.join(homeDir, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1");
    case "bash":
      return path.join(homeDir, ".bashrc");
    case "zsh":
      return path.join(homeDir, ".zshrc");
    case "fish":
      return path.join(homeDir, ".config", "fish", "config.fish");
    case "nushell":
      return path.join(homeDir, "AppData", "Roaming", "nushell", "config.nu");
    case "cmd":
      return undefined;
  }
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
}

function hasMarker(content: string): boolean {
  return content.includes(START_MARKER) && content.includes(END_MARKER);
}

function stripMarkerBlock(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line === START_MARKER) {
      skipping = true;
      continue;
    }
    if (line === END_MARKER) {
      skipping = false;
      continue;
    }
    if (!skipping) {
      kept.push(line);
    }
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") {
    kept.pop();
  }
  return kept.length > 0 ? `${kept.join("\n")}\n` : "";
}

function appendBlock(content: string, block: string): string {
  const base = stripMarkerBlock(content);
  return `${base}${base && !base.endsWith("\n") ? "\n" : ""}${block}\n`;
}

function cmdHookCommand(eventLogPath: string): string {
  return `@echo {"shell":"cmd"}>>"${rejectUnsafeShellPath(eventLogPath.replace(/\\/g, "/"))}"`;
}

function runRegistryCommand(args: string[]): string | undefined {
  if (process.platform !== "win32") {
    return "Cmd AutoRun registry changes are only applied on Windows.";
  }
  const result = spawnSync("reg.exe", args, {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `reg.exe failed with status ${result.status}`);
  }
  return undefined;
}

function readCmdAutoRunValue(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  const result = spawnSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Command Processor", "/v", "AutoRun"], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const line = result.stdout
    .split(/\r?\n/)
    .find((entry) => /^\s*AutoRun\s+REG_\w+\s+/.test(entry));
  return line?.replace(/^\s*AutoRun\s+REG_\w+\s+/, "").trim();
}

export function createShellHookManager(config: ShellHookManagerConfig): {
  discover(): Array<{ shell: ShellKind; profilePath?: string; available: boolean; warning?: string }>;
  renderHook(input: { shell: ShellKind; eventLogPath: string }): string;
  planInstall(input: { shells: ShellKind[]; dryRun: boolean; allowRegistry?: boolean }): ShellHookPlan;
  planUninstall(input: { shells: ShellKind[]; allowRegistry?: boolean }): ShellHookPlan;
  install(input: { shells: ShellKind[]; allowRegistry?: boolean }): ShellHookPlan;
  uninstall(input: { shells: ShellKind[]; allowRegistry?: boolean }): ShellHookPlan;
  verify(input: { shells: ShellKind[] }): ShellHookPlan;
} {
  const homeDir = path.resolve(config.homeDir);
  const repoRoot = path.resolve(config.repoRoot);
  const now = config.now ?? (() => new Date());
  const profilePaths = new Map<ShellKind, string | undefined>();

  for (const shell of SHELLS) {
    const configured = config.profilePaths?.[shell];
    if (configured && !isInside(homeDir, configured)) {
      throw new Error(`Shell profile path for ${shell} is outside homeDir`);
    }
    profilePaths.set(shell, configured ? path.resolve(configured) : defaultProfilePath(homeDir, shell));
  }

  function profilePath(shell: ShellKind): string {
    const found = profilePaths.get(shell);
    if (!found) {
      throw new Error(`Shell ${shell} does not use a profile path`);
    }
    return found;
  }

  function renderHook(input: { shell: ShellKind; eventLogPath: string }): string {
    const eventLogPath = rejectUnsafeShellPath(input.eventLogPath.replace(/\\/g, "/"));
    const repo = rejectUnsafeShellPath(repoRoot.replace(/\\/g, "/"));
    const header = [START_MARKER, `# shell=${input.shell}`, `# repoRoot=${repo}`, `# eventLog=${eventLogPath}`];
    const footer = [END_MARKER];
    const encodedJsonLine = `{"shell":"${input.shell}","cwdBase64":"%s"}\\n`;
    switch (input.shell) {
      case "powershell":
      case "windows-powershell":
        return [
          ...header,
          `$__wormholeEventLog = ${JSON.stringify(eventLogPath)}`,
          `if (Test-Path Function:\\prompt) { Set-Item -Path Function:\\__wormhole_original_prompt -Value (Get-Command prompt).ScriptBlock }`,
          "function global:prompt {",
          `  try { @{ shell = ${JSON.stringify(input.shell)}; cwd = (Get-Location).Path; timestamp = (Get-Date).ToString("o") } | ConvertTo-Json -Compress | Add-Content -Path $__wormholeEventLog } catch {}`,
          "  if (Test-Path Function:\\__wormhole_original_prompt) { & __wormhole_original_prompt } else { \"PS $((Get-Location).Path)> \" }",
          "}",
          ...footer,
        ].join("\n");
      case "fish":
        return [
          ...header,
          "function __wormhole_hook --on-event fish_postexec",
          "  set -l __wormhole_cwd_b64 (pwd | base64 | string collect)",
          `  printf '${encodedJsonLine}' $__wormhole_cwd_b64 >> '${eventLogPath}'`,
          "end",
          ...footer,
        ].join("\n");
      case "nushell":
        return [
          ...header,
          `$env.WORMHOLE_SHELL_EVENT_LOG = "${eventLogPath}"`,
          `$env.config = ($env.config | upsert hooks.pre_prompt (($env.config.hooks.pre_prompt? | default []) | append {|| {shell: "nushell", cwd: (pwd)} | to json -r | save --append $env.WORMHOLE_SHELL_EVENT_LOG }))`,
          ...footer,
        ].join("\n");
      case "cmd":
        return [
          ...header,
          `@echo {"shell":"cmd"}>>"${eventLogPath}"`,
          ...footer,
        ].join("\n");
      case "bash":
      case "zsh":
        return [
          ...header,
          `__wormhole_hook_event() { __wormhole_cwd_b64="$(printf '%s' "$PWD" | base64 | tr -d '\\n')"; printf '${encodedJsonLine}' "$__wormhole_cwd_b64" >> '${eventLogPath}'; }`,
          `case ";$PROMPT_COMMAND;" in *";__wormhole_hook_event;"*) ;; *) PROMPT_COMMAND="__wormhole_hook_event\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;; esac`,
          ...footer,
        ].join("\n");
    }
  }

  function eventLogPath(): string {
    return path.join(repoRoot, ".wormhole", "shell-events.jsonl");
  }

  function operationForInstall(shell: ShellKind): ShellHookOperation {
    if (shell === "cmd") {
      return {
        shell,
        path: CMD_REGISTRY_PATH,
        action: "registry-set",
      };
    }
    const target = profilePath(shell);
    const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
    const block = renderHook({ shell, eventLogPath: eventLogPath() });
    const after = appendBlock(existing, block);
    return {
      shell,
      path: target,
      action: hasMarker(existing) ? "replace" : "insert",
      beforeHash: sha256(existing),
      afterHash: sha256(after),
    };
  }

  function operationForUninstall(shell: ShellKind): ShellHookOperation {
    if (shell === "cmd") {
      return {
        shell,
        path: CMD_REGISTRY_PATH,
        action: "registry-remove",
      };
    }
    const target = profilePath(shell);
    const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
    const after = stripMarkerBlock(existing);
    return {
      shell,
      path: target,
      action: "remove",
      beforeHash: sha256(existing),
      afterHash: sha256(after),
    };
  }

  function withHashes(operation: ShellHookOperation, before: string, after: string): ShellHookOperation {
    return {
      ...operation,
      beforeHash: sha256(before),
      afterHash: sha256(after),
    };
  }

  function createPlanToken(operations: ShellHookOperation[], allowRegistry?: boolean): string {
    return `shell-plan:${sha256(
      JSON.stringify({
        operations: operations.map((operation) => ({
          shell: operation.shell,
          path: operation.path,
          action: operation.action,
          beforeHash: operation.beforeHash,
          afterHash: operation.afterHash,
        })),
        allowRegistry: Boolean(allowRegistry),
      }),
    ).slice(0, 24)}`;
  }

  return {
    discover() {
      return SHELLS.map((shell) => {
        if (shell === "cmd") {
          return {
            shell,
            available: true,
            warning: "Cmd hooks use the registry AutoRun value and require explicit registry permission.",
          };
        }
        return {
          shell,
          profilePath: profilePath(shell),
          available: true,
        };
      });
    },

    renderHook,

    planInstall(input) {
      const warnings: string[] = [];
      const operations = input.shells.map((shell) => {
        if (shell === "cmd" && !input.allowRegistry) {
          warnings.push("Cmd registry hook requires allowRegistry.");
        }
        return operationForInstall(shell);
      });
      return { operations, warnings, planToken: createPlanToken(operations, input.allowRegistry) };
    },

    planUninstall(input) {
      const warnings: string[] = [];
      const operations = input.shells.map((shell) => {
        if (shell === "cmd" && !input.allowRegistry) {
          warnings.push("Cmd registry hook requires allowRegistry.");
        }
        return operationForUninstall(shell);
      });
      return { operations, warnings, planToken: createPlanToken(operations, input.allowRegistry) };
    },

    install(input) {
      if (input.shells.includes("cmd") && !input.allowRegistry) {
        throw new Error("Cmd registry hook install requires allowRegistry");
      }
      const operations: ShellHookOperation[] = [];
      const warnings: string[] = [];
      for (const shell of input.shells) {
        if (shell === "cmd") {
          const warning = runRegistryCommand([
            "add",
            "HKCU\\Software\\Microsoft\\Command Processor",
            "/v",
            "AutoRun",
            "/t",
            "REG_SZ",
            "/d",
            cmdHookCommand(eventLogPath()),
            "/f",
          ]);
          if (warning) {
            warnings.push(warning);
          }
          operations.push({ shell, path: CMD_REGISTRY_PATH, action: "registry-set" });
          continue;
        }
        const target = profilePath(shell);
        const before = existsSync(target) ? readFileSync(target, "utf8") : "";
        const action = hasMarker(before) ? "replace" : "insert";
        const block = renderHook({ shell, eventLogPath: eventLogPath() });
        const after = appendBlock(before, block);
        mkdirSync(path.dirname(target), { recursive: true });
        const backupPath = `${target}.wormhole-backup-${timestamp(now())}`;
        writeFileSync(backupPath, before);
        writeFileSync(target, after);
        operations.push(withHashes({ shell, path: target, action, backupPath }, before, after));
      }
      return { operations, warnings };
    },

    uninstall(input) {
      if (input.shells.includes("cmd") && !input.allowRegistry) {
        throw new Error("Cmd registry hook uninstall requires allowRegistry");
      }
      const operations: ShellHookOperation[] = [];
      const warnings: string[] = [];
      for (const shell of input.shells) {
        if (shell === "cmd") {
          const warning = runRegistryCommand([
            "delete",
            "HKCU\\Software\\Microsoft\\Command Processor",
            "/v",
            "AutoRun",
            "/f",
          ]);
          if (warning) {
            warnings.push(warning);
          }
          operations.push({ shell, path: CMD_REGISTRY_PATH, action: "registry-remove" });
          continue;
        }
        const target = profilePath(shell);
        const before = existsSync(target) ? readFileSync(target, "utf8") : "";
        const after = stripMarkerBlock(before);
        writeFileSync(target, after);
        operations.push(withHashes({ shell, path: target, action: "remove" }, before, after));
      }
      return { operations, warnings };
    },

    verify(input) {
      const warnings: string[] = [];
      const operations = input.shells.map((shell) => {
        if (shell === "cmd") {
          let actual: string | undefined;
          try {
            actual = config.cmdAutoRunReader ? config.cmdAutoRunReader() : readCmdAutoRunValue();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Cmd AutoRun registry verification failed: ${message}`);
          }
          const expected = cmdHookCommand(eventLogPath());
          return {
            shell,
            path: CMD_REGISTRY_PATH,
            action: "registry-set" as const,
            present: Boolean(actual?.includes(expected)),
          };
        }
        const target = profilePath(shell);
        const present = existsSync(target) && hasMarker(readFileSync(target, "utf8"));
        return {
          shell,
          path: target,
          action: present ? ("replace" as const) : ("insert" as const),
          present,
        };
      });
      return { operations, warnings };
    },
  };
}
