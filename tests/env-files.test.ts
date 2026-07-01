import { describe, expect, it } from "vitest";
import {
  classifyEnvFilePath,
  isSensitiveEnvFilePath,
  isTemplateEnvFilePath,
} from "../src/env-files.js";

describe("env file classification", () => {
  it("classifies .envrc.example as a non-sensitive template", () => {
    expect(classifyEnvFilePath(".envrc.example")).toEqual({
      kind: "template",
      sensitive: false,
    });
    expect(isTemplateEnvFilePath(".envrc.example")).toBe(true);
    expect(isSensitiveEnvFilePath(".envrc.example")).toBe(false);
  });

  it("classifies env-like example files as templates without broadening to every example file", () => {
    expect(classifyEnvFilePath(".env.example")).toEqual({
      kind: "template",
      sensitive: false,
    });
    expect(classifyEnvFilePath("apps/web/config.env.sample")).toEqual({
      kind: "template",
      sensitive: false,
    });
    expect(classifyEnvFilePath("apps/web/example.env")).toEqual({
      kind: "sensitive",
      sensitive: true,
    });
    expect(classifyEnvFilePath("README.example")).toBeUndefined();
    expect(isTemplateEnvFilePath("README.example")).toBe(false);
  });

  it("classifies real env files as sensitive before exposing names or values", () => {
    expect(classifyEnvFilePath(".env")).toEqual({
      kind: "sensitive",
      sensitive: true,
    });
    expect(classifyEnvFilePath(".env.local")).toEqual({
      kind: "sensitive",
      sensitive: true,
    });
    expect(isSensitiveEnvFilePath("apps/web/.env.production")).toBe(true);
  });
});
