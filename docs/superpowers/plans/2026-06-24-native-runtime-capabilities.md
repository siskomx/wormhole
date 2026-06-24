# Native Runtime Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Wormhole's context, optimization, graph, printed-tool, and model-profile capabilities native executable runtime features, not only capability declarations or adapter notes.

**Architecture:** Add focused TypeScript modules with deterministic behavior and MCP tool-handler wiring. The first batch implements runtime primitives: context records/packs, reversible compression retrieval, graph provenance/reporting, printed-tool CLI execution/verification/evidence capture, and model-profile routing traces. External factory parity, learned Fugu-style orchestration, and multimodal Graphify parity remain future work.

**Tech Stack:** TypeScript, Vitest, Node.js `child_process`, existing MCP server/tool-handler patterns.

---

### Task 1: Context Records And Packs

**Files:**
- Create: `src/context-store.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/context-store.test.ts`
- Test: `tests/tools.test.ts`

- [ ] Add failing tests for `ctxRecord`, `ctxPackCreate`, `ctxPackQuery`, and `ctxPackRender`.
- [ ] Implement a deterministic in-memory context store with SHA-256 content IDs, source metadata, ranking, and budgeted pack rendering.
- [ ] Wire MCP tools: `ctx_record`, `ctx_pack_create`, `ctx_pack_query`, `ctx_pack_render`.
- [ ] Run targeted tests for context behavior.

### Task 2: Reversible Optimization Pipeline

**Files:**
- Modify: `src/optimization.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/optimization.test.ts`
- Test: `tests/workflow-optimization.test.ts`

- [ ] Add failing tests for retrieval IDs, exact original retrieval, JSON/log/diff routing, and budget stats.
- [ ] Extend optimization results with retrieval handles and transform traces.
- [ ] Add direct retrieval through a tool-handler store.
- [ ] Wire MCP tools: `optimization_apply`, `optimization_retrieve`.
- [ ] Run targeted optimization tests.

### Task 3: Graph Provenance And Reports

**Files:**
- Modify: `src/repo-index.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/repo-index.test.ts`
- Test: `tests/tools.test.ts`

- [ ] Add failing tests for edge provenance/confidence and graph report summaries.
- [ ] Add explicit provenance to edges: `extracted`, `inferred`, or `ambiguous`, with deterministic confidence.
- [ ] Add a graph report generator derived from the native repo index.
- [ ] Wire MCP tool: `repo_index_report`.
- [ ] Run targeted graph tests.

### Task 4: Printed-Tool Runtime

**Files:**
- Modify: `src/printing-press.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/printing-press.test.ts`
- Test: `tests/tools.test.ts`

- [ ] Add failing tests for structural verification, CLI execution, timeout handling, output capture, and evidence bundle hashing.
- [ ] Implement native printed-tool verification and CLI execution with deterministic result records.
- [ ] Wire MCP tools: `printing_press_verify`, `printing_press_run`.
- [ ] Keep CLI generation/factory parity out of this batch.
- [ ] Run targeted printed-tool tests.

### Task 5: Model-Profile Learning Traces

**Files:**
- Create: `src/model-profile.ts`
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/model-profile.test.ts`
- Test: `tests/tools.test.ts`

- [ ] Add failing tests for deterministic profile selection, outcome recording, provider denylist behavior, and trace export.
- [ ] Implement small-model profile registration, route scoring, outcome updates, and replayable trace export.
- [ ] Wire MCP tools: `model_profile_register`, `model_profile_select`, `model_profile_record_outcome`, `model_profile_export_traces`.
- [ ] Keep learned RL orchestration out of this batch.
- [ ] Run targeted model-profile tests.

### Task 6: Docs, Manifest, Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/orchestration-adaptive-capabilities.md`
- Modify: `docs/contracts/capability-manifest.md`
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
- Modify: `src/capabilities.ts`
- Test: `tests/capabilities.test.ts`
- Test: `tests/plugin.test.ts`

- [ ] Update public docs to say native runtime exists for the first batch and generation/learned orchestration remain future.
- [ ] Update plugin tool lists.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run benchmarks:validate`, and MCPB validation.
- [ ] Commit and push after verification.
