import { describe, expect, it } from "vitest";
import {
  generateToolSpecsFromDiscovery,
  normalizeEndpointUrl,
  redactHeaders,
  type EndpointObservation,
} from "../src/api-discovery.js";

describe("api discovery primitives", () => {
  it("redacts sensitive and token-like headers deterministically", () => {
    const result = redactHeaders({
      Accept: "application/json",
      Authorization: "Bearer secret",
      Cookie: "session=secret",
      "Set-Cookie": "session=secret",
      "X-Api-Key": "secret",
      "X-Custom-Token": "secret",
    });

    expect(result).toEqual({
      headers: {
        accept: "application/json",
        authorization: "[REDACTED]",
        cookie: "[REDACTED]",
        "set-cookie": "[REDACTED]",
        "x-api-key": "[REDACTED]",
        "x-custom-token": "[REDACTED]",
      },
      redactions: 5,
    });
  });

  it("normalizes URL origin, paths, and sorted unique query keys", () => {
    expect(normalizeEndpointUrl("https://EXAMPLE.test:443/v1/users/?z=9&a=1&a=2#ignored")).toEqual({
      origin: "https://example.test",
      pathTemplate: "/v1/users",
      queryKeys: ["a", "z"],
    });
  });

  it("merges duplicate observations into deterministic side-effect-aware tool specs", () => {
    const duplicateGetFromHar: EndpointObservation = {
      method: "GET",
      origin: "https://api.example.test",
      pathTemplate: "/users/{id}",
      queryKeys: ["verbose"],
      responseContentType: "application/json",
      source: "har",
    };
    const duplicateGetFromOpenApi: EndpointObservation = {
      method: "GET",
      origin: "https://api.example.test",
      pathTemplate: "/users/{id}",
      queryKeys: ["expand"],
      responseContentType: "application/json",
      source: "openapi",
      operationId: "getUser",
    };
    const mutatingPost: EndpointObservation = {
      method: "POST",
      origin: "https://api.example.test",
      pathTemplate: "/users",
      queryKeys: [],
      requestContentType: "application/json",
      responseContentType: "application/json",
      source: "openapi",
      operationId: "createUser",
    };

    const first = generateToolSpecsFromDiscovery({
      observations: [duplicateGetFromHar, mutatingPost, duplicateGetFromOpenApi],
      baseCommand: "api-call",
    });
    const second = generateToolSpecsFromDiscovery({
      observations: [duplicateGetFromOpenApi, duplicateGetFromHar, mutatingPost],
      baseCommand: "api-call",
    });

    expect(first).toEqual(second);
    expect(first.warnings).toEqual([]);
    expect(first.toolSpecs.map((tool) => tool.toolId)).toEqual(["api_createUser", "api_getUser"]);

    const getUser = first.toolSpecs.find((tool) => tool.toolId === "api_getUser");
    expect(getUser).toMatchObject({
      sideEffecting: false,
      method: "GET",
      origin: "https://api.example.test",
      pathTemplate: "/users/{id}",
    });
    expect(getUser?.inputs).toEqual([
      { name: "id", type: "string", required: true, description: "Path parameter id" },
      { name: "expand", type: "string", required: false, description: "Query parameter expand" },
      { name: "verbose", type: "string", required: false, description: "Query parameter verbose" },
    ]);

    const createUser = first.toolSpecs.find((tool) => tool.toolId === "api_createUser");
    expect(createUser).toMatchObject({
      sideEffecting: true,
      method: "POST",
      capabilities: ["api-discovery", "side-effecting"],
    });
    expect(createUser?.inputs).toEqual([
      { name: "body", type: "string", required: false, description: "Request body as JSON" },
    ]);
  });

  it("adds auth environment inputs when auth mode is requested", () => {
    const result = generateToolSpecsFromDiscovery({
      observations: [
        {
          method: "GET",
          origin: "https://api.example.test",
          pathTemplate: "/users",
          queryKeys: [],
          source: "openapi",
          operationId: "listUsers",
        },
      ],
      authMode: "bearer-env",
    });

    expect(result.toolSpecs[0]?.capabilities).toContain("auth:bearer-env");
    expect(result.toolSpecs[0]?.inputs).toContainEqual({
      name: "bearerTokenEnv",
      type: "string",
      required: true,
      description: "Environment variable name that contains the bearer token",
    });
  });
});
