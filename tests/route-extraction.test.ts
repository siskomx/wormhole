import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractRouteEndpoints } from "../src/route-extraction.js";

describe("route extraction", () => {
  it("extracts direct routes and mounted child prefixes", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-routes-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src", "server.ts"),
      [
        "import childRoutes from './child';",
        "app.get('/health', handler);",
        "app.use('/api', childRoutes);",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(repoRoot, "src", "child.ts"),
      "router.post('/users', authenticate, handler);\n",
    );

    const endpoints = extractRouteEndpoints({
      repoRoot,
      files: ["src/server.ts", "src/child.ts"],
    });

    expect(endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", pathTemplate: "/health", sourcePath: "src/server.ts" }),
        expect.objectContaining({ method: "POST", pathTemplate: "/api/users", sourcePath: "src/child.ts" }),
      ]),
    );
  });
});
