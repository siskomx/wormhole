export type DogfoodStatus = "called" | "guarded" | "failed";

export type DogfoodClassification = {
  status: DogfoodStatus;
  detail?: unknown;
  error?: string;
};

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function statusOf(value: unknown): string | undefined {
  const status = asObject(value).status;
  return typeof status === "string" ? status : undefined;
}

function resultOf(value: unknown): Record<string, unknown> {
  return asObject(asObject(value).result);
}

function summarizeValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  }
  if (Array.isArray(value)) {
    return { arrayLength: value.length };
  }
  const objectValue = asObject(value);
  const keys = Object.keys(objectValue);
  if (keys.length === 0) {
    return value;
  }
  const summary: Record<string, unknown> = {};
  for (const key of keys.slice(0, 8)) {
    const child = objectValue[key];
    if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
      summary[key] = child;
    } else if (Array.isArray(child)) {
      summary[key] = { arrayLength: child.length };
    } else if (child && typeof child === "object") {
      summary[key] = { keys: Object.keys(child as Record<string, unknown>).slice(0, 8) };
    }
  }
  return summary;
}

function failureSummary(value: unknown): { detail: Record<string, unknown>; error: string } | undefined {
  const objectValue = asObject(value);
  const result = resultOf(value);
  const output = asObject(result.output ?? objectValue.output);
  const results = Array.isArray(objectValue.results) ? objectValue.results : [];
  const firstResult = asObject(results[0]);
  const status = statusOf(value);
  const resultStatus = statusOf(result);
  if (status !== "failed" && resultStatus !== "failed") {
    return undefined;
  }
  const summary =
    typeof result.summary === "string"
      ? result.summary
      : typeof objectValue.summary === "string"
        ? objectValue.summary
        : typeof firstResult.status === "string"
          ? `Tool returned failed status; first result was ${firstResult.status}.`
        : "Tool returned failed status.";
  const detail: Record<string, unknown> = {
    status,
    resultStatus,
    summary,
  };
  if (typeof output.transport === "string") {
    detail.transport = output.transport;
  }
  if (typeof output.durationMs === "number") {
    detail.durationMs = output.durationMs;
  }
  if (typeof output.exitCode === "number" || output.exitCode === null) {
    detail.exitCode = output.exitCode;
  }
  if (typeof output.stderrHash === "string") {
    detail.stderrHash = output.stderrHash;
  }
  if (typeof output.responseHash === "string") {
    detail.responseHash = output.responseHash;
  }
  if (results.length > 0) {
    detail.resultCount = results.length;
  }
  if (typeof firstResult.name === "string") {
    detail.firstResultName = firstResult.name;
  }
  if (typeof firstResult.status === "string") {
    detail.firstResultStatus = firstResult.status;
  }
  if (typeof firstResult.exitCode === "number" || firstResult.exitCode === null) {
    detail.firstResultExitCode = firstResult.exitCode;
  }
  if (typeof firstResult.durationMs === "number") {
    detail.firstResultDurationMs = firstResult.durationMs;
  }
  if (typeof firstResult.stderrHash === "string") {
    detail.firstResultStderrHash = firstResult.stderrHash;
  }
  return { detail, error: summary };
}

export function classifyDogfoodResult(raw: unknown): DogfoodClassification {
  const disposition = asObject(raw);
  if (disposition.status === "guarded") {
    return { status: "guarded", detail: disposition.detail };
  }

  const semanticSource = disposition.status === "called" ? disposition.detail : raw;
  const failure = failureSummary(semanticSource) ?? failureSummary(raw);
  if (failure) {
    return { status: "failed", detail: failure.detail, error: failure.error };
  }

  if (disposition.status === "called") {
    return { status: "called", detail: disposition.detail };
  }

  return { status: "called", detail: summarizeValue(raw) };
}
