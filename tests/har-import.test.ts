import { describe, expect, it } from "vitest";
import { importHar } from "../src/har-import.js";

describe("HAR import", () => {
  it("imports HAR 1.2 entries as redacted endpoint observations", () => {
    const harJson = {
      log: {
        version: "1.2",
        entries: [
          {
            request: {
              method: "GET",
              url: "https://api.example.test/users/123?z=9&a=1",
              headers: [
                { name: "Authorization", value: "Bearer secret" },
                { name: "X-Trace", value: "trace-1" },
              ],
            },
            response: {
              status: 200,
              headers: [
                { name: "Content-Type", value: "application/json; charset=utf-8" },
                { name: "Set-Cookie", value: "session=secret" },
              ],
              content: {
                mimeType: "application/json",
                text: "{\"name\":\"Ada\",\"token\":\"raw-body-token\"}",
              },
            },
          },
          {
            request: {
              method: "GET",
              url: "https://api.example.test/users/456?a=2",
              headers: [{ name: "Cookie", value: "session=secret" }],
            },
            response: {
              status: 404,
              headers: [{ name: "Content-Type", value: "application/json" }],
              content: { mimeType: "application/json", text: "{\"error\":\"missing\"}" },
            },
          },
          {
            request: {
              method: "GET",
              url: "data:text/plain,ignored",
              headers: [],
            },
            response: { status: 200, headers: [] },
          },
          {
            request: {
              method: "POST",
              url: "file:///tmp/ignored",
              headers: [],
            },
            response: { status: 200, headers: [] },
          },
        ],
      },
    };

    const first = importHar({ harJson });
    const second = importHar({ harJson });

    expect(first).toEqual(second);
    expect(first.redactions).toBe(3);
    expect(first.warnings).toEqual([
      "Skipped unsupported HAR request URL scheme: data:",
      "Skipped unsupported HAR request URL scheme: file:",
    ]);
    expect(first.observations).toEqual([
      expect.objectContaining({
        method: "GET",
        origin: "https://api.example.test",
        pathTemplate: "/users/{id}",
        queryKeys: ["a", "z"],
        responseContentType: "application/json",
        statusClass: "2xx",
        source: "har",
      }),
      expect.objectContaining({
        method: "GET",
        origin: "https://api.example.test",
        pathTemplate: "/users/{id}",
        queryKeys: ["a"],
        responseContentType: "application/json",
        statusClass: "4xx",
        source: "har",
      }),
    ]);
    expect(first.observations.every((observation) => /^[a-f0-9]{64}$/.test(observation.sampleHash ?? ""))).toBe(
      true,
    );
    expect(JSON.stringify(first)).not.toContain("Bearer secret");
    expect(JSON.stringify(first)).not.toContain("raw-body-token");
  });
});
