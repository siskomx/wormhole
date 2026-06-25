# Native Project Intelligence Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Wormhole's native project-intelligence spine with architecture mapping, entrypoint flow discovery, blast-radius analysis, and task context-pack generation.

**Architecture:** Add a focused `src/project-intelligence.ts` module that composes the existing repo index, project contract, diagnostics, and test-impact primitives into typed project observations. Wire the module through `createToolHandlers`, MCP schemas, exports, capability metadata, plugin manifests, and docs while keeping repo-root confinement in `src/tools.ts`.

**Tech Stack:** TypeScript, Node.js stdlib, existing Wormhole repo index/project contract/test-impact/context-store primitives, Vitest, MCP SDK Zod schemas.

---

## Tasks

- [ ] Add failing module tests in `tests/project-intelligence-spine.test.ts` for `createArchitectureMap`, `discoverEntrypointFlows`, `analyzeBlastRadius`, and `generateProjectContextPack`.
- [ ] Implement `src/project-intelligence.ts` with typed outputs, source-backed provenance, confidence values, and deterministic local behavior.
- [ ] Add handler tests proving `createToolHandlers` exposes `architectureMap`, `entrypointFlowDiscover`, `blastRadiusAnalyze`, and `contextPackGenerate`.
- [ ] Wire MCP tools in `src/mcp-server.ts` with explicit Zod schemas and update the MCP registration test.
- [ ] Export the module from `src/index.ts`.
- [ ] Update `src/capabilities.ts`, `README.md`, `docs/contracts/capability-manifest.md`, `docs/architecture/orchestration-adaptive-capabilities.md`, and plugin manifests.
- [ ] Run focused tests, then `npm test`, `npm run typecheck`, `npm run build`, and `npm run benchmarks:validate`.
