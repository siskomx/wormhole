# Project Index Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Wormhole project intelligence scale by reusing project models within sessions, adding a durable index manifest, and supporting root-sharded JSON indexes with lane metadata.

**Architecture:** Add a session `ProjectModelCache` that owns repo index, project contract, and ownership reuse for project-intelligence/routing/verification paths. Add a durable manifest that records full and lane-specific index metadata, then write/read root shard JSON files with lane metadata for query fan-out without forcing one large enterprise index into every operation.

**Tech Stack:** TypeScript, Vitest, existing Wormhole MCP tool registry, JSON durable state files.

---

### Task 1: Session Project-Model Cache

**Files:**
- Modify: `src/project-intelligence.ts`
- Modify: `src/agent-routing.ts`
- Modify: `src/impact-analysis.ts`
- Modify: `src/test-impact-v2.ts`
- Modify: `src/tools.ts`
- Test: `tests/project-model-cache.test.ts`

- [x] **Step 1: Write failing cache tests**

Add tests that create one injected cache and assert repeated architecture, entrypoint, context, route, and verification planning calls reuse a single repo index build.

- [x] **Step 2: Implement `ProjectModelCache`**

Export `createProjectModelCache`, `ProjectModelCache`, and `ProjectModel` from `src/project-intelligence.ts`. The cache must support injected `indexBuilder`, `maxEntries`, `freshnessTtlMs`, `stats()`, `clear()`, and `delete(repoRoot)`.

- [x] **Step 3: Thread cache through project intelligence and routing**

Accept optional `projectModelCache` on project-intelligence and routing inputs. `prepareAgentContext` must create or reuse one cache and pass it through snapshot, route, and context pack generation.

- [x] **Step 4: Thread repo index reuse through impact analysis**

Allow `analyzeImpact` and `analyzeTestImpactV2` to accept a prebuilt `RepoIndex`. `testPlanSelect` should use the handler cache so focused verification does not rebuild the index when a cached model is available.

- [x] **Step 5: Verify**

Run `npx vitest run tests/project-model-cache.test.ts tests/agent-routing.test.ts tests/project-intelligence-spine.test.ts tests/project-onboarding-tools.test.ts`.

### Task 2: Durable Master Index Manifest

**Files:**
- Modify: `src/durable-index-store.ts`
- Modify: `src/index.ts`
- Test: `tests/durable-index-manifest.test.ts`

- [x] **Step 1: Write failing manifest tests**

Add tests that refresh a repo with runtime, tests, and docs files, then assert `.wormhole/indexes/index-manifest.json` records lane entries with index IDs, paths, fingerprints, counts, byte totals, freshness, and full index metadata.

- [x] **Step 2: Implement manifest refresh and status**

Add `refreshDurableIndexManifest`, `durableIndexManifestStatus`, and manifest/shard path helpers. The refresh should build the repo index once, write the existing full durable index, write lane summaries, write root shard indexes, and write the manifest.

- [x] **Step 3: Preserve compatibility**

Keep `refreshDurableRepoIndex` and `durableIndexStatus` behavior unchanged. New APIs add capability without changing existing callers.

- [x] **Step 4: Verify**

Run `npx vitest run tests/durable-index-manifest.test.ts tests/project-intelligence-tools.test.ts tests/repo-activity-tools.test.ts`.

### Task 3: JSON Sharded Query Fan-Out

**Files:**
- Modify: `src/durable-index-store.ts`
- Modify: `src/mcp-server.ts`
- Modify: `src/tool-registry.ts`
- Modify: `src/tools.ts`
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
- Test: `tests/durable-index-manifest.test.ts`
- Test: `tests/mcp-server.test.ts`
- Test: `tests/tool-registry.test.ts`
- Test: `tests/plugin.test.ts`

- [x] **Step 1: Write failing sharded-query and MCP tests**

Assert `queryDurableShardedRepoIndex` can query selected lanes from root shard files and that MCP exposes `durable_index_manifest_refresh`, `durable_index_manifest_status`, and `durable_repo_index_query`.

- [x] **Step 2: Implement fan-out query**

Read the manifest, load selected shard indexes, run existing `queryRepoIndex`, merge and score-sort results, and fall back to the full durable repo index if no manifest exists.

- [x] **Step 3: Register MCP tools**

Add handlers, schemas, registry metadata, layered/guided discovery, and Claude manifest entries for manifest refresh/status and durable sharded query.

- [x] **Step 4: Verify**

Run `npx vitest run tests/durable-index-manifest.test.ts tests/mcp-server.test.ts tests/tool-registry.test.ts tests/plugin.test.ts`.

### Task 4: Full Verification And Dogfood

**Files:**
- No new production files expected beyond Tasks 1-3.

- [x] **Step 1: Run static and unit verification**

Run `npm run typecheck` and `npm test`.

- [x] **Step 2: Run Wormhole-on-Wormhole timing dogfood**

Run a temporary `tsx` script that calls `agentContextPrepare` twice through one handler and reports timing plus `projectModelCacheStats`.

- [x] **Step 3: Commit and push**

Commit with `feat: add scalable project index cache and shards`, push `IQx/project-index-scale`, and report verification.
