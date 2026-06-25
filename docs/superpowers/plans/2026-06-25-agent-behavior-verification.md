# Agent Behavior Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Wormhole tools that define an agent remit, inventory actual capabilities, verify declared intent against observed capability/behavior, analyze drift, and render deterministic findings.

**Architecture:** Add a pure `src/agent-behavior-verification.ts` module with schema-shaped TypeScript types and deterministic analysis helpers. Wire those helpers into `src/tools.ts` and `src/mcp-server.ts`, then document the new tools in README and the capability manifest.

**Tech Stack:** TypeScript, Vitest, Zod MCP schemas, existing Wormhole runtime state and repo-root safety patterns.

---

### Task 1: Core Remit And Verification Model

**Files:**
- Create: `src/agent-behavior-verification.ts`
- Test: `tests/agent-behavior-verification.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests that call wished-for APIs: `createAgentRemit`, `inventoryAgentCapabilities`, `verifyAgentBehavior`, `analyzeAgentDrift`, and `renderBehaviorFindings`. The tests should assert rule coverage statuses, capability drift, approval gaps, compound risk, drift findings, positives, and deterministic Markdown.

- [ ] **Step 2: Verify red**

Run `npx vitest run tests/agent-behavior-verification.test.ts`. Expected failure: module or exported functions do not exist.

- [ ] **Step 3: Implement minimal core**

Implement deterministic helpers with no filesystem access and no LLM calls. Keep findings redacted by construction: evidence snippets describe locations and observed patterns, not secret values.

- [ ] **Step 4: Verify green**

Run `npx vitest run tests/agent-behavior-verification.test.ts`. Expected: all tests pass.

### Task 2: Tool Handlers

**Files:**
- Modify: `src/tools.ts`
- Test: `tests/agent-behavior-tools.test.ts`

- [ ] **Step 1: Write failing handler tests**

Create handler tests for `agent_remit_create`, `agent_capability_inventory`, `agent_behavior_verify`, `remit_coverage_report`, `agent_drift_analyze`, and `behavior_findings_render`.

- [ ] **Step 2: Verify red**

Run `npx vitest run tests/agent-behavior-tools.test.ts`. Expected failure: handler methods do not exist.

- [ ] **Step 3: Wire handlers**

Import the core module in `src/tools.ts` and expose the six handler methods. Use `resolveAllowedRepoRoot` for any handler accepting `repoRoot`.

- [ ] **Step 4: Verify green**

Run `npx vitest run tests/agent-behavior-tools.test.ts`. Expected: all tests pass.

### Task 3: MCP Surface

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `tests/mcp-server.test.ts`

- [ ] **Step 1: Write failing MCP exposure test**

Extend the MCP server test to assert all six new tool names are registered.

- [ ] **Step 2: Verify red**

Run `npx vitest run tests/mcp-server.test.ts`. Expected failure: missing tool names.

- [ ] **Step 3: Register MCP tools**

Add Zod schemas and `server.registerTool` calls for each behavior-verification handler.

- [ ] **Step 4: Verify green**

Run `npx vitest run tests/mcp-server.test.ts`. Expected: all tests pass.

### Task 4: Docs And Capability Metadata

**Files:**
- Modify: `README.md`
- Modify: `src/capabilities.ts`
- Modify: `docs/contracts/capability-manifest.md`
- Test: existing docs/capability tests if applicable

- [ ] **Step 1: Add assertions where tests already cover capability metadata**

If no focused metadata test exists, update docs only and rely on typecheck/build.

- [ ] **Step 2: Document the new native layer**

Add the behavior-verification tools to Current Surface, Near-Equivalent Runtime Suite, and capability manifest.

- [ ] **Step 3: Verify full repo**

Run `npm test`, `npm run typecheck`, `npm run build`, `npm run benchmarks:validate`, and `git diff --check`.

### Task 5: Commit And Push

**Files:**
- All changed files

- [ ] **Step 1: Inspect final diff**

Run `git status --short` and `git diff --stat`.

- [ ] **Step 2: Commit**

Commit with `feat: add native agent behavior verification`.

- [ ] **Step 3: Push to origin/main**

Push the commit to `origin/main` as requested.
