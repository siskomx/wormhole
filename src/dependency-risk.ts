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
  const parsed = safeJson(input.outdatedJson, warnings);
  const outdated: DependencyOutdatedRow[] = [];
  if (isRecord(parsed)) {
    for (const [packageName, raw] of Object.entries(parsed)) {
      if (!isRecord(raw) || typeof raw.current !== "string") {
        continue;
      }
      const wanted = stringValue(raw.wanted);
      const latest = stringValue(raw.latest);
      outdated.push({
        packageName,
        current: raw.current,
        ...(wanted ? { wanted } : {}),
        ...(latest ? { latest } : {}),
        ...(typeof raw.type === "string" ? { type: raw.type } : {}),
        drift: classifyVersionDrift(raw.current, latest ?? wanted),
      });
    }
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
  if (packageManager !== "npm") {
    return {
      refused: true,
      repoRoot,
      packageManager,
      commands,
      hint: "Live dependency audit currently supports npm. Run your package manager's audit command and pass JSON to dependency_risk_report.",
      warnings,
    };
  }
  const auditRun = runner("npm", ["audit", "--json"], { cwd: repoRoot, timeoutMs });
  commands.push(commandRecord("npm", ["audit", "--json"], auditRun, timeoutMs));
  const audit = auditRun.stdout.trim()
    ? parseDependencyAuditJson({ repoRoot, auditJson: auditRun.stdout })
    : emptyAudit(repoRoot);
  if (auditRun.status !== 0 && audit.vulnerabilities.length === 0) {
    warnings.push(auditRun.stderr || "npm audit exited non-zero without parseable vulnerability JSON.");
  }
  let outdated: DependencyOutdatedReport | undefined;
  if (input.includeOutdated) {
    const outdatedRun = runner("npm", ["outdated", "--json"], { cwd: repoRoot, timeoutMs });
    commands.push(commandRecord("npm", ["outdated", "--json"], outdatedRun, timeoutMs));
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

function defaultRunner(command: string, args: string[], options: { cwd: string; timeoutMs: number }) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
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
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
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
