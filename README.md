# Wormhole

Wormhole is an evidence-aware planning state server for AI coding agents.

V1 is intentionally small: a local Claude Code MCP server for existing-repo planning with a JSONL event log, evidence records, an open-question ledger, a batch gate, and one evidence-cited Markdown plan artifact.

The repository also includes the v2/v3 contract: four-layer orchestration, Codex plugin metadata, connector boundaries, optimization-provider slots, and adaptive routing direction.

## Current Surface

- V1 runnable MCP kernel: `src/cli.ts`
- V1 tool surface: `mission_start`, `round_start`, `record_evidence`, `record_question`, `update_question`, `gate_request`, `emit_plan`, `mission_status`
- JSONL state: `.wormhole/events.jsonl` in the working directory
- Benchmark fixtures: `benchmarks/fixtures` and `benchmarks/repos`
- Codex plugin scaffold: `plugins/wormhole`
- Capability manifest: `src/capabilities.ts`

## Local Commands

```bash
npm install
npm test
npm run typecheck
npm run build
npm run benchmarks:validate
```

## Claude Code

Build first, then attach Claude Code to the MCP server command:

```bash
node dist/src/cli.js
```

## Codex

The repo-local plugin metadata is in `plugins/wormhole/.codex-plugin/plugin.json`.

The plugin MCP config points to `../../dist/src/cli.js` from `plugins/wormhole`, so run `npm run build` before local plugin testing.

## Planning Docs

- Canonical plan: [docs/planning/wormhole-canonical-plan.md](docs/planning/wormhole-canonical-plan.md)
- V2/V3 architecture: [docs/architecture/v2-v3-orchestration.md](docs/architecture/v2-v3-orchestration.md)
- Capability contract: [docs/contracts/capability-manifest.md](docs/contracts/capability-manifest.md)
