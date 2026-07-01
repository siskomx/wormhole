import { spawnSync } from "node:child_process";
import path from "node:path";
import { createDependencySecurityReport, type DependencySecurityReport } from "./dependency-security.js";
import { detectProjectContract, type ProjectPackageManager } from "./project-contract.js";

export const DEFAULT_DEPENDENCY_AUDIT_TIMEOUT_MS = 30_000;
export const MAX_DEPENDENCY_AUDIT_TIMEOUT_MS = 120_000;

export type DependencySeverity = "info" | "low" | "moderate" | "medium" | "high" | "critical";

export type DependencyVulnerability = {
  packageName: string;
  severity: DependencySeverity;
  range?: string;
  title?: string;
  url?: string;
  identifiers: string[];
  nodes: string[];
  fixAvailable: boolean;
  fixVersion?: string;
};

export type DependencyAuditReport = {
  repoRoot: string;
  vulnerabilities: DependencyVulnerability[];
  countsBySeverity: Partial<Record<DependencySeverity, number>>;
  warnings: string[];
};

export type DependencyOutdatedRow = {
  packageName: string;
  current: string;
  wanted?: string;
  latest?: string;
  type?: string;
  drift: "none" | "patch" | "minor" | "major" | "unknown";
};

export type DependencyOutdatedReport = {
  repoRoot: string;
  outdated: DependencyOutdatedRow[];
  warnings: string[];
};

export type DependencyRiskReport = {
  repoRoot: string;
  local: DependencySecurityReport;
  audit: DependencyAuditReport;
  outdated: DependencyOutdatedReport;
  summary: {
    vulnerabilities: number;
    outdated: number;
    missingLicenses: number;
    highestSeverity?: DependencySeverity;
  };
};

export type DependencyAuditLiveCommand = {
  command: string;
  args: string[];
  status: number | null;
  timeoutMs: number;
  stderr?: string;
};

export type DependencyAuditLiveResult = {
  refused: boolean;
  repoRoot: string;
  packageManager: ProjectPackageManager;
  audit?: DependencyAuditReport;
  outdated?: DependencyOutdatedReport;
  commands: DependencyAuditLiveCommand[];
  hint?: string;
  warnings: string[];
};

export type DependencyCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => { status: number | null; stdout: string; stderr: string };

export function parseDependencyAuditJson(input: { repoRoot: string; auditJson: string }): DependencyAuditReport {
  const warnings: string[] = [];
  const vulnerabilities: DependencyVulnerability[] = [];
  const parsed = safeJson(input.auditJson, warnings);
  const parsedRecord = isRecord(parsed) ? parsed : {};
  const rawVulnerabilities = isRecord(parsedRecord.vulnerabilities) ? parsedRecord.vulnerabilities : {};
  for (const [packageName, raw] of Object.entries(rawVulnerabilities)) {
    if (!isRecord(raw)) {
      continue;
    }
    const via = Array.isArray(raw.via) ? raw.via : [];
    const advisory = via.find(isRecord);
    const identifiers = via
      .filter(isRecord)
      .map((item) => stringValue(item.name))
      .filter((name): name is string => Boolean(name && /^(CVE|GHSA)-/i.test(name)));
    const fix = raw.fixAvailable;
    vulnerabilities.push({
      packageName,
      severity: normalizeSeverity(stringValue(raw.severity)),
      ...(typeof raw.range === "string" ? { range: raw.range } : {}),
      ...(advisory && typeof advisory.title === "string" ? { title: advisory.title } : {}),
      ...(advisory && typeof advisory.url === "string" ? { url: advisory.url } : {}),
      identifiers,
      nodes: Array.isArray(raw.nodes) ? raw.nodes.filter((node): node is string => typeof node === "string") : [],
      fixAvailable: Boolean(fix),
      ...(isRecord(fix) && typeof fix.version === "string" ? { fixVersion: fix.version } : {}),
    });
  }
  const rawAdvisories = isRecord(parsedRecord.advisories) ? parsedRecord.advisories : {};
  for (const raw of Object.values(rawAdvisories)) {
    if (!isRecord(raw)) {
      continue;
    }
    const packageName = stringValue(raw.module_name) ?? stringValue(raw.name);
    if (!packageName) {
      continue;
    }
    const patchedVersions = stringValue(raw.patched_versions);
    vulnerabilities.push({
      packageName,
      severity: normalizeSeverity(stringValue(raw.severity)),
      ...(typeof raw.vulnerable_versions === "string" ? { range: raw.vulnerable_versions } : {}),
      ...(typeof raw.title === "string" ? { title: raw.title } : {}),
      ...(typeof raw.url === "string" ? { url: raw.url } : {}),
      identifiers: advisoryIdentifiers(raw),
      nodes: advisoryFindingPaths(raw.findings),
      fixAvailable: Boolean(patchedVersions && patchedVersions !== "<0.0.0"),
    });
  }
  for (const [packageName, raw] of Object.entries(parsedRecord)) {
    if (packageName === "vulnerabilities" || packageName === "advisories" || !Array.isArray(raw)) {
      continue;
    }
    for (const advisory of raw) {
      if (!isRecord(advisory)) {
        continue;
      }
      vulnerabilities.push({
        packageName,
        severity: normalizeSeverity(stringValue(advisory.severity)),
        ...(typeof advisory.vulnerable_versions === "string" ? { range: advisory.vulnerable_versions } : {}),
        ...(typeof advisory.title === "string" ? { title: advisory.title } : {}),
        ...(typeof advisory.url === "string" ? { url: advisory.url } : {}),
        identifiers: advisoryIdentifiers(advisory),
        nodes: [],
        fixAvailable: false,
      });
    }
  }
  const countsBySeverity: Partial<Record<DependencySeverity, number>> = {};
  for (const vulnerability of vulnerabilities) {
    countsBySeverity[vulnerability.severity] = (countsBySeverity[vulnerability.severity] ?? 0) + 1;
  }
  return {
    repoRoot: path.resolve(input.repoRoot),
    vulnerabilities: vulnerabilities.sort((left, right) => left.packageName.localeCompare(right.packageName)),
    countsBySeverity,
    warnings,
  };
}

export function parseDependencyOutdatedJson(input: { repoRoot: string; outdatedJson: string }): DependencyOutdatedReport {
  const warnings: string[] = [];
  const json = parseJsonPayload(input.outdatedJson);
  const parsed = json.value;
  const outdated: DependencyOutdatedRow[] = [];
  if (isRecord(parsed)) {
    for (const [packageName, raw] of Object.entries(parsed)) {
      if (!isRecord(raw)) {
        continue;
      }
      const current = stringValue(raw.current) ?? stringValue(raw.installed) ?? stringValue(raw.wanted);
      if (!current) {
        continue;
      }
      const wanted = stringValue(raw.wanted);
      const latest = stringValue(raw.latest);
      outdated.push({
        packageName,
        current,
        ...(wanted ? { wanted } : {}),
        ...(latest ? { latest } : {}),
        ...(typeof raw.type === "string" ? { type: raw.type } : {}),
        ...(typeof raw.dependencyType === "string" ? { type: raw.dependencyType } : {}),
        drift: classifyVersionDrift(current, latest ?? wanted),
      });
    }
  } else {
    outdated.push(...parseBunOutdatedTable(input.outdatedJson));
  }
  if (outdated.length === 0 && json.error) {
    warnings.push(json.error);
  }
  return {
    repoRoot: path.resolve(input.repoRoot),
    outdated: outdated.sort((left, right) => left.packageName.localeCompare(right.packageName)),
    warnings,
  };
}

export function createDependencyRiskReport(input: {
  repoRoot: string;
  auditJson?: string;
  outdatedJson?: string;
}): DependencyRiskReport {
  const repoRoot = path.resolve(input.repoRoot);
  const local = createDependencySecurityReport({ repoRoot });
  const audit = input.auditJson
    ? parseDependencyAuditJson({ repoRoot, auditJson: input.auditJson })
    : emptyAudit(repoRoot);
  const outdated = input.outdatedJson
    ? parseDependencyOutdatedJson({ repoRoot, outdatedJson: input.outdatedJson })
    : emptyOutdated(repoRoot);
  return {
    repoRoot,
    local,
    audit,
    outdated,
    summary: {
      vulnerabilities: audit.vulnerabilities.length,
      outdated: outdated.outdated.length,
      missingLicenses: local.findings.filter((finding) => finding.kind === "missing-license").length,
      highestSeverity: highestSeverity(audit.vulnerabilities.map((vulnerability) => vulnerability.severity)),
    },
  };
}

export function runDependencyAuditLive(
  input: { repoRoot: string; includeOutdated?: boolean; timeoutMs?: number },
  runner: DependencyCommandRunner = defaultRunner,
): DependencyAuditLiveResult {
  const repoRoot = path.resolve(input.repoRoot);
  const packageManager = detectProjectContract({ repoRoot }).packageManager;
  const timeoutMs = clampTimeout(input.timeoutMs, DEFAULT_DEPENDENCY_AUDIT_TIMEOUT_MS, MAX_DEPENDENCY_AUDIT_TIMEOUT_MS);
  const commands: DependencyAuditLiveCommand[] = [];
  const warnings: string[] = [];
  const commandSpec = dependencyAuditCommandSpec(packageManager);
  if (!commandSpec) {
    return {
      refused: true,
      repoRoot,
      packageManager,
      commands,
      hint: "Live dependency audit currently supports npm, pnpm, and bun. Run your package manager's audit command and pass JSON to dependency_risk_report.",
      warnings,
    };
  }
  const auditRun = runner(commandSpec.command, commandSpec.auditArgs, { cwd: repoRoot, timeoutMs });
  commands.push(commandRecord(commandSpec.command, commandSpec.auditArgs, auditRun, timeoutMs));
  const audit = auditRun.stdout.trim()
    ? parseDependencyAuditJson({ repoRoot, auditJson: auditRun.stdout })
    : emptyAudit(repoRoot);
  if (auditRun.status !== 0 && audit.vulnerabilities.length === 0) {
    warnings.push(auditRun.stderr || `${commandSpec.command} audit exited non-zero without parseable vulnerability JSON.`);
  }
  let outdated: DependencyOutdatedReport | undefined;
  if (input.includeOutdated) {
    const outdatedRun = runner(commandSpec.command, commandSpec.outdatedArgs, { cwd: repoRoot, timeoutMs });
    commands.push(commandRecord(commandSpec.command, commandSpec.outdatedArgs, outdatedRun, timeoutMs));
    outdated = outdatedRun.stdout.trim()
      ? parseDependencyOutdatedJson({ repoRoot, outdatedJson: outdatedRun.stdout })
      : emptyOutdated(repoRoot);
  }
  return {
    refused: false,
    repoRoot,
    packageManager,
    audit,
    ...(outdated ? { outdated } : {}),
    commands,
    warnings,
  };
}

function dependencyAuditCommandSpec(packageManager: ProjectPackageManager): {
  command: "npm" | "pnpm" | "bun";
  auditArgs: string[];
  outdatedArgs: string[];
} | undefined {
  switch (packageManager) {
    case "npm":
      return { command: "npm", auditArgs: ["audit", "--json"], outdatedArgs: ["outdated", "--json"] };
    case "pnpm":
      return { command: "pnpm", auditArgs: ["audit", "--json"], outdatedArgs: ["outdated", "--format", "json"] };
    case "bun":
      return { command: "bun", auditArgs: ["audit", "--json"], outdatedArgs: ["outdated"] };
    default:
      return undefined;
  }
}

function defaultRunner(command: string, args: string[], options: { cwd: string; timeoutMs: number }) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: options.timeoutMs,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr || result.error?.message || "",
  };
}

function commandRecord(
  command: string,
  args: string[],
  result: { status: number | null; stderr: string },
  timeoutMs: number,
): DependencyAuditLiveCommand {
  return {
    command,
    args,
    status: result.status,
    timeoutMs,
    ...(result.stderr ? { stderr: result.stderr } : {}),
  };
}

function emptyAudit(repoRoot: string): DependencyAuditReport {
  return { repoRoot, vulnerabilities: [], countsBySeverity: {}, warnings: [] };
}

function emptyOutdated(repoRoot: string): DependencyOutdatedReport {
  return { repoRoot, outdated: [], warnings: [] };
}

function safeJson(value: string, warnings: string[]): unknown {
  const parsed = parseJsonPayload(value);
  if (!parsed.error) {
    return parsed.value;
  }
  warnings.push(parsed.error);
  return undefined;
}

function parseJsonPayload(value: string): { value?: unknown; error?: string } {
  const candidates = uniqueSorted([value, stripAnsi(value).trim(), extractJsonPayload(stripAnsi(value)) ?? ""]);
  let lastError = "";
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return { value: JSON.parse(candidate) as unknown };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { error: lastError || "No JSON payload found." };
}

function extractJsonPayload(value: string): string | undefined {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  const start = Math.min(...starts);
  if (!Number.isFinite(start)) {
    return undefined;
  }
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }
    if (char === "}" || char === "]") {
      const expected = stack.pop();
      if (char !== expected) {
        return undefined;
      }
      if (stack.length === 0) {
        return value.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function advisoryIdentifiers(raw: Record<string, unknown>): string[] {
  const identifiers = new Set<string>();
  const candidates = [
    raw.name,
    raw.github_advisory_id,
    raw.cve,
    raw.cves,
    raw.url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      addIdentifiers(identifiers, candidate);
    } else if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string") {
          addIdentifiers(identifiers, item);
        }
      }
    }
  }
  return [...identifiers].sort((left, right) => left.localeCompare(right));
}

function addIdentifiers(target: Set<string>, value: string): void {
  for (const match of value.matchAll(/\b(?:CVE-\d{4}-\d{4,}|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\b/gi)) {
    target.add(match[0].toUpperCase().startsWith("CVE-") ? match[0].toUpperCase() : match[0]);
  }
}

function advisoryFindingPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const paths = new Set<string>();
  for (const finding of value) {
    if (!isRecord(finding) || !Array.isArray(finding.paths)) {
      continue;
    }
    for (const item of finding.paths) {
      if (typeof item === "string") {
        paths.add(item);
      }
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function parseBunOutdatedTable(value: string): DependencyOutdatedRow[] {
  const rows: DependencyOutdatedRow[] = [];
  for (const line of stripAnsi(value).split(/\r?\n/)) {
    if (!line.includes("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 4 || cells[0] === "Package" || cells.every((cell) => /^-+$/.test(cell))) {
      continue;
    }
    const [packageName, current, wanted, latest] = cells;
    if (!packageName || !current) {
      continue;
    }
    rows.push({
      packageName,
      current,
      ...(wanted ? { wanted } : {}),
      ...(latest ? { latest } : {}),
      drift: classifyVersionDrift(current, latest ?? wanted),
    });
  }
  return rows;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.length - right.length);
}

function normalizeSeverity(value: string | undefined): DependencySeverity {
  return value === "critical" || value === "high" || value === "moderate" || value === "medium" || value === "low"
    ? value
    : "info";
}

function classifyVersionDrift(current: string, target: string | undefined): DependencyOutdatedRow["drift"] {
  if (!target || current === target) {
    return target ? "none" : "unknown";
  }
  const currentParts = semverParts(current);
  const targetParts = semverParts(target);
  if (!currentParts || !targetParts) {
    return "unknown";
  }
  if (targetParts[0] > currentParts[0]) {
    return "major";
  }
  if (targetParts[1] > currentParts[1]) {
    return "minor";
  }
  if (targetParts[2] > currentParts[2]) {
    return "patch";
  }
  return "none";
}

function semverParts(value: string): [number, number, number] | undefined {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function highestSeverity(values: DependencySeverity[]): DependencySeverity | undefined {
  const order: DependencySeverity[] = ["info", "low", "moderate", "medium", "high", "critical"];
  return values.sort((left, right) => order.indexOf(right) - order.indexOf(left))[0];
}

function clampTimeout(value: number | undefined, defaultMs: number, maxMs: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return defaultMs;
  }
  return Math.min(Math.floor(value), maxMs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
