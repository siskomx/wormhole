# Orchestration Policy Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen Wormhole's RL and reasoning research layer so orchestration policy learning covers task splitting, context budget, evidence mode, verifier depth, and reasoning trace quality while browser automation remains an external/complementary input source.

**Architecture:** TypeScript remains authoritative for runtime schemas, policy activation gates, conductor integration, and MCP tools. Python remains optional for deterministic offline training/evaluation jobs that mirror TypeScript reward and action safety rules. Learned policies are advisory only and cannot bypass evidence gates, depth limits, budgets, or approval rules.

**Tech Stack:** TypeScript, Vitest, Python standard library sidecar jobs, MCP server schemas with Zod.

---

## File Structure

- Modify: `src/orchestration-learning.ts`
  - Expand policy actions with split strategy, context budget, evidence mode, and stop rule.
  - Add deterministic baseline comparison against safe fixed policies.
  - Add reason-aware reward support without breaking existing traces.
- Create: `src/reasoning-research.ts`
  - Own structured reasoning trace schema, scoring, strategy summaries, and store/export helpers.
- Modify: `python/wormhole_sidecar/policy_train.py`
  - Mirror expanded action keys and reason-aware reward.
  - Add baseline comparison output for offline research.
- Modify: `python/wormhole_sidecar/runner.py`
  - Register any new sidecar job names needed for policy-lab evaluation.
- Modify: `src/python-sidecar.ts`
  - Allow new policy-lab sidecar jobs.
- Modify: `src/tools.ts`
  - Add policy baseline comparison and reasoning research handlers.
  - Keep active learned policy injected internally into conductor plans.
- Modify: `src/mcp-server.ts`
  - Register new MCP tools and schemas.
- Modify: `src/capabilities.ts`
  - Declare implemented reasoning-policy-lab capability.
- Modify: `README.md`, `docs/contracts/capability-manifest.md`, `docs/architecture/orchestration-adaptive-capabilities.md`
  - Document the RL/reasoning focus and browser-as-complement boundary.
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
  - Expose the new tools to Claude Desktop and update prompt guidance.
- Tests:
  - Modify: `tests/orchestration-learning.test.ts`
  - Add: `tests/reasoning-research.test.ts`
  - Modify: `tests/python-policy-train.test.ts`
  - Modify: `tests/tools.test.ts`
  - Modify: `tests/mcp-server.test.ts`
  - Modify: `tests/capabilities.test.ts`
  - Modify: `tests/plugin.test.ts`

---

## Task 1: Expand Policy Actions and Baseline Comparison

**Files:**
- Modify: `src/orchestration-learning.ts`
- Modify: `tests/orchestration-learning.test.ts`

- [ ] **Step 1: Write failing tests for expanded safe actions**

Add tests that expect `clampPolicyAction` to preserve safe orchestration research decisions and clamp unsafe values:

```ts
it("clamps expanded orchestration policy actions to safe research decisions", () => {
  expect(clampPolicyAction({
    workerCount: 8,
    verifierCount: 9,
    maxDepth: 99,
    modelProfile: "untrusted",
    splitStrategy: "chaos",
    contextBudget: "everything",
    evidenceMode: "none",
    stopRule: "ignore",
  })).toEqual({
    workerCount: 6,
    verifierCount: 2,
    maxDepth: 4,
    modelProfile: "balanced",
    splitStrategy: "single",
    contextBudget: "medium",
    evidenceMode: "standard",
    stopRule: "verify",
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/orchestration-learning.test.ts`

Expected: TypeScript/Vitest fails because the new action fields and expectations are not implemented.

- [ ] **Step 3: Implement expanded action schema**

Update `PolicyAction`, `clampPolicyAction`, action key parsing, and safe action validation to support:

```ts
export type PolicyAction = {
  workerCount: number;
  verifierCount: number;
  maxDepth: number;
  modelProfile: string;
  splitStrategy?: "single" | "parallel" | "sequential";
  contextBudget?: "small" | "medium" | "large";
  evidenceMode?: "minimal" | "standard" | "strict";
  stopRule?: "continue" | "verify" | "escalate";
};
```

Default values are `single`, `medium`, `standard`, and `verify`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/orchestration-learning.test.ts`

Expected: the expanded action test passes and existing policy tests remain green.

- [ ] **Step 5: Write failing baseline comparison tests**

Add tests for `comparePolicyToBaselines(policyJson)` on a populated store. It should return baselines named `single-balanced`, `parallel-verify`, and `strict-deep`, and include candidate replay metrics.

- [ ] **Step 6: Run the focused test and verify RED**

Run: `npm test -- tests/orchestration-learning.test.ts`

Expected: fails because baseline comparison is not implemented.

- [ ] **Step 7: Implement deterministic baseline comparison**

Add `comparePolicyToBaselines(policyJson)` to the policy store. It evaluates the candidate plus three fixed safe policies over stored traces using the same replay logic.

- [ ] **Step 8: Verify GREEN**

Run: `npm test -- tests/orchestration-learning.test.ts`

Expected: all orchestration-learning tests pass.

---

## Task 2: Add Reasoning Research Trace Store

**Files:**
- Create: `src/reasoning-research.ts`
- Add: `tests/reasoning-research.test.ts`

- [ ] **Step 1: Write failing tests for reasoning scoring**

Create tests that record plan/critique/revision/verifier traces and expect evidence coverage, critique use, revision improvement, verifier strictness, and outcome labels to produce a bounded score.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/reasoning-research.test.ts`

Expected: fails because `src/reasoning-research.ts` does not exist.

- [ ] **Step 3: Implement reasoning research module**

Create:

```ts
export type ReasoningStrategy = "plan-first" | "critique-revise" | "verify-repair";
export type ReasoningTrace = {
  traceId: string;
  strategy: ReasoningStrategy;
  taskKind: string;
  planSummary: string;
  critiqueSummary?: string;
  revisionSummary?: string;
  verifierSummary?: string;
  evidenceReferenced: number;
  evidenceAvailable: number;
  openQuestionsResolved: number;
  openQuestionsRemaining: number;
  outcome: "succeeded" | "partial" | "failed";
  userCorrections: number;
};
```

Export `scoreReasoningTrace(trace)` and `createReasoningResearchStore()`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/reasoning-research.test.ts`

Expected: reasoning score and store/export tests pass.

- [ ] **Step 5: Add strategy evaluation tests**

Expect `evaluateStrategies()` to group traces by strategy, sort by average score descending, and recommend the best strategy only when at least two samples exist.

- [ ] **Step 6: Implement strategy evaluation**

Return strategy summaries with `strategy`, `sampleCount`, `averageScore`, `successRate`, and `recommended`.

- [ ] **Step 7: Verify GREEN**

Run: `npm test -- tests/reasoning-research.test.ts`

Expected: all reasoning research tests pass.

---

## Task 3: Mirror Policy Lab in Python Sidecar

**Files:**
- Modify: `python/wormhole_sidecar/policy_train.py`
- Modify: `python/wormhole_sidecar/runner.py`
- Modify: `src/python-sidecar.ts`
- Modify: `tests/python-policy-train.test.ts`

- [ ] **Step 1: Write failing Python policy tests**

Add tests that expect trained q-table action keys to include `split`, `context`, `evidence`, and `stop`, and expect a new `compare_policy_baselines(payload)` function to return three deterministic baselines.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/python-policy-train.test.ts`

Expected: fails because Python sidecar does not include expanded action keys or baseline comparison.

- [ ] **Step 3: Implement Python action key expansion and comparison**

Mirror the TypeScript defaults and safe value sets. Add `compare_policy_baselines(payload)` with candidate metrics and the same three baselines.

- [ ] **Step 4: Register sidecar job**

Allow `policy_compare_baselines` in `python/wormhole_sidecar/runner.py` and `src/python-sidecar.ts`.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/python-policy-train.test.ts`

Expected: Python policy trainer tests pass.

---

## Task 4: Wire Tools and MCP Schemas

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Modify: `tests/tools.test.ts`
- Modify: `tests/mcp-server.test.ts`

- [ ] **Step 1: Write failing tool tests**

Add tests for:
- `orchestrationPolicyCompareBaselines`
- `reasoningTraceRecord`
- `reasoningDatasetExport`
- `reasoningStrategyEvaluate`

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/tools.test.ts tests/mcp-server.test.ts`

Expected: fails because handlers and MCP registrations are missing.

- [ ] **Step 3: Implement tool handlers**

Create one reasoning store inside `createToolHandlers`. Add handlers that call policy comparison and reasoning store methods.

- [ ] **Step 4: Register MCP schemas**

Expose:
- `orchestration_policy_compare_baselines`
- `reasoning_trace_record`
- `reasoning_dataset_export`
- `reasoning_strategy_evaluate`

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/tools.test.ts tests/mcp-server.test.ts`

Expected: tool and MCP tests pass.

---

## Task 5: Capabilities, Plugin, and Documentation

**Files:**
- Modify: `src/capabilities.ts`
- Modify: `tests/capabilities.test.ts`
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
- Modify: `tests/plugin.test.ts`
- Modify: `README.md`
- Modify: `docs/contracts/capability-manifest.md`
- Modify: `docs/architecture/orchestration-adaptive-capabilities.md`

- [ ] **Step 1: Write failing capability/plugin tests**

Expect implemented capability `adaptive.orchestration-policy-lab` and the new tool names in the Claude Desktop manifest.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/capabilities.test.ts tests/plugin.test.ts`

Expected: fails because docs/plugin/capability metadata are not updated.

- [ ] **Step 3: Update metadata and docs**

Document:
- Wormhole's RL focus is offline, replay-gated orchestration policy research.
- Reasoning research traces evaluate plan/critique/revision/verifier strategies.
- Browser automation remains complementary, not the core runtime.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/capabilities.test.ts tests/plugin.test.ts`

Expected: metadata tests pass.

---

## Task 6: Full Verification and Commit

**Files:**
- All files modified above.

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run benchmarks:validate
npx --yes @anthropic-ai/mcpb validate plugins/wormhole-claude-desktop
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Review diff**

Run:

```powershell
git status --short
git diff --stat
```

Expected: only files from this plan are changed.

- [ ] **Step 3: Commit and push**

Run:

```powershell
git add docs/superpowers/plans/2026-06-25-orchestration-policy-lab.md src tests python docs README.md plugins
git commit -m "feat: add orchestration policy lab"
git push origin IQx/near-equivalent-runtime-suite
```

Expected: commit succeeds and branch pushes to origin.

---

## Self-Review

- Spec coverage: The plan covers deeper RL policy actions, baseline comparison, reasoning research traces, Python sidecar mirroring, MCP tools, docs, plugin metadata, and final verification.
- Placeholder scan: No TBD/TODO/future-only implementation placeholders are present.
- Type consistency: The expanded `PolicyAction` fields are consistent across TypeScript, Python, tools, MCP schemas, and tests.
