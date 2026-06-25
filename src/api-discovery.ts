import { createHash } from "node:crypto";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export type EndpointSource = "har" | "openapi" | "http-crawl" | "browser-capture";

export type EndpointObservation = {
  method: HttpMethod;
  origin: string;
  pathTemplate: string;
  queryKeys: string[];
  requestContentType?: string;
  responseContentType?: string;
  statusClass?: "2xx" | "3xx" | "4xx" | "5xx";
  sampleHash?: string;
  source: EndpointSource;
  operationId?: string;
};

export type DiscoveryToolSpec = {
  toolId: string;
  displayName: string;
  description: string;
  commandName: string;
  capabilities: string[];
  inputs: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description?: string;
  }>;
  sideEffecting: boolean;
  method: HttpMethod;
  origin: string;
  pathTemplate: string;
};

const METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const MUTATING_METHODS = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);
const SENSITIVE_PATH_NAMES = new Set(["token", "secret", "signature", "apikey", "api_key", "access_token"]);

function isSensitiveHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "set-cookie" ||
    normalized === "x-api-key" ||
    normalized.includes("token") ||
    normalized.includes("api-key")
  );
}

export function redactHeaders(headers: Record<string, string>): {
  headers: Record<string, string>;
  redactions: number;
} {
  const redacted: Record<string, string> = {};
  let redactions = 0;
  for (const [name, value] of Object.entries(headers).sort(([left], [right]) =>
    left.toLowerCase().localeCompare(right.toLowerCase()),
  )) {
    const key = name.toLowerCase();
    if (isSensitiveHeader(key)) {
      redacted[key] = "[REDACTED]";
      redactions += 1;
    } else {
      redacted[key] = value;
    }
  }
  return { headers: redacted, redactions };
}

export function normalizeContentType(value: string | undefined): string | undefined {
  return value?.split(";")[0]?.trim().toLowerCase() || undefined;
}

export function statusClass(status: number | undefined): "2xx" | "3xx" | "4xx" | "5xx" | undefined {
  if (typeof status !== "number") {
    return undefined;
  }
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return undefined;
}

export function normalizeEndpointUrl(rawUrl: string): {
  origin: string;
  pathTemplate: string;
  queryKeys: string[];
} {
  const url = new URL(rawUrl);
  const pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  const queryKeys = Array.from(new Set(Array.from(url.searchParams.keys()))).sort();
  return {
    origin: url.origin.toLowerCase(),
    pathTemplate: sanitizePathTemplate(pathname || "/"),
    queryKeys,
  };
}

export function sanitizePathTemplate(pathTemplate: string): string {
  if (pathTemplate === "/") {
    return "/";
  }
  return pathTemplate
    .split("/")
    .map((segment) => {
      if (!segment || /^\{[^}]+\}$/.test(segment)) {
        return segment;
      }
      const lower = segment.toLowerCase();
      if (
        SENSITIVE_PATH_NAMES.has(lower) ||
        /^\d+$/.test(segment) ||
        /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment) ||
        (/^[A-Za-z0-9_-]{18,}$/.test(segment) && /[0-9]/.test(segment))
      ) {
        return "{id}";
      }
      return segment;
    })
    .join("/");
}

export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeToolName(value: string): string {
  return value
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function pathParams(pathTemplate: string): string[] {
  return Array.from(pathTemplate.matchAll(/\{([^}]+)\}/g), (match) => match[1] ?? "").filter(Boolean);
}

function toolIdFor(observation: EndpointObservation): string {
  if (observation.operationId) {
    return `api_${normalizeToolName(observation.operationId)}`;
  }
  return `api_${observation.method.toLowerCase()}_${normalizeToolName(observation.pathTemplate)}`;
}

export function toHttpMethod(value: string): HttpMethod | undefined {
  const method = value.toUpperCase() as HttpMethod;
  return METHODS.has(method) ? method : undefined;
}

export function generateToolSpecsFromDiscovery(input: {
  observations: EndpointObservation[];
  baseCommand?: string;
  authMode?: "none" | "bearer-env" | "api-key-env";
}): {
  toolSpecs: DiscoveryToolSpec[];
  warnings: string[];
} {
  const grouped = new Map<string, EndpointObservation[]>();
  for (const observation of input.observations) {
    const sanitized = { ...observation, pathTemplate: sanitizePathTemplate(observation.pathTemplate) };
    const key = [sanitized.method, sanitized.origin, sanitized.pathTemplate].join(" ");
    grouped.set(key, [...(grouped.get(key) ?? []), sanitized]);
  }

  const toolSpecs = Array.from(grouped.values()).map((group) => {
    const preferred = group.find((observation) => observation.source === "openapi" && observation.operationId) ?? group[0]!;
    const queryKeys = Array.from(new Set(group.flatMap((observation) => observation.queryKeys))).sort();
    const requestContentType = group.find((observation) => observation.requestContentType)?.requestContentType;
    const sideEffecting = MUTATING_METHODS.has(preferred.method);
    const inputs = [
      ...pathParams(preferred.pathTemplate).map((name) => ({
        name,
        type: "string" as const,
        required: true,
        description: `Path parameter ${name}`,
      })),
      ...queryKeys.map((name) => ({
        name,
        type: "string" as const,
        required: false,
        description: `Query parameter ${name}`,
      })),
    ];
    if (requestContentType || sideEffecting) {
      inputs.push({
        name: "body",
        type: "string" as const,
        required: false,
        description: "Request body as JSON",
      });
    }
    if (input.authMode === "bearer-env") {
      inputs.push({
        name: "bearerTokenEnv",
        type: "string" as const,
        required: true,
        description: "Environment variable name that contains the bearer token",
      });
    }
    if (input.authMode === "api-key-env") {
      inputs.push({
        name: "apiKeyEnv",
        type: "string" as const,
        required: true,
        description: "Environment variable name that contains the API key",
      });
    }
    const toolId = toolIdFor(preferred);
    return {
      toolId,
      displayName: toolId.replace(/^api_/, "").replace(/_/g, " "),
      description: `${preferred.method} ${preferred.origin}${preferred.pathTemplate}`,
      commandName: input.baseCommand ?? "api-call",
      capabilities: [
        "api-discovery",
        ...(sideEffecting ? ["side-effecting"] : []),
        ...(input.authMode && input.authMode !== "none" ? [`auth:${input.authMode}`] : []),
      ],
      inputs,
      sideEffecting,
      method: preferred.method,
      origin: preferred.origin,
      pathTemplate: preferred.pathTemplate,
    };
  });

  toolSpecs.sort((left, right) => left.toolId.localeCompare(right.toolId));
  return { toolSpecs, warnings: [] };
}
