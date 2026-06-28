# Inspiration

Wormhole is inspired by several existing ideas in developer tooling and agent operations. This file records the influences so the project direction stays legible. Inspiration here does not imply dependency, endorsement, or compatibility beyond what the code explicitly implements.

## Protocol And Tool Surfaces

- [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro): Wormhole uses MCP as the runtime shape for exposing repo tools, workflow gates, and agent-facing context.
- [Language Server Protocol and LSIF](https://microsoft.github.io/language-server-protocol/): Wormhole borrows the idea that language and repo intelligence should be available through stable protocol boundaries rather than editor-specific integrations.

## Agent Workflows

- [OpenAI Codex](https://developers.openai.com/codex/cloud): Wormhole is shaped by the delegated coding-agent workflow: read code, make bounded edits, run verification, and preserve enough context for review or continuation.
- [Claude Code](https://github.com/anthropics/claude-code): Wormhole takes inspiration from terminal-native coding agents that understand a repo, execute routine development steps, and integrate with git workflows.

## Project Influences

- [RTK](https://github.com/rtk-ai/rtk): inspires command-output compaction before logs and command results enter model context. Wormhole maps this to `optimized_command_run`, `optimization_apply`, and reversible retrieval handles.
- [Headroom](https://github.com/headroomlabs-ai/headroom): inspires compression of tool outputs, logs, files, and context chunks. Wormhole maps this to context-pack budgeting, context refresh, and source-backed optimized views.
- [Caveman](https://github.com/JuliusBrussee/caveman): inspires dense response profiles that reduce conversational overhead while keeping technical meaning intact. Wormhole maps this to dense summaries and behavior/minimality modes.
- [Ponytail](https://github.com/DietrichGebert/ponytail): inspires a minimality review posture that asks whether code or scope can be smaller before building more. Wormhole maps this to minimality review and planning guardrails.
- [Graphify](https://graphify.net/): inspires graph-first codebase understanding over broad search. Wormhole maps this to deterministic repo indexes, graph exports, graph reports, durable SQLite indexes, and future Graphify-compatible connectors.
- [Printing Press](https://printingpress.dev/): inspires agent-native CLIs and MCP servers generated for low-token, task-oriented tool use. Wormhole maps this to `printing_press_*` registration, verification, execution, evidence capture, and worker conversion.
- [Sakana Fugu](https://sakana.ai/fugu/): inspires model-pool orchestration and multi-agent routing as a long-term direction. Wormhole keeps this bounded through deterministic routing, model profiles, replayable traces, and evidence gates.

## Operating Principles

- Evidence-first planning: Wormhole treats current code, tests, migrations, package metadata, and generated indexes as stronger evidence than stale notes or broad assumptions.
- Freshness and conflict gates: generated artifacts should carry enough fingerprints or provenance to detect when they no longer match the repository.
- Durable local state: repo indexes, context packs, app-process state, and workflow artifacts should survive handoffs and make the next agent less dependent on memory.
- Thin wrappers over pure functions: MCP handlers should mostly validate, route, and persist. Core behavior should stay testable without an MCP server.
- Guided tool exposure: agents should start from route, context, and next-tool recommendations instead of browsing every available tool.

## What Wormhole Is Not

- It is not a replacement for coding agents.
- It is not an IDE.
- It is not a hosted orchestration service.
- It is not a claim that generated artifacts are authoritative by default.

The target is narrower: a local operating layer that helps coding agents use repo facts, evidence, state, and verification coherently.
