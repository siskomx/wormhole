import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { crawlHttp } from "../src/http-crawler.js";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe("HTTP crawler", () => {
  it("blocks private network targets unless explicitly allowed", async () => {
    await expect(crawlHttp({ startUrl: "http://127.0.0.1:9/" })).rejects.toThrow(/Private network/i);
  });

  it("crawls same-origin HTML and discovers links, forms, and script URLs", async () => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(
          [
            '<a href="/users?page=2">Users</a>',
            '<a href="https://external.example.test/skipped">External</a>',
            '<script src="/assets/app.js"></script>',
            '<form action="/api/search?existing=1" method="post" enctype="application/json">',
            '<input name="q">',
            "</form>",
          ].join(""),
        );
        return;
      }
      if (url.pathname === "/users") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<script>fetch('/api/users?filter=active');</script>");
        return;
      }
      if (url.pathname === "/assets/app.js") {
        response.writeHead(200, { "Content-Type": "application/javascript" });
        response.end('fetch("/api/from-script?x=1")');
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{\"ok\":true}");
        return;
      }
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("missing");
    });
    const origin = await listen(server);

    try {
      const result = await crawlHttp({
        startUrl: `${origin}/`,
        maxPages: 10,
        maxDepth: 3,
        timeoutMs: 1_000,
        allowPrivateNetwork: true,
      });

      expect(result.visitedUrls).toEqual([
        `${origin}/`,
        `${origin}/assets/app.js`,
        `${origin}/users?page`,
        `${origin}/api/from-script?x`,
        `${origin}/api/users?filter`,
      ]);
      expect(result.warnings).toContain("Skipped disallowed origin: https://external.example.test");
      expect(result.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            origin,
            pathTemplate: "/",
            responseContentType: "text/html",
            statusClass: "2xx",
            source: "http-crawl",
          }),
          expect.objectContaining({
            method: "POST",
            origin,
            pathTemplate: "/api/search",
            queryKeys: ["existing"],
            requestContentType: "application/json",
            source: "http-crawl",
          }),
          expect.objectContaining({
            method: "GET",
            origin,
            pathTemplate: "/api/users",
            queryKeys: ["filter"],
            responseContentType: "application/json",
            statusClass: "2xx",
            source: "http-crawl",
          }),
          expect.objectContaining({
            method: "GET",
            origin,
            pathTemplate: "/api/from-script",
            queryKeys: ["x"],
            responseContentType: "application/json",
            statusClass: "2xx",
            source: "http-crawl",
          }),
        ]),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
