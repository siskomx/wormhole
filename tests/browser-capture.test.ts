import { describe, expect, it } from "vitest";
import { captureBrowserNetwork } from "../src/browser-capture.js";

describe("browser capture", () => {
  it("blocks private network browser targets before optional dependency loading", async () => {
    const result = await captureBrowserNetwork({
      url: "http://127.0.0.1:9",
      maxRequests: 1,
      timeoutMs: 100,
    });

    expect(result.available).toBe(false);
    expect(result.dependencyReport.join("\n")).toContain("Private network");
  });

  it("reports dependency status instead of throwing when playwright-core is unavailable", async () => {
    const result = await captureBrowserNetwork({
      url: "https://api.example.test",
      maxRequests: 1,
      timeoutMs: 10,
    });

    expect(result.available).toBe(false);
    expect(result.observations).toEqual([]);
    expect(result.dependencyReport.join("\n")).toContain("playwright-core");
  });
});
