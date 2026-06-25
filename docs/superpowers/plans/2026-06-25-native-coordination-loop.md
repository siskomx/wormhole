# Native Coordination Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Wormhole coordination tools for context-pack budget management, LSP-triggered mission replanning, shared concurrent-agent workspace memory, and safe live policy feedback.

**Architecture:** Keep policy learning offline and activation-gated, but add live trace intake as advisory feedback. Add focused pure modules for context budget review and agent workspace memory, wire them through the existing persisted runtime state in `src/tools.ts`, and compose existing diagnostics plus `mission_delta_replan` for LSP feedback.

**Tech Stack:** TypeScript, Vitest, Zod MCP schemas, existing Wormhole runtime-state persistence, existing diagnostic and mission-delta modules.

---

### Task 1: Context Pack Budget Review

**Files:**
- Modify: `src/context-store.ts`
- Test: `tests/context-store.test.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`

- [ ] Add failing tests for `reviewPackBudget` and `refreshPack`.
- [ ] Implement deterministic retained/evicted decisions using pinned context ids, changed-file relevance, stale source ids, LRU timestamps, score, and budget.
- [ ] Wire handlers `ctxPackBudgetReview` and `ctxPackRefresh`.
- [ ] Register MCP tools `ctx_pack_budget_review` and `ctx_pack_refresh`.

### Task 2: LSP Feedback Replan

**Files:**
- Modify: `tests/mission-delta-tools.test.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`

- [ ] Add a failing handler test for `lspFeedbackReplan`.
- [ ] Normalize LSP diagnostics, persist them in the diagnostic store, infer changed files from diagnostic file paths, and call `createMissionDeltaReplan`.
- [ ] Register MCP tool `lsp_feedback_replan`.

### Task 3: Agent Workspace Memory

**Files:**
- Create: `src/agent-workspace.ts`
- Create: `tests/agent-workspace.test.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Modify: `tests/mcp-server.test.ts`

- [ ] Add failing tests for workspace create, write, read, merge, conflict detection, and snapshot restore.
- [ ] Implement typed shared records with `workspaceId`, `missionId`, `runId`, `key`, `value`, `contentHash`, timestamps, visibility, and provenance.
- [ ] Wire `agentWorkspaceCreate`, `agentWorkspaceWrite`, `agentWorkspaceRead`, and `agentWorkspaceMerge`.
- [ ] Register MCP tools `agent_workspace_create`, `agent_workspace_write`, `agent_workspace_read`, and `agent_workspace_merge`.

### Task 4: Safe Live Policy Feedback

**Files:**
- Modify: `src/orchestration-learning.ts`
- Modify: `tests/orchestration-learning.test.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`

- [ ] Add failing tests for live feedback producing bounded advisory hints without activating policies.
- [ ] Implement `recordLivePolicyFeedback` on the policy store using existing reward and clamp logic.
- [ ] Wire handler `orchestrationPolicyLiveFeedback`.
- [ ] Register MCP tool `orchestration_policy_live_feedback`.

### Task 5: Docs, Capabilities, Plugins, Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/orchestration-adaptive-capabilities.md`
- Modify: `docs/contracts/capability-manifest.md`
- Modify: `src/capabilities.ts`
- Modify: `plugins/wormhole/.codex-plugin/plugin.json`
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
- Modify: `tests/capabilities.test.ts`
- Modify: `tests/plugin.test.ts`

- [ ] Add capability IDs for native context eviction, LSP feedback replanning, agent workspace memory, and safe live policy feedback.
- [ ] Document the new tools in the current surface and architecture docs.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run benchmarks:validate`, `git diff --check`.
- [ ] Commit with `feat: add native coordination loop`.
- [ ] Push `main` to `origin/main`.
