import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectProjectContract } from "../src/project-contract.js";

describe("project contract detection", () => {
  it("detects package scripts, lockfiles, env vars, dependencies, and ports", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-contract-"));
    try {
      writeFileSync(
        path.join(repoRoot, "package.json"),
        JSON.stringify({
          scripts: { test: "vitest run tests", build: "tsc -p tsconfig.json" },
          dependencies: { zod: "^4.0.0" },
          devDependencies: { vitest: "^4.0.0" },
        }),
      );
      writeFileSync(path.join(repoRoot, "package-lock.json"), "{}\n");
      writeFileSync(path.join(repoRoot, ".env.example"), "DATABASE_URL=\nPORT=3000\n");
      writeFileSync(
        path.join(repoRoot, "docker-compose.yml"),
        ["services:", "  api:", "    ports:", '      - "8080:3000"', ""].join("\n"),
      );

      const contract = detectProjectContract({ repoRoot });

      expect(contract.packageManager).toBe("npm");
      expect(contract.scripts.map((script) => script.name)).toEqual(["build", "test"]);
      expect(contract.lockfiles).toEqual(["package-lock.json"]);
      expect(contract.envVars.map((envVar) => envVar.name)).toEqual(["DATABASE_URL", "PORT"]);
      expect(contract.ports).toEqual([3000, 8080]);
      expect(contract.dependencies).toContainEqual({
        name: "zod",
        version: "^4.0.0",
        manager: "npm",
        dev: false,
      });
      expect(contract.dependencies).toContainEqual({
        name: "vitest",
        version: "^4.0.0",
        manager: "npm",
        dev: true,
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects missing repo roots", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-contract-root-"));
    try {
      expect(() => detectProjectContract({ repoRoot: path.join(repoRoot, "missing") })).toThrow(
        /does not exist/i,
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("redacts real env files while preserving template env names and ports", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-contract-env-redaction-"));
    try {
      writeFileSync(path.join(repoRoot, ".env.example"), "PUBLIC_PORT=3000\nDATABASE_URL=\n");
      writeFileSync(path.join(repoRoot, ".env"), "STRIPE_SECRET_KEY=not-a-real-payment-secret-placeholder\nPUBLIC_PORT=9999\n");
      writeFileSync(path.join(repoRoot, ".env.production.local"), "WEBROOT_PASSWORD=super-secret\n");
      writeFileSync(
        path.join(repoRoot, "docker-compose.yml"),
        [
          "services:",
          "  api:",
          "    environment:",
          "      OPENAI_API_KEY: ${OPENAI_API_KEY}",
          "    ports:",
          '      - "8080:3000"',
          "",
        ].join("\n"),
      );

      const contract = detectProjectContract({ repoRoot });
      const serialized = JSON.stringify(contract);

      expect(contract.envVars.map((envVar) => envVar.name)).toEqual(["DATABASE_URL", "PUBLIC_PORT"]);
      expect(contract.envSources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: ".env.example", sensitive: false, varCount: 2 }),
          expect.objectContaining({ source: ".env", sensitive: true, varCount: 2 }),
          expect.objectContaining({ source: ".env.production.local", sensitive: true, varCount: 1 }),
        ]),
      );
      expect(contract.ports).toEqual([3000, 8080]);
      expect(serialized).not.toContain("STRIPE_SECRET_KEY");
      expect(serialized).not.toContain("WEBROOT_PASSWORD");
      expect(serialized).not.toContain("OPENAI_API_KEY");
      expect(serialized).not.toContain("9999");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("detects Cargo, Tauri, and Rust language requirements", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-contract-rust-"));
    try {
      mkdirSync(path.join(repoRoot, "src-tauri", "src"), { recursive: true });
      writeFileSync(
        path.join(repoRoot, "Cargo.toml"),
        ["[workspace]", 'members = ["src-tauri"]', ""].join("\n"),
      );
      writeFileSync(
        path.join(repoRoot, "src-tauri", "Cargo.toml"),
        [
          "[package]",
          'name = "ai-browser"',
          'version = "0.1.0"',
          "[dependencies]",
          'tauri = "2.0.0"',
          "",
        ].join("\n"),
      );
      writeFileSync(path.join(repoRoot, "src-tauri", "src", "lib.rs"), "pub fn agent_query() {}\n");
      writeFileSync(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "{}\n");

      const contract = detectProjectContract({ repoRoot });

      expect(contract.packageManager).toBe("cargo");
      expect(contract.lockfiles).toEqual([]);
      expect(contract.scripts).toEqual(
        expect.arrayContaining([
          { name: "build", command: "cargo build" },
          { name: "test", command: "cargo test" },
        ]),
      );
      expect(contract.languages).toContainEqual(
        expect.objectContaining({
          language: "rust",
          totalFileCount: 1,
          supportLevel: "supported",
        }),
      );
      expect(contract.frameworks).toEqual(expect.arrayContaining(["cargo", "tauri"]));
      expect(contract.languageProfile.health.status).toBe("ok");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("detects .NET and C# language requirements", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-contract-dotnet-"));
    try {
      mkdirSync(path.join(repoRoot, "Api"), { recursive: true });
      writeFileSync(path.join(repoRoot, "Jellyfin.sln"), "\nMicrosoft Visual Studio Solution File\n");
      writeFileSync(
        path.join(repoRoot, "Api", "Api.csproj"),
        [
          '<Project Sdk="Microsoft.NET.Sdk.Web">',
          "  <PropertyGroup>",
          "    <TargetFramework>net8.0</TargetFramework>",
          "  </PropertyGroup>",
          "</Project>",
        ].join("\n"),
      );
      writeFileSync(
        path.join(repoRoot, "Api", "PlaybackController.cs"),
        "namespace Api; public sealed class PlaybackController { public void StartPlayback() {} }\n",
      );

      const contract = detectProjectContract({ repoRoot });

      expect(contract.packageManager).toBe("dotnet");
      expect(contract.lockfiles).toEqual(["Jellyfin.sln", "Api/Api.csproj"]);
      expect(contract.scripts).toEqual(
        expect.arrayContaining([
          { name: "build", command: "dotnet build" },
          { name: "test", command: "dotnet test" },
        ]),
      );
      expect(contract.languages).toContainEqual(
        expect.objectContaining({
          language: "csharp",
          totalFileCount: 1,
          supportLevel: "supported",
        }),
      );
      expect(contract.frameworks).toEqual(expect.arrayContaining(["dotnet", "aspnetcore"]));
      expect(contract.languageProfile.health.status).toBe("ok");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
