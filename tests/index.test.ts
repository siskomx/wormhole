import { describe, expect, it } from "vitest";
import {
  createContextStore,
  createJsonRuntimeStateStore,
  createOptimizationStats,
  executeAgentTransport,
  generateToolScaffold,
} from "../src/index.js";

describe("package exports", () => {
  it("exports the runtime tooling modules through the package barrel", () => {
    expect(createContextStore).toBeTypeOf("function");
    expect(createJsonRuntimeStateStore).toBeTypeOf("function");
    expect(createOptimizationStats).toBeTypeOf("function");
    expect(executeAgentTransport).toBeTypeOf("function");
    expect(generateToolScaffold).toBeTypeOf("function");
  });
});
