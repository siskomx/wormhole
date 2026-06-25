import {
  normalizeContentType,
  normalizeEndpointUrl,
  statusClass,
  type EndpointObservation,
} from "./api-discovery.js";
import { assertAllowedHttpUrl } from "./network-guard.js";

type PlaywrightChromium = {
  connectOverCDP?: (endpoint: string) => Promise<unknown>;
  launch?: (options: { headless: boolean }) => Promise<unknown>;
};

type BrowserLike = {
  newPage?: () => Promise<PageLike>;
  close?: () => Promise<void>;
};

type PageLike = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  goto: (url: string, options: { waitUntil: string; timeout: number }) => Promise<unknown>;
  waitForTimeout?: (ms: number) => Promise<void>;
  close?: () => Promise<void>;
};

type ResponseLike = {
  url?: () => string;
  status?: () => number;
  headers?: () => Record<string, string>;
  request?: () => {
    method?: () => string;
    headers?: () => Record<string, string>;
  };
};

function toMethod(value: string | undefined): EndpointObservation["method"] | undefined {
  const method = value?.toUpperCase();
  if (method && ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
    return method as EndpointObservation["method"];
  }
  return undefined;
}

export async function captureBrowserNetwork(input: {
  url: string;
  maxRequests?: number;
  browserEndpoint?: string;
  timeoutMs?: number;
  allowPrivateNetwork?: boolean;
}): Promise<{
  available: boolean;
  observations: EndpointObservation[];
  dependencyReport: string[];
  warnings: string[];
}> {
  const optionalImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{ chromium?: PlaywrightChromium }>;
  let browser: BrowserLike | undefined;
  try {
    await assertAllowedHttpUrl(input.url, { allowPrivateNetwork: input.allowPrivateNetwork });
    if (input.browserEndpoint) {
      await assertAllowedHttpUrl(input.browserEndpoint, { allowPrivateNetwork: input.allowPrivateNetwork });
    }
    const playwright = await optionalImport("playwright-core");
    if (!playwright.chromium) {
      return {
        available: false,
        observations: [],
        dependencyReport: ["playwright-core is available, but chromium is not exposed."],
        warnings: [],
      };
    }

    browser = input.browserEndpoint && playwright.chromium.connectOverCDP
      ? (await playwright.chromium.connectOverCDP(input.browserEndpoint) as BrowserLike)
      : (await playwright.chromium.launch?.({ headless: true }) as BrowserLike | undefined);

    if (!browser?.newPage) {
      return {
        available: false,
        observations: [],
        dependencyReport: ["playwright-core is available, but no browser instance could be created."],
        warnings: [],
      };
    }

    const observations: EndpointObservation[] = [];
    const maxRequests = Math.min(Math.max(input.maxRequests ?? 50, 1), 100);
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 5_000, 100), 10_000);
    const page = await browser.newPage();
    page.on("response", (response: unknown) => {
      if (observations.length >= maxRequests) {
        return;
      }
      const responseLike = response as ResponseLike;
      const url = responseLike.url?.();
      const method = toMethod(responseLike.request?.().method?.());
      if (!url || !method) {
        return;
      }
      const normalized = normalizeEndpointUrl(url);
      observations.push({
        method,
        origin: normalized.origin,
        pathTemplate: normalized.pathTemplate,
        queryKeys: normalized.queryKeys,
        requestContentType: normalizeContentType(responseLike.request?.().headers?.()["content-type"]),
        responseContentType: normalizeContentType(responseLike.headers?.()["content-type"]),
        statusClass: statusClass(responseLike.status?.()),
        source: "browser-capture",
      });
    });
    await page.goto(input.url, { waitUntil: "networkidle", timeout: timeoutMs });
    await page.waitForTimeout?.(Math.min(timeoutMs, 1_000));
    await page.close?.();

    return {
      available: true,
      observations,
      dependencyReport: ["playwright-core browser capture completed."],
      warnings: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      observations: [],
      dependencyReport: [`playwright-core unavailable or browser launch failed: ${message}`],
      warnings: [],
    };
  } finally {
    await browser?.close?.();
  }
}
