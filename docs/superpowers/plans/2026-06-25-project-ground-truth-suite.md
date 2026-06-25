# Project Ground Truth Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Wormhole's next project-onboarding tool layer: local ground truth, diagnostics, verification planning, project contracts, safety checks, and optional semantic search.

**Architecture:** Add focused TypeScript modules with deterministic local behavior first, then expose them through `createToolHandlers` and the MCP server. LSP is represented by safe probe/config and normalized protocol shapes in this first slice; real long-lived language-server sessions can be added after the tool contracts are stable.

**Tech Stack:** TypeScript, Node.js stdlib, existing repo index and optimized command runner, Vitest, MCP SDK, optional local model hooks.

---

## Tasks

- [x] Add `project-contract.ts` and tests for package scripts, lockfiles, env hints, ports, and dependency inventory.
- [x] Add `diagnostics.ts` and tests for normalizing LSP/compiler/test/command diagnostics.
- [x] Add `impact-analysis.ts` and tests that combine git changed files, repo graph edges, and test-file heuristics.
- [x] Add `verification-runner.ts` and tests that select commands and run them through the optimized command runner.
- [x] Add `safety-scan.ts` and tests for secret pattern detection and operation-risk review.
- [x] Add `semantic-search.ts` and tests for deterministic fallback semantic indexing/search with optional future embedding provider.
- [x] Add `lsp-ground-truth.ts` and tests for language-server discovery/probe/config plus normalized request result shapes.
- [x] Wire tools into `src/tools.ts`, `src/mcp-server.ts`, `src/index.ts`, capability metadata, plugin manifests, and README.
- [x] Run full verification: `npm test`, `npm run typecheck`, `npm run build`, `npm run benchmarks:validate`, `npx --yes @anthropic-ai/mcpb validate plugins\wormhole-claude-desktop`, `git diff --check`.
