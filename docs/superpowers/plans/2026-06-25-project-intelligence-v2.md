# Project Intelligence Sequencing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the next Wormhole project-intelligence layer across onboarding, LSP sessions, durable indexes, test impact, dependency/security reporting, action policy, and optimization adapters.

**Architecture:** Add focused TypeScript modules that compose existing Wormhole primitives and keep external execution bounded. Wire them into `createToolHandlers`, MCP schemas, exports, capability metadata, plugin manifests, and docs.

**Tech Stack:** TypeScript, Node.js stdlib, existing repo index/optimization/command-runner modules, Vitest, MCP SDK Zod schemas.

---

## Tasks

- [x] Add failing module tests for `project-onboard`, `lsp-session-manager`, `durable-index-store`, `test-impact-v2`, `dependency-security`, `action-policy`, and `optimization-adapter`.
- [x] Implement minimal modules to satisfy those tests using existing local primitives.
- [x] Add handler integration tests proving the new tools work in combination through `createToolHandlers`.
- [x] Wire handlers into `src/tools.ts` and MCP schemas into `src/mcp-server.ts`.
- [x] Export new modules from `src/index.ts`.
- [x] Update `src/capabilities.ts`, README, architecture docs, contract docs, and plugin manifests.
- [x] Run full verification: `npm test`, `npm run typecheck`, `npm run build`, `npm run benchmarks:validate`, `npx --yes @anthropic-ai/mcpb validate plugins\wormhole-claude-desktop`, and `git diff --check`.
