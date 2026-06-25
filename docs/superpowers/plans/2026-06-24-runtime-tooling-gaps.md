# Runtime Tooling Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close code-backed Wormhole runtime gaps that limit AI coding-agent tooling usefulness.

**Architecture:** Add small modules for durable state and transport execution, then integrate them through existing handlers. Keep browser capture untouched. Preserve the existing MCP tool surface unless a new helper tool is required.

**Tech Stack:** TypeScript, Node.js stdlib, Vitest, existing Python sidecar.

---

## Tasks

- [x] Add `src/runtime-state.ts` with JSON persistence and tests.
- [x] Persist handler-owned registries/stores through snapshots.
- [x] Extend `repo-index.ts` with Python extraction and basic call-reference edges.
- [x] Extend `tool-factory.ts` with safe write/validate helpers and handler methods.
- [x] Add CLI/HTTP external agent transport execution with evidence hashes.
- [x] Persist orchestration policy activation and feed conductor plans across handler recreation.
- [x] Harden media dependency reporting tests.
- [x] Run full verification: `npm test`, `npm run typecheck`, `npm run build`, `npm run benchmarks:validate`.
