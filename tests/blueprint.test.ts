import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkBlueprintGate,
  compileRepoBlueprint,
  renderAgentContext,
} from "../src/blueprint.js";
import {
  createArchitectureMap,
  createProjectModelCache,
  discoverEntrypointFlows,
} from "../src/project-intelligence.js";
import { projectOnboard } from "../src/project-onboard.js";

function createFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-blueprint-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: {
          build: "tsc -p tsconfig.json",
          test: "vitest run tests",
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@modelcontextprotocol/sdk": "^1.29.0",
          zod: "^4.4.3",
        },
        devDependencies: {
          typescript: "^6.0.3",
          vitest: "^4.1.9",
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ packages: {} }));
  writeFileSync(path.join(repoRoot, "tsconfig.json"), "{}\n");
  writeFileSync(path.join(repoRoot, "src", "index.ts"), "export function main() { return 'ok'; }\n");
  writeFileSync(path.join(repoRoot, "tests", "index.test.ts"), "import { main } from '../src/index';\nmain();\n");
  return repoRoot;
}

function compileFixture(repoRoot: string) {
  const projectModelCache = createProjectModelCache();
  return compileRepoBlueprint({
    objective: "Create coding-agent operating rules.",
    onboard: projectOnboard({ repoRoot }),
    architecture: createArchitectureMap({ repoRoot, projectModelCache }),
    entrypoints: discoverEntrypointFlows({ repoRoot, projectModelCache }),
  });
}

describe("blueprint compiler", () => {
  it("compiles native repo intelligence into a repo blueprint and constraints", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileFixture(repoRoot);

      expect(result.blueprint.kind).toBe("existing_repo");
      expect(result.blueprint.fields.packageManager.value).toBe("npm");
      expect(result.blueprint.fields.packageManager.status).toBe("confirmed_from_repo");
      expect(result.blueprint.fields.language.value).toBe("TypeScript");
      expect(result.constraints.packageManager.value).toBe("npm");
      expect(result.constraints.requiredVerification.map((command) => command.name)).toContain("test");
      expect(result.approvalNeeded.map((item) => item.field)).toContain("database");
      expect(result.approvalNeeded.find((item) => item.field === "database")?.status).toBe("unknown_blocking");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("detects database conventions from source files when dependencies do not expose them", () => {
    const repoRoot = createFixtureRepo();
    try {
      writeFileSync(
        path.join(repoRoot, "src", "sqlite-repo-index.ts"),
        "import { DatabaseSync } from 'node:sqlite';\nexport const db = new DatabaseSync(':memory:');\n",
      );

      const result = compileFixture(repoRoot);

      expect(result.blueprint.fields.database.value).toBe("SQLite");
      expect(result.blueprint.fields.database.status).toBe("confirmed_from_repo");
      expect(result.approvalNeeded.map((item) => item.field)).not.toContain("database");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("discovers feature file maps from frontend, backend, docs, migrations, and tests", () => {
    const repoRoot = createFixtureRepo();
    try {
      mkdirSync(path.join(repoRoot, "src", "features", "chat", "hooks"), { recursive: true });
      mkdirSync(path.join(repoRoot, "backend", "src", "modules", "chat", "__tests__"), { recursive: true });
      mkdirSync(path.join(repoRoot, "docs", "discoveries", "features"), { recursive: true });
      mkdirSync(path.join(repoRoot, "migrations"), { recursive: true });
      writeFileSync(
        path.join(repoRoot, "src", "features", "chat", "hooks", "useChat.ts"),
        "export function useChat() { return { sendMessage() {} }; }\n",
      );
      writeFileSync(
        path.join(repoRoot, "backend", "src", "modules", "chat", "ChatRoutes.ts"),
        "export function registerChatRoutes(app) { app.post('/sessions/:id/messages', () => {}); }\n",
      );
      writeFileSync(
        path.join(repoRoot, "backend", "src", "modules", "chat", "ChatService.ts"),
        "export class ChatService { sendMessage() { return 'ok'; } }\n",
      );
      writeFileSync(
        path.join(repoRoot, "backend", "src", "modules", "chat", "__tests__", "chatResponseValidation.test.ts"),
        "import '../ChatService.js';\n",
      );
      writeFileSync(path.join(repoRoot, "migrations", "all_030_create_chat_tables.sql"), "create table if not exists public.chat_sessions(id text);\n");
      writeFileSync(
        path.join(repoRoot, "docs", "discoveries", "features", "chat.md"),
        "- chat uses src/features/chat and backend/src/modules/chat/ChatRoutes.ts\n",
      );

      const result = compileFixture(repoRoot);
      const chat = result.blueprint.featureIndex.features.find((feature) => feature.featureId === "chat");

      expect(chat?.files.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          "src/features/chat/hooks/useChat.ts",
          "backend/src/modules/chat/ChatRoutes.ts",
          "backend/src/modules/chat/ChatService.ts",
          "backend/src/modules/chat/__tests__/chatResponseValidation.test.ts",
          "migrations/all_030_create_chat_tables.sql",
          "docs/discoveries/features/chat.md",
        ]),
      );
      expect(chat?.files.flatMap((file) => file.roles)).toEqual(
        expect.arrayContaining(["frontend", "hook", "backend", "route", "test", "db", "doc"]),
      );
      expect(chat?.risk.sideEffects).toEqual(expect.arrayContaining(["http_mutation", "database_schema"]));
      expect(chat?.dbTables).toContain("chat_sessions");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("keeps generic buckets and agent scratch files out of feature maps", () => {
    const repoRoot = createFixtureRepo();
    try {
      mkdirSync(path.join(repoRoot, "src", "features", "chat"), { recursive: true });
      mkdirSync(path.join(repoRoot, "src", "routes"), { recursive: true });
      mkdirSync(path.join(repoRoot, "src", "domain", "translations"), { recursive: true });
      mkdirSync(path.join(repoRoot, ".superpowers", "brainstorm"), { recursive: true });
      writeFileSync(path.join(repoRoot, "src", "features", "chat", "ChatView.tsx"), "export function ChatView() { return null; }\n");
      writeFileSync(path.join(repoRoot, "src", "routes", "FeaturesPage.tsx"), "export function FeaturesPage() { return null; }\n");
      writeFileSync(path.join(repoRoot, "src", "domain", "translations", "chatDictionary.ts"), "export const chat = {};\n");
      writeFileSync(path.join(repoRoot, ".superpowers", "brainstorm", "ai-chat-notes.md"), "# scratch\n");

      const result = compileFixture(repoRoot);
      const featureIds = result.blueprint.featureIndex.features.map((feature) => feature.featureId);
      const chat = result.blueprint.featureIndex.features.find((feature) => feature.featureId === "chat");

      expect(featureIds).not.toContain("features");
      expect(featureIds).not.toContain("domain");
      expect(chat?.files.map((file) => file.path)).not.toContain(".superpowers/brainstorm/ai-chat-notes.md");
      expect(chat?.files.map((file) => file.path)).toContain("src/features/chat/ChatView.tsx");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("creates compound feature maps for client-agent workflow files", () => {
    const repoRoot = createFixtureRepo();
    try {
      mkdirSync(path.join(repoRoot, "backend", "tests", "workflows"), { recursive: true });
      mkdirSync(path.join(repoRoot, "backend", "src", "modules", "clients"), { recursive: true });
      mkdirSync(path.join(repoRoot, "backend", "src", "modules", "agents"), { recursive: true });
      mkdirSync(path.join(repoRoot, "docs", "workflows", "behavior"), { recursive: true });
      writeFileSync(path.join(repoRoot, "backend", "src", "modules", "clients", "ClientRoutes.ts"), "export function registerClientRoutes() {}\n");
      writeFileSync(path.join(repoRoot, "backend", "src", "modules", "agents", "AgentRoutes.ts"), "export function registerAgentRoutes() {}\n");
      writeFileSync(
        path.join(repoRoot, "backend", "tests", "workflows", "org-client-agent-bill-invoice-review.workflow.test.ts"),
        "describe('client agent invoice review', () => {});\n",
      );
      writeFileSync(
        path.join(repoRoot, "docs", "workflows", "behavior", "org-client-agent-bill-invoice-review.behavior.json"),
        JSON.stringify({ id: "org-client-agent-bill-invoice-review" }),
      );

      const result = compileFixture(repoRoot);
      const clientAgent = result.blueprint.featureIndex.features.find((feature) => feature.featureId === "client-agent");

      expect(clientAgent?.files.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          "backend/tests/workflows/org-client-agent-bill-invoice-review.workflow.test.ts",
          "docs/workflows/behavior/org-client-agent-bill-invoice-review.behavior.json",
        ]),
      );
      expect(clientAgent?.tests).toContain("backend/tests/workflows/org-client-agent-bill-invoice-review.workflow.test.ts");
      expect(clientAgent?.docs).toContain("docs/workflows/behavior/org-client-agent-bill-invoice-review.behavior.json");
      expect(clientAgent?.files.flatMap((file) => file.roles)).toEqual(expect.arrayContaining(["test", "doc"]));
      expect(
        result.blueprint.featureIndex.features.find((feature) => feature.featureId === "client")?.files.map((file) => file.path) ?? [],
      ).not.toContain("backend/tests/workflows/org-client-agent-bill-invoice-review.workflow.test.ts");
      expect(
        result.blueprint.featureIndex.features.find((feature) => feature.featureId === "agent")?.files.map((file) => file.path) ?? [],
      ).not.toContain("backend/tests/workflows/org-client-agent-bill-invoice-review.workflow.test.ts");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("renders concise Markdown context for coding agents", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileFixture(repoRoot);
      const markdown = renderAgentContext(result);

      expect(markdown).toContain("# Wormhole Agent Context");
      expect(markdown).toContain("Package manager: npm");
      expect(markdown).toContain("Required verification");
      expect(markdown).not.toContain("undefined");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("warns when a planned command uses the wrong package manager", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileFixture(repoRoot);
      const gate = checkBlueprintGate({
        constraints: result.constraints,
        action: {
          plannedCommands: [{ command: "pnpm", args: ["test"] }],
        },
      });

      expect(gate.status).toBe("warn");
      expect(gate.findings[0]?.ruleId).toBe("package-manager");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("blocks completion claims until required verification is reported", () => {
    const repoRoot = createFixtureRepo();
    try {
      const result = compileFixture(repoRoot);
      const blocked = checkBlueprintGate({
        constraints: result.constraints,
        action: {
          completionClaim: true,
          plannedCommands: [{ command: "npm", args: ["test"] }],
          reportedVerification: [],
        },
      });
      const passed = checkBlueprintGate({
        constraints: result.constraints,
        action: {
          completionClaim: true,
          plannedCommands: [{ command: "npm", args: ["test"] }],
          reportedVerification: [{ command: "npm", args: ["test"], status: "passed" }],
        },
      });

      expect(blocked.status).toBe("block");
      expect(blocked.findings.map((finding) => finding.ruleId)).toContain("verification-required");
      expect(passed.status).toBe("pass");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
