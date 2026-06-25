import {
  generateToolSpecsFromDiscovery,
  normalizeContentType,
  statusClass,
  toHttpMethod,
  type EndpointObservation,
} from "./api-discovery.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstKey(value: unknown): string | undefined {
  return isRecord(value) ? Object.keys(value)[0] : undefined;
}

function parseConstrainedYaml(text: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/);
  let serverUrl = "";
  const paths: Record<string, Record<string, Record<string, unknown>>> = {};
  let currentPath = "";
  let currentMethod = "";
  let inParameters = false;
  let pendingParameter: { name?: string; in?: string } | undefined;
  let inResponses = false;
  let currentStatus = "";

  function commitParameter() {
    if (currentPath && currentMethod && pendingParameter?.name) {
      const operation = paths[currentPath]![currentMethod]!;
      const parameters = (operation.parameters ?? []) as Array<Record<string, unknown>>;
      parameters.push({ name: pendingParameter.name, in: pendingParameter.in });
      operation.parameters = parameters;
    }
    pendingParameter = undefined;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("- url:")) {
      serverUrl = trimmed.slice("- url:".length).trim();
      continue;
    }
    if (/^\/.+:$/.test(trimmed)) {
      commitParameter();
      currentPath = trimmed.slice(0, -1);
      paths[currentPath] = {};
      currentMethod = "";
      inParameters = false;
      inResponses = false;
      continue;
    }
    const method = toHttpMethod(trimmed.replace(":", ""));
    if (method) {
      commitParameter();
      currentMethod = method.toLowerCase();
      paths[currentPath]![currentMethod] = {};
      inParameters = false;
      inResponses = false;
      continue;
    }
    if (!currentPath || !currentMethod) continue;
    const operation = paths[currentPath]![currentMethod]!;
    if (trimmed.startsWith("operationId:")) {
      operation.operationId = trimmed.slice("operationId:".length).trim();
      continue;
    }
    if (trimmed === "parameters:") {
      inParameters = true;
      inResponses = false;
      continue;
    }
    if (trimmed === "responses:") {
      commitParameter();
      inParameters = false;
      inResponses = true;
      continue;
    }
    if (inParameters && trimmed.startsWith("- name:")) {
      commitParameter();
      pendingParameter = { name: trimmed.slice("- name:".length).trim() };
      continue;
    }
    if (inParameters && trimmed.startsWith("in:") && pendingParameter) {
      pendingParameter.in = trimmed.slice("in:".length).trim();
      continue;
    }
    if (inResponses && /^"?\d{3}"?:$/.test(trimmed)) {
      currentStatus = trimmed.replace(/["':]/g, "");
      operation.responses = { [currentStatus]: { content: {} } };
      continue;
    }
    if (inResponses && trimmed.endsWith(": {}")) {
      const contentType = trimmed.slice(0, -" {}".length).replace(":", "").trim();
      const responses = operation.responses as Record<string, { content: Record<string, unknown> }>;
      responses[currentStatus] = { content: { [contentType]: {} } };
    }
  }
  commitParameter();
  return { openapi: "3.0.0", servers: [{ url: serverUrl }], paths };
}

function parseSpec(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return parseConstrainedYaml(text);
  }
}

function responseInfo(operation: Record<string, unknown>): {
  status?: number;
  contentType?: string;
} {
  const responses = isRecord(operation.responses) ? operation.responses : {};
  const statusKey = Object.keys(responses).sort()[0];
  const response = statusKey && isRecord(responses[statusKey]) ? responses[statusKey] : {};
  const contentType = firstKey(response.content);
  return { status: statusKey ? Number(statusKey) : undefined, contentType };
}

export function importOpenApi(input: { specText: string; sourceName: string }): {
  observations: EndpointObservation[];
  toolSpecs: ReturnType<typeof generateToolSpecsFromDiscovery>["toolSpecs"];
  warnings: string[];
} {
  const spec = parseSpec(input.specText);
  const serverUrl = isRecord(spec.servers) ? undefined : undefined;
  const servers = Array.isArray(spec.servers) ? spec.servers : [];
  const firstServer = servers.find(isRecord);
  const origin = typeof firstServer?.url === "string" ? new URL(firstServer.url).origin.toLowerCase() : "http://localhost";
  const paths = isRecord(spec.paths) ? spec.paths : {};
  const observations: EndpointObservation[] = [];

  for (const pathTemplate of Object.keys(paths).sort()) {
    const pathItem = paths[pathTemplate];
    if (!isRecord(pathItem)) continue;
    for (const [methodName, operationValue] of Object.entries(pathItem)) {
      const method = toHttpMethod(methodName);
      if (!method || !isRecord(operationValue)) continue;
      const parameters = Array.isArray(operationValue.parameters) ? operationValue.parameters.filter(isRecord) : [];
      const queryKeys = parameters
        .filter((parameter) => parameter.in === "query" && typeof parameter.name === "string")
        .map((parameter) => parameter.name as string)
        .sort();
      const requestBody = isRecord(operationValue.requestBody) ? operationValue.requestBody : {};
      const requestContentType = firstKey(requestBody.content);
      const response = responseInfo(operationValue);
      observations.push({
        method,
        origin,
        pathTemplate,
        queryKeys,
        requestContentType: normalizeContentType(requestContentType),
        responseContentType: normalizeContentType(response.contentType),
        statusClass: statusClass(response.status),
        source: "openapi",
        operationId: typeof operationValue.operationId === "string" ? operationValue.operationId : undefined,
      });
    }
  }

  observations.sort((left, right) => left.pathTemplate.localeCompare(right.pathTemplate) || right.method.localeCompare(left.method));
  const generated = generateToolSpecsFromDiscovery({ observations });
  return { observations, toolSpecs: generated.toolSpecs, warnings: [] };
}
