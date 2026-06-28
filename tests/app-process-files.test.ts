import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileAppProcess } from "../src/app-process.js";
import { writeAppProcessArtifacts } from "../src/app-process-files.js";
import { compileBootstrapBlueprint } from "../src/blueprint.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-app-process-files-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  mkdirSync(path.join(repoRoot, "src", "features", "chat", "hooks"), { recursive: true });
  mkdirSync(path.join(repoRoot, "backend", "src", "modules", "chat"), { recursive: true });
  mkdirSync(path.join(repoRoot, "migrations"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: { test: "vitest run tests" },
        dependencies: { react: "^19.2.0" },
        devDependencies: { typescript: "^6.0.3", vitest: "^4.1.9" },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(path.join(repoRoot, "src", "index.tsx"), "export function App() { return null; }\n");
  writeFileSync(path.join(repoRoot, "src", "features", "chat", "hooks", "useChat.ts"), "export function useChat() { return {}; }\n");
  writeFileSync(path.join(repoRoot, "backend", "src", "modules", "chat", "ChatRoutes.ts"), "export function registerChatRoutes() {}\n");
  writeFileSync(path.join(repoRoot, "migrations", "all_030_create_chat_tables.sql"), "create table chat_sessions(id text);\n");
  return repoRoot;
}

describe("app process artifact writer", () => {
  it("writes product, roadmap, backlog, app context, and process lane artifacts", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileAppProcess({
        repoRoot,
        objective: "Build a team scheduling app.",
        blueprint: compileBootstrapBlueprint({ repoRoot, objective: "Build a team scheduling app." }),
      });

      const written = writeAppProcessArtifacts({ repoRoot, result });
      const relativePaths = written.files.map((file) => file.relativePath);

      expect(relativePaths).toEqual(
        expect.arrayContaining([
          ".wormhole/app-context.md",
          ".wormhole/app-process.md",
          ".wormhole/app-process.json",
          ".wormhole/feature-index.json",
          ".wormhole/app-process/phases/phase-0.json",
          ".wormhole/app-process/phases/phase-1.json",
          ".wormhole/backlog.json",
          ".wormhole/product-definition.md",
          ".wormhole/roadmap.json",
          ".wormhole/lanes/product.md",
          ".wormhole/lanes/roadmap.md",
          ".wormhole/lanes/ux.md",
          ".wormhole/lanes/security.md",
          ".wormhole/lanes/verification.md",
          ".wormhole/lanes/lifecycle.md",
        ]),
      );
      expect(existsSync(path.join(repoRoot, ".wormhole", "app-process.json"))).toBe(true);
      expect(readFileSync(path.join(repoRoot, ".wormhole", "app-context.md"), "utf8")).toContain("chat");
      expect(readFileSync(path.join(repoRoot, ".wormhole", "lanes", "discovery.md"), "utf8")).toContain("src/features/chat/hooks/useChat.ts");
      const lifecycleLane = readFileSync(path.join(repoRoot, ".wormhole", "lanes", "lifecycle.md"), "utf8");
      expect(lifecycleLane).toContain("# Lifecycle Lane");
      expect(lifecycleLane).toContain("## environment");
      expect(lifecycleLane).toContain("Release readiness:");
      expect(
        JSON.parse(readFileSync(path.join(repoRoot, ".wormhole", "feature-index.json"), "utf8")).features.find(
          (feature: { featureId: string }) => feature.featureId === "chat",
        ).files,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "src/features/chat/hooks/useChat.ts" }),
          expect.objectContaining({ path: "backend/src/modules/chat/ChatRoutes.ts" }),
          expect.objectContaining({ path: "migrations/all_030_create_chat_tables.sql" }),
        ]),
      );
      expect(JSON.parse(readFileSync(path.join(repoRoot, ".wormhole", "backlog.json"), "utf8")).stories.length).toBeGreaterThan(0);
      expect(readFileSync(path.join(repoRoot, ".wormhole", "product-definition.md"), "utf8")).toContain("## Non Goals");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
