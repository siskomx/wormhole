export type CoverageMetric = "lines" | "branches" | "functions" | "statements";

export type CoverageSummary = Partial<Record<CoverageMetric, number>>;

export type CoverageDeltaInput = {
  before?: string | CoverageSummary;
  after?: string | CoverageSummary;
  failBelowDelta?: number;
};

export type CoverageDeltaMetric = {
  before: number;
  after: number;
  delta: number;
};

export type CoverageDeltaFinding = {
  kind: "coverage_drop" | "coverage_parse_failed";
  severity: "warning" | "error";
  metric?: CoverageMetric;
  message: string;
};

export type CoverageDeltaResult = {
  decision: "pass" | "warn" | "fail";
  metrics: Partial<Record<CoverageMetric, CoverageDeltaMetric>>;
  findings: CoverageDeltaFinding[];
};

const METRICS: CoverageMetric[] = ["lines", "branches", "functions", "statements"];

export function analyzeCoverageDelta(input: CoverageDeltaInput): CoverageDeltaResult {
  const threshold = input.failBelowDelta ?? -0.5;
  const before = parseCoverageSummary(input.before);
  const after = parseCoverageSummary(input.after);
  const metrics: Partial<Record<CoverageMetric, CoverageDeltaMetric>> = {};
  const findings: CoverageDeltaFinding[] = [];

  for (const metric of METRICS) {
    const beforeValue = before[metric];
    const afterValue = after[metric];
    if (beforeValue === undefined || afterValue === undefined) {
      continue;
    }
    const delta = roundDelta(afterValue - beforeValue);
    metrics[metric] = { before: beforeValue, after: afterValue, delta };
    if (delta < threshold) {
      findings.push({
        kind: "coverage_drop",
        severity: "error",
        metric,
        message: `${metric} coverage dropped by ${delta} points.`,
      });
    }
  }

  if (Object.keys(metrics).length === 0) {
    findings.push({
      kind: "coverage_parse_failed",
      severity: "warning",
      message: "Coverage summaries did not contain comparable line, branch, function, or statement percentages.",
    });
  }

  return {
    decision: findings.some((finding) => finding.severity === "error")
      ? "fail"
      : findings.length > 0
        ? "warn"
        : "pass",
    metrics,
    findings,
  };
}

function parseCoverageSummary(value: string | CoverageSummary | undefined): CoverageSummary {
  if (!value) {
    return {};
  }
  if (typeof value !== "string") {
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [CoverageMetric, number] => isMetric(entry[0]) && Number.isFinite(entry[1])),
    ) as CoverageSummary;
  }
  const summary: CoverageSummary = {};
  for (const metric of METRICS) {
    const regex = new RegExp(`\\b${metric}\\b\\s*[:|]?\\s*(\\d+(?:\\.\\d+)?)\\s*%`, "i");
    const match = value.match(regex);
    if (match?.[1]) {
      summary[metric] = Number(match[1]);
    }
  }
  return summary;
}

function isMetric(value: string): value is CoverageMetric {
  return METRICS.includes(value as CoverageMetric);
}

function roundDelta(value: number): number {
  return Math.round(value * 100) / 100;
}
