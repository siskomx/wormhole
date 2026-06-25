import { describe, expect, it } from "vitest";
import { importOpenApi } from "../src/openapi-import.js";

describe("OpenAPI import", () => {
  it("imports JSON OpenAPI paths into observations and deterministic tool specs", () => {
    const specText = JSON.stringify({
      openapi: "3.0.0",
      servers: [{ url: "https://api.example.test" }],
      paths: {
        "/users/{id}": {
          get: {
            operationId: "getUser",
            parameters: [{ name: "expand", in: "query" }],
            responses: {
              "200": {
                content: {
                  "application/json": {},
                },
              },
            },
          },
        },
        "/users": {
          post: {
            operationId: "createUser",
            requestBody: {
              content: {
                "application/json": {},
              },
            },
            responses: {
              "201": {
                content: {
                  "application/json": {},
                },
              },
            },
          },
        },
      },
    });

    const first = importOpenApi({ specText, sourceName: "users.json" });
    const second = importOpenApi({ specText, sourceName: "users.json" });

    expect(first).toEqual(second);
    expect(first.warnings).toEqual([]);
    expect(first.observations).toEqual([
      expect.objectContaining({
        method: "POST",
        origin: "https://api.example.test",
        pathTemplate: "/users",
        queryKeys: [],
        requestContentType: "application/json",
        responseContentType: "application/json",
        statusClass: "2xx",
        source: "openapi",
        operationId: "createUser",
      }),
      expect.objectContaining({
        method: "GET",
        origin: "https://api.example.test",
        pathTemplate: "/users/{id}",
        queryKeys: ["expand"],
        responseContentType: "application/json",
        statusClass: "2xx",
        source: "openapi",
        operationId: "getUser",
      }),
    ]);
    expect(first.toolSpecs.map((tool) => [tool.toolId, tool.sideEffecting])).toEqual([
      ["api_createUser", true],
      ["api_getUser", false],
    ]);
  });

  it("parses a constrained YAML OpenAPI subset", () => {
    const specText = [
      "openapi: 3.0.0",
      "servers:",
      "  - url: https://api.example.test",
      "paths:",
      "  /teams:",
      "    get:",
      "      operationId: listTeams",
      "      parameters:",
      "        - name: page",
      "          in: query",
      "      responses:",
      "        \"200\":",
      "          content:",
      "            application/json: {}",
    ].join("\n");

    const result = importOpenApi({ specText, sourceName: "teams.yaml" });

    expect(result.warnings).toEqual([]);
    expect(result.observations).toEqual([
      expect.objectContaining({
        method: "GET",
        origin: "https://api.example.test",
        pathTemplate: "/teams",
        queryKeys: ["page"],
        responseContentType: "application/json",
        source: "openapi",
        operationId: "listTeams",
      }),
    ]);
    expect(result.toolSpecs[0]?.toolId).toBe("api_listTeams");
  });
});
