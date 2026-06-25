# Repo Activity Watch Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in native repo activity layer that watches file changes, detects git diffs, records activity, and refreshes the repo graph.

**Architecture:** Add a focused `repo-activity` runtime module that snapshots repo files, compares snapshots on scan, reads git status/diff through bounded `spawnSync`, and stores watch sessions plus activity events in existing runtime state. Expose MCP tools through `src/tools.ts` and `src/mcp-server.ts`, reusing durable repo indexes, test impact, mission evidence, and mission-delta replanning instead of creating a separate daemon.

**Tech Stack:** TypeScript, Node.js `fs`/`child_process`, existing Wormhole runtime state, durable repo index store, Vitest.

---

### Task 1: Repo Activity Core

**Files:**
- Create: `src/repo-activity.ts`
- Test: `tests/repo-activity.test.ts`

- [x] **Step 1: Write failing tests**

Cover:
- starting a watch session creates a baseline and ignores `.git`, `.wormhole`, `node_modules`, and build outputs by default.
- scanning after file edits reports `added`, `modified`, and `deleted` repo-relative paths.
- git status/diff snapshots report changed files and diff text when the repo is a git repo.
- manual activity records persist as structured events.

- [x] **Step 2: Implement minimal core**

Implement:
- `createRepoActivityStore(snapshot?, onChange?)`
- `repoWatchStart`
- `repoWatchScan`
- `repoWatchStatus`
- `repoWatchStop`
- `repoChangeScan`
- `repoActivityRecord`

### Task 2: Tool Integration

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/repo-activity-tools.test.ts`
- Test: `tests/mcp-server.test.ts`

- [x] **Step 1: Add failing tool tests**

Cover:
- `repo_watch_start` plus `repo_watch_scan` auto-records mission evidence when configured.
- `repo_graph_refresh_incremental` refreshes the durable repo graph and returns test-impact context.
- MCP registers all new tools.

- [x] **Step 2: Implement tool handlers and MCP schemas**

Add tools:
- `repo_watch_start`
- `repo_watch_scan`
- `repo_watch_status`
- `repo_watch_stop`
- `repo_change_scan`
- `repo_activity_record`
- `repo_graph_refresh_incremental`

### Task 3: Capability And Plugin Metadata

**Files:**
- Modify: `src/capabilities.ts`
- Modify: `README.md`
- Modify: `docs/contracts/capability-manifest.md`
- Modify: `docs/architecture/orchestration-adaptive-capabilities.md`
- Modify: `plugins/wormhole/.codex-plugin/plugin.json`
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
- Test: `tests/capabilities.test.ts`
- Test: `tests/plugin.test.ts`

- [x] **Step 1: Add failing metadata tests**

Require capability `orchestration.repo-activity-watch-layer` and plugin descriptions mentioning repo watch, git diff detection, activity recording, and graph refresh.

- [x] **Step 2: Update docs and manifests**

Describe the layer as opt-in and repo-confined. State that scanning records facts and refreshes graph state; it does not infer agent intent unless the user or agent records an activity note.

### Task 4: Verification

- [x] Run focused tests:

```bash
npm test -- tests/repo-activity.test.ts tests/repo-activity-tools.test.ts tests/mcp-server.test.ts tests/capabilities.test.ts tests/plugin.test.ts
```

- [x] Run full verification:

```bash
npm test
npm run typecheck
npm run build
npm run benchmarks:validate
git diff --check
```
