import {
  normalizeContentType,
  normalizeEndpointUrl,
  redactHeaders,
  sha256Hex,
  statusClass,
  toHttpMethod,
  type EndpointObservation,
} from "./api-discovery.js";

type HarHeader = { name?: unknown; value?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function headersToRecord(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const header of value) {
    if (isRecord(header) && typeof header.name === "string" && typeof header.value === "string") {
      headers[header.name] = header.value;
    }
  }
  return headers;
}

function pathPattern(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => (/^\d+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment) ? "{id}" : segment))
    .join("/");
}

export function importHar(input: { harJson: unknown; maxEntries?: number }): {
  observations: EndpointObservation[];
  redactions: number;
  warnings: string[];
} {
  const log = isRecord(input.harJson) && isRecord(input.harJson.log) ? input.harJson.log : {};
  const maxEntries = Math.min(Math.max(input.maxEntries ?? 100, 1), 1_000);
  const entries = Array.isArray(log.entries) ? log.entries.slice(0, maxEntries) : [];
  const warnings: string[] = [];
  const raw: Array<{
    entry: Record<string, unknown>;
    normalized: ReturnType<typeof normalizeEndpointUrl>;
    method: NonNullable<ReturnType<typeof toHttpMethod>>;
    url: URL;
  }> = [];

  for (const entry of entries) {
    if (!isRecord(entry) || !isRecord(entry.request)) {
      continue;
    }
    const request = entry.request;
    if (typeof request.url !== "string" || typeof request.method !== "string") {
      continue;
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      warnings.push(`Skipped invalid HAR request URL: ${request.url}`);
      continue;
    }
    if (url.protocol === "data:" || url.protocol === "file:") {
      warnings.push(`Skipped unsupported HAR request URL scheme: ${url.protocol}`);
      continue;
    }
    const method = toHttpMethod(request.method);
    if (!method) {
      continue;
    }
    raw.push({ entry, normalized: normalizeEndpointUrl(request.url), method, url });
  }

  const patternCounts = new Map<string, number>();
  for (const item of raw) {
    const pattern = pathPattern(item.normalized.pathTemplate);
    const key = [item.method, item.normalized.origin, pattern].join(" ");
    patternCounts.set(key, (patternCounts.get(key) ?? 0) + 1);
  }

  let redactions = 0;
  const observations = raw.map((item) => {
    const request = item.entry.request as Record<string, unknown>;
    const response = isRecord(item.entry.response) ? item.entry.response : {};
    const redactedRequest = redactHeaders(headersToRecord(request.headers as HarHeader[]));
    const redactedResponse = redactHeaders(headersToRecord(response.headers as HarHeader[]));
    redactions += redactedRequest.redactions + redactedResponse.redactions;
    const responseHeaders = redactedResponse.headers;
    const responseContent = isRecord(response.content) ? response.content : {};
    const candidatePattern = pathPattern(item.normalized.pathTemplate);
    const patternKey = [item.method, item.normalized.origin, candidatePattern].join(" ");
    const pathTemplate = (patternCounts.get(patternKey) ?? 0) >= 2 ? candidatePattern : item.normalized.pathTemplate;
    return {
      method: item.method,
      origin: item.normalized.origin,
      pathTemplate,
      queryKeys: item.normalized.queryKeys,
      responseContentType: normalizeContentType(
        typeof responseContent.mimeType === "string"
          ? responseContent.mimeType
          : responseHeaders["content-type"],
      ),
      statusClass: statusClass(typeof response.status === "number" ? response.status : undefined),
      sampleHash: sha256Hex({
        request: { method: item.method, url: `${item.normalized.origin}${pathTemplate}`, headers: redactedRequest.headers },
        response: {
          status: response.status,
          headers: responseHeaders,
          byteLength: typeof responseContent.text === "string" ? responseContent.text.length : 0,
        },
      }),
      source: "har" as const,
    };
  });

  return { observations, redactions, warnings };
}
