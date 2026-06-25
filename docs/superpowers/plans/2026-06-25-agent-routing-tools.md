# Agent Routing Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Wormhole-native agent-facing routing tools that reduce tool-surface overload and tell coding agents what to call next.

**Architecture:** Create a focused `src/agent-routing.ts` module that composes the native project-intelligence spine, project onboarding signals, and action/test policy into four high-level tools: `project_intelligence_snapshot`, `next_best_tool`, `mission_route`, and `agent_context_prepare`. Wire the module through the existing MCP handler/schema/manifest pattern without replacing lower-level tools.

**Tech Stack:** TypeScript, Node.js stdlib, existing Wormhole project-intelligence/project-onboard primitives, Vitest, MCP SDK Zod schemas.

---

## Tasks

- [ ] Add failing tests in `tests/agent-routing.test.ts` for snapshot, next-tool routing, mission route, and context preparation.
- [ ] Implement `src/agent-routing.ts` with deterministic, typed routing decisions and recommended tool calls.
- [ ] Wire the tools through `src/tools.ts`, `src/mcp-server.ts`, and `src/index.ts`.
- [ ] Update capability metadata, README/docs, and Codex/Claude plugin manifests.
- [ ] Run focused tests, then `npm test`, `npm run typecheck`, `npm run build`, `npm run benchmarks:validate`, MCPB validation, and `git diff --check`.
