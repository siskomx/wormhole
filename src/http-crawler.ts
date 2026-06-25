import {
  normalizeContentType,
  normalizeEndpointUrl,
  statusClass,
  type EndpointObservation,
} from "./api-discovery.js";
import { assertAllowedHttpUrl } from "./network-guard.js";

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function resolveUrl(base: string, value: string): string | undefined {
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

function safeDisplayUrl(rawUrl: string): string {
  const normalized = normalizeEndpointUrl(rawUrl);
  return `${normalized.origin}${normalized.pathTemplate}${
    normalized.queryKeys.length > 0 ? `?${normalized.queryKeys.join("&")}` : ""
  }`;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(decoder.decode(value.slice(0, Math.max(0, value.byteLength - (total - maxBytes))), { stream: false }));
      await reader.cancel();
      break;
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

function extractAttributeUrls(html: string, base: string, tag: string, attribute: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\s${attribute}=["']([^"']+)["'][^>]*>`, "gi");
  return Array.from(html.matchAll(pattern), (match) => resolveUrl(base, match[1] ?? ""))
    .filter((url): url is string => Boolean(url));
}

function extractFetchUrls(text: string, base: string): string[] {
  return Array.from(text.matchAll(/fetch\(["']([^"']+)["']/g), (match) => resolveUrl(base, match[1] ?? ""))
    .filter((url): url is string => Boolean(url));
}

function extractForms(html: string, base: string): EndpointObservation[] {
  const forms: EndpointObservation[] = [];
  for (const match of html.matchAll(/<form\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const action = attrs.match(/\saction=["']([^"']+)["']/i)?.[1] ?? base;
    const method = (attrs.match(/\smethod=["']([^"']+)["']/i)?.[1] ?? "GET").toUpperCase();
    const enctype = attrs.match(/\senctype=["']([^"']+)["']/i)?.[1];
    const url = resolveUrl(base, action);
    if (!url) continue;
    const normalized = normalizeEndpointUrl(url);
    forms.push({
      method: method === "POST" ? "POST" : "GET",
      origin: normalized.origin,
      pathTemplate: normalized.pathTemplate,
      queryKeys: normalized.queryKeys,
      requestContentType: normalizeContentType(enctype),
      source: "http-crawl",
    });
  }
  return forms;
}

function observationFromResponse(url: string, response: Response): EndpointObservation {
  const normalized = normalizeEndpointUrl(url);
  return {
    method: "GET",
    origin: normalized.origin,
    pathTemplate: normalized.pathTemplate,
    queryKeys: normalized.queryKeys,
    responseContentType: normalizeContentType(response.headers.get("content-type") ?? undefined),
    statusClass: statusClass(response.status),
    source: "http-crawl",
  };
}

export async function crawlHttp(input: {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number;
  allowOrigins?: string[];
  userAgent?: string;
  timeoutMs?: number;
  allowPrivateNetwork?: boolean;
  maxResponseBytes?: number;
}): Promise<{
  observations: EndpointObservation[];
  visitedUrls: string[];
  skipped: Array<{ url: string; reason: string }>;
  warnings: string[];
}> {
  const start = await assertAllowedHttpUrl(input.startUrl, {
    allowPrivateNetwork: input.allowPrivateNetwork,
  });
  const allowedOrigins = new Set([start.origin, ...(input.allowOrigins ?? [])]);
  const maxPages = Math.min(Math.max(input.maxPages ?? 25, 1), 25);
  const maxDepth = Math.min(Math.max(input.maxDepth ?? 3, 0), 3);
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 5_000, 100), 5_000);
  const maxResponseBytes = Math.min(Math.max(input.maxResponseBytes ?? 1_000_000, 1_024), 1_000_000);
  const queue: Array<{ url: string; depth: number }> = [{ url: start.toString(), depth: 0 }];
  const visited = new Set<string>();
  const observations: EndpointObservation[] = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const warnings: string[] = [];

  while (queue.length > 0 && visited.size < maxPages) {
    const next = queue.shift()!;
    if (visited.has(next.url) || next.depth > maxDepth) continue;
    const displayUrl = safeDisplayUrl(next.url);
    const url = new URL(next.url);
    if (!allowedOrigins.has(url.origin)) {
      const warning = `Skipped disallowed origin: ${url.origin}`;
      if (!warnings.includes(warning)) warnings.push(warning);
      skipped.push({ url: displayUrl, reason: "disallowed-origin" });
      continue;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await assertAllowedHttpUrl(next.url, { allowPrivateNetwork: input.allowPrivateNetwork });
      const response = await fetch(next.url, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": input.userAgent ?? "wormhole-http-crawler" },
      });
      visited.add(displayUrl);
      observations.push(observationFromResponse(next.url, response));
      const contentType = normalizeContentType(response.headers.get("content-type") ?? undefined);
      const text = await readLimitedText(response, maxResponseBytes);
      const discovered = [
        ...extractAttributeUrls(text, next.url, "script", "src"),
        ...extractAttributeUrls(text, next.url, "a", "href"),
        ...extractFetchUrls(text, next.url),
      ];
      observations.push(...extractForms(text, next.url));
      if (contentType === "text/html" || contentType === "application/javascript") {
        for (const found of unique(discovered)) {
          const foundUrl = new URL(found);
          if (!allowedOrigins.has(foundUrl.origin)) {
            const warning = `Skipped disallowed origin: ${foundUrl.origin}`;
            if (!warnings.includes(warning)) warnings.push(warning);
            skipped.push({ url: safeDisplayUrl(found), reason: "disallowed-origin" });
            continue;
          }
          try {
            await assertAllowedHttpUrl(found, { allowPrivateNetwork: input.allowPrivateNetwork });
          } catch (error) {
            warnings.push(error instanceof Error ? error.message : String(error));
            skipped.push({ url: safeDisplayUrl(found), reason: "network-guard" });
            continue;
          }
          if (!visited.has(safeDisplayUrl(found))) {
            queue.push({ url: found, depth: next.depth + 1 });
          }
        }
      }
    } catch (error) {
      warnings.push(`Failed to crawl ${displayUrl}: ${error instanceof Error ? error.message : String(error)}`);
      skipped.push({ url: displayUrl, reason: "fetch-failed" });
    } finally {
      clearTimeout(timer);
    }
  }

  return { observations, visitedUrls: Array.from(visited), skipped, warnings };
}
