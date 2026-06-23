import { describe, expect, it } from "vitest";
import { createDefaultCapabilityManifest } from "../src/capabilities.js";

describe("capability manifest", () => {
  it("declares v1 implemented capability plus v2 and v3 planned tracks", () => {
    const manifest = createDefaultCapabilityManifest();

    expect(manifest.maxOrchestrationDepth).toBe(4);
    expect(manifest.connectors.map((connector) => connector.target)).toEqual([
      "generic-mcp",
      "claude-code",
      "codex",
    ]);
    expect(new Set(manifest.capabilities.map((capability) => capability.track))).toEqual(
      new Set(["v1", "v2", "v3"]),
    );
    expect(manifest.capabilities.some((capability) => capability.status === "implemented")).toBe(
      true,
    );
  });
});
