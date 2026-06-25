import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { detectProjectContract, type ProjectPackageManager } from "./project-contract.js";

export type DependencySecurityFinding = {
  kind: "missing-lockfile" | "missing-license" | "vulnerability-provider-unavailable";
  severity: "low" | "medium" | "high";
  packageName?: string;
  message: string;
};

export type DependencySecurityReport = {
  repoRoot: string;
  packageManager: ProjectPackageManager;
  directDependencies: number;
  devDependencies: number;
  transitiveDependencies: number;
  lockfiles: string[];
  licenses: Record<string, number>;
  findings: DependencySecurityFinding[];
};

export function createDependencySecurityReport(input: {
  repoRoot: string;
}): DependencySecurityReport {
  const repoRoot = path.resolve(input.repoRoot);
  const contract = detectProjectContract({ repoRoot });
  const packageLock = readPackageLock(repoRoot);
  const directNames = new Set(contract.dependencies.map((dependency) => dependency.name));
  const devDependencies = contract.dependencies.filter((dependency) => dependency.dev).length;
  const licenses: Record<string, number> = {};
  const findings: DependencySecurityFinding[] = [];
  let transitiveDependencies = 0;

  if (contract.lockfiles.length === 0) {
    findings.push({
      kind: "missing-lockfile",
      severity: "medium",
      message: "No package lockfile was detected; dependency resolution may not be reproducible.",
    });
  }

  for (const entry of packageLock) {
    if (!entry.packageName) {
      continue;
    }
    if (!directNames.has(entry.packageName)) {
      transitiveDependencies += 1;
    }
    if (entry.license) {
      licenses[entry.license] = (licenses[entry.license] ?? 0) + 1;
    } else if (directNames.has(entry.packageName)) {
      findings.push({
        kind: "missing-license",
        severity: "low",
        packageName: entry.packageName,
        message: `${entry.packageName} has no license field in the lockfile metadata.`,
      });
    }
  }

  findings.push({
    kind: "vulnerability-provider-unavailable",
    severity: "low",
    message: "No online vulnerability provider was queried; report is local metadata only.",
  });

  return {
    repoRoot,
    packageManager: contract.packageManager,
    directDependencies: contract.dependencies.length,
    devDependencies,
    transitiveDependencies,
    lockfiles: contract.lockfiles,
    licenses,
    findings,
  };
}

function readPackageLock(repoRoot: string): Array<{
  packageName?: string;
  version?: string;
  license?: string;
}> {
  const lockPath = path.join(repoRoot, "package-lock.json");
  if (!existsSync(lockPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as {
      packages?: Record<string, { version?: string; license?: string }>;
    };
    return Object.entries(parsed.packages ?? {})
      .filter(([key]) => key.startsWith("node_modules/"))
      .map(([key, value]) => ({
        packageName: key.replace(/^node_modules\//, ""),
        version: value.version,
        license: value.license,
      }));
  } catch {
    return [];
  }
}
