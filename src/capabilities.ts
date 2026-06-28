export type WormholeCapabilityArea = "core" | "orchestration" | "adaptive";

export type CapabilityStatus = "implemented" | "planned";

export type ConnectorTarget =
  | "generic-mcp"
  | "claude-code"
  | "claude-desktop"
  | "codex"
  | "printing-press"
  | "graphify"
  | "python-sidecar"
  | "hermes-agent"
  | "inflection-pi";

export type WormholeCapability = {
  id: string;
  area: WormholeCapabilityArea;
  status: CapabilityStatus;
  description: string;
};

export type WormholeConnector = {
  target: ConnectorTarget;
  status: CapabilityStatus;
  transport:
    | "mcp-stdio"
    | "plugin-manifest"
    | "mcpb"
    | "printing-press-cli"
    | "graph-index"
    | "agent-adapter"
    | "provider-api"
    | "connector-contract";
  description: string;
};

export type OrchestrationLayer = {
  level: 1 | 2 | 3 | 4;
  name: string;
  responsibility: string;
  maySpawn: boolean;
};

export type WormholeCapabilityManifest = {
  name: "wormhole";
  version: string;
  maxOrchestrationDepth: 4;
  layers: OrchestrationLayer[];
  connectors: WormholeConnector[];
  capabilities: WormholeCapability[];
};

export function createDefaultCapabilityManifest(): WormholeCapabilityManifest {
  return {
    name: "wormhole",
    version: "0.1.0",
    maxOrchestrationDepth: 4,
    layers: [
      {
        level: 1,
        name: "Sisko",
        responsibility: "Mission command, gate policy, and final artifact accountability.",
        maySpawn: true,
      },
      {
        level: 2,
        name: "Dax",
        responsibility: "Domain sub-orchestrators for repo, product, UX, risk, and verification planning.",
        maySpawn: true,
      },
      {
        level: 3,
        name: "Kira",
        responsibility: "Focused investigator or implementation coordinators with bounded context budgets.",
        maySpawn: true,
      },
      {
        level: 4,
        name: "Runabout",
        responsibility: "Tool workers that gather evidence, run commands, inspect files, or draft narrow artifacts.",
        maySpawn: false,
      },
    ],
    connectors: [
      {
        target: "generic-mcp",
        status: "implemented",
        transport: "mcp-stdio",
        description: "Local MCP server exposing the core evidence, question, gate, status, and plan tools.",
      },
      {
        target: "claude-code",
        status: "implemented",
        transport: "mcp-stdio",
        description: "Claude Code can attach to the Wormhole MCP server and drive the core workflow.",
      },
      {
        target: "claude-desktop",
        status: "implemented",
        transport: "mcpb",
        description: "Claude Desktop can install the Wormhole MCP server through the repo-local MCPB extension scaffold.",
      },
      {
        target: "codex",
        status: "implemented",
        transport: "plugin-manifest",
        description: "Codex can consume the repo-local plugin metadata and MCP server configuration.",
      },
      {
        target: "printing-press",
        status: "implemented",
        transport: "printing-press-cli",
        description: "Printing Press generated CLIs and MCP servers can be registered, verified, executed, captured, and converted into external agent workers.",
      },
      {
        target: "graphify",
        status: "implemented",
        transport: "graph-index",
        description: "Graphify-style repo graph workflows can be represented through Wormhole's native repo index tools or an external graph connector.",
      },
      {
        target: "python-sidecar",
        status: "implemented",
        transport: "connector-contract",
        description: "Required local Python runtime for deterministic graph metrics, graph communities, media extraction, model-profile trace analysis, and offline policy jobs.",
      },
      {
        target: "hermes-agent",
        status: "implemented",
        transport: "agent-adapter",
        description: "Hermes Agent can be represented as an external Wormhole worker through the generic agent adapter contract.",
      },
      {
        target: "inflection-pi",
        status: "implemented",
        transport: "provider-api",
        description: "Inflection Pi can be represented as a provider-style worker for planning and research tasks.",
      },
    ],
    capabilities: [
      {
        id: "core.evidence-gated-planning",
        area: "core",
        status: "implemented",
        description: "Append-only JSONL planning state, evidence records, question ledger, batch gate, and Markdown plan artifact.",
      },
      {
        id: "orchestration.parallel-sub-orchestrators",
        area: "orchestration",
        status: "implemented",
        description: "Four-layer task records plus deterministic DAG scheduling with dependency waves and read/write lock separation.",
      },
      {
        id: "orchestration.live-sub-orchestrator-control",
        area: "orchestration",
        status: "implemented",
        description: "Task registration, heartbeat/status reporting, mailbox messages, direction-change pause/ack, and immediate interrupts for active sub-orchestrators.",
      },
      {
        id: "orchestration.context-compression",
        area: "orchestration",
        status: "implemented",
        description: "Wormhole-native context records, budgeted context packs, command compaction, context compression, dense summaries, and minimality review primitives.",
      },
      {
        id: "orchestration.first-party-optimization-primitives",
        area: "orchestration",
        status: "implemented",
        description: "Deterministic local versions of RTK-style command compaction, Headroom-style context compression, Caveman-style dense summaries, and Ponytail-style minimality review.",
      },
      {
        id: "orchestration.native-context-packs",
        area: "orchestration",
        status: "implemented",
        description: "Durable native source-backed context records, ranked context queries, and budgeted context pack rendering with provenance.",
      },
      {
        id: "orchestration.context-pack-eviction",
        area: "orchestration",
        status: "implemented",
        description: "Deterministic context-pack budget review and refresh with pinned records, stale-record eviction, changed-file relevance, and explicit evicted-record reasons.",
      },
      {
        id: "orchestration.reversible-optimization-pipeline",
        area: "orchestration",
        status: "implemented",
        description: "Reversible optimization records with retrieval handles, transform traces, JSON/log routing, and token-budget stats.",
      },
      {
        id: "orchestration.external-optimization-adapters",
        area: "orchestration",
        status: "implemented",
        description: "Native, CLI, and HTTP optimization adapter registry with capability selection and bounded no-shell CLI execution while keeping Wormhole-native primitives as the baseline.",
      },
      {
        id: "orchestration.content-addressed-evidence-cache",
        area: "orchestration",
        status: "implemented",
        description: "SHA-256 addressed evidence cache for raw source content and replayable provenance handles.",
      },
      {
        id: "orchestration.reconciliation-engine",
        area: "orchestration",
        status: "implemented",
        description: "Artifact reconciliation with provenance merge and read/write conflict detection.",
      },
      {
        id: "orchestration.benchmark-runner",
        area: "orchestration",
        status: "implemented",
        description: "Benchmark comparison runner that captures unaided and Wormhole plans and emits anonymized review pairs.",
      },
      {
        id: "orchestration.codex-runtime-adapter",
        area: "orchestration",
        status: "implemented",
        description: "Codex adapter config generation and validation for local plugin/runtime attachment.",
      },
      {
        id: "orchestration.external-agent-adapters",
        area: "orchestration",
        status: "implemented",
        description: "Generic external agent registration, dispatch, CLI/HTTP execution, status, interrupt, and completion contracts for Hermes, Pi, and other workers.",
      },
      {
        id: "orchestration.printing-press-cli-adapters",
        area: "orchestration",
        status: "implemented",
        description: "Printing Press generated CLI registry, capability selection, structural verification, native execution, evidence capture, and conversion into Wormhole external agent workers.",
      },
      {
        id: "orchestration.printed-tool-runtime",
        area: "orchestration",
        status: "implemented",
        description: "Native printed-tool run records with stdout, stderr, exit code, timeout handling, and immutable evidence hashes.",
      },
      {
        id: "orchestration.repo-index-graph",
        area: "orchestration",
        status: "implemented",
        description: "Deterministic repo-local index with file, symbol, import, link, reference, provenance, confidence, SQLite-backed durable query, JSON compatibility exports, explain, report, and dependency-path tools.",
      },
      {
        id: "orchestration.project-ground-truth-suite",
        area: "orchestration",
        status: "implemented",
        description: "Project contract detection, dependency inventory, structured diagnostics, impact-aware test planning, verification execution, safety scanning, deterministic semantic fallback search, and safe LSP config probes.",
      },
      {
        id: "orchestration.project-intelligence-sequencing",
        area: "orchestration",
        status: "implemented",
        description: "One-shot project onboarding, process-local LSP sessions, SQLite-backed durable repo indexes, semantic indexes, diff-aware test impact, dependency security reports, action admission policy, and optimization adapter execution.",
      },
      {
        id: "orchestration.native-project-intelligence-spine",
        area: "orchestration",
        status: "implemented",
        description: "Native architecture maps, entrypoint flow discovery, blast-radius analysis, and task-scoped project context packs built from typed repo observations with provenance.",
      },
      {
        id: "orchestration.repo-native-coverage-pack",
        area: "orchestration",
        status: "implemented",
        description: "Read-only repo-native coverage packs and feature-slice queries over existing feature indexes, repo-local scripts, conventions, schema evidence, verification gates, source conflicts, and coverage gaps.",
      },
      {
        id: "orchestration.repo-blueprint-compiler",
        area: "orchestration",
        status: "implemented",
        description: "Existing-repo blueprint and constraints compiler that writes .wormhole agent context artifacts and gates package-manager and verification drift.",
      },
      {
        id: "orchestration.app-process-compiler",
        area: "orchestration",
        status: "implemented",
        description: "Provisional full-app process compiler that drafts discovery, product definition, roadmap, backlog, architecture, UX, security, and verification artifacts above the repo blueprint.",
      },
      {
        id: "orchestration.app-process-run-controller",
        area: "orchestration",
        status: "implemented",
        description: "Durable app-process status, section acceptance, one-step continuation, event log, and verification evidence records that feed completion gates.",
      },
      {
        id: "orchestration.native-agent-behavior-verification",
        area: "orchestration",
        status: "implemented",
        description: "Native remit creation, capability inventory, behavior verification, remit coverage, drift analysis, and deterministic findings rendering.",
      },
      {
        id: "orchestration.mission-delta-replanning",
        area: "orchestration",
        status: "implemented",
        description: "Automatic mid-mission re-scope reports from changed files, diagnostics, blast radius, stale evidence, focused tests, context packs, and gate guidance.",
      },
      {
        id: "orchestration.lsp-feedback-replanning",
        area: "orchestration",
        status: "implemented",
        description: "LSP diagnostic feedback loop that records structured diagnostics and feeds mission-delta replanning with repo-relative changed files.",
      },
      {
        id: "orchestration.agent-workspace-memory",
        area: "orchestration",
        status: "implemented",
        description: "Shared mission workspace memory for concurrent agent runs with attributed records, provenance, snapshot persistence, merge views, and conflict detection.",
      },
      {
        id: "orchestration.graph-artifact-suite",
        area: "orchestration",
        status: "implemented",
        description: "Native graph.json, GRAPH_REPORT.md, graph.html, graph metrics, and deterministic community analysis for repo graphs.",
      },
      {
        id: "orchestration.repo-activity-watch-layer",
        area: "orchestration",
        status: "implemented",
        description: "Opt-in repo watch sessions with file change scans, git diff detection, structured activity recording, mission evidence capture, and durable repo graph refresh.",
      },
      {
        id: "orchestration.patch-transactions",
        area: "orchestration",
        status: "implemented",
        description: "Repo-confined patch checkpoints, unified-diff application, transaction status, and captured before-content rollback for safer coding-agent edits.",
      },
      {
        id: "orchestration.optimized-command-runner",
        area: "orchestration",
        status: "implemented",
        description: "No-shell command execution with reversible output optimization, retrieval handles, hashes, and savings stats.",
      },
      {
        id: "orchestration.native-tool-factory",
        area: "orchestration",
        status: "implemented",
        description: "Deterministic generation, validation, and validated workspace writes of CLI/MCP scaffold files from constrained tool specs.",
      },
      {
        id: "orchestration.local-runner",
        area: "orchestration",
        status: "implemented",
        description: "Adapter-free local orchestration planning and deterministic execution over DAG waves, depth limits, task budgets, and spawned local tasks.",
      },
      {
        id: "adaptive.routing-model-selection",
        area: "adaptive",
        status: "implemented",
        description: "Deterministic fast/balanced/deep routing and model selection from provider capability manifests.",
      },
      {
        id: "adaptive.connector-registry",
        area: "adaptive",
        status: "implemented",
        description: "Connector registry and capability-based connector selection.",
      },
      {
        id: "adaptive.graph-first-codebase-query",
        area: "adaptive",
        status: "implemented",
        description: "Graph-first codebase query workflow that lets agents ask the repo index before broad grep or file-reading passes.",
      },
      {
        id: "adaptive.agent-facing-routing",
        area: "adaptive",
        status: "implemented",
        description: "Curated agent-facing routing tools that produce project-intelligence snapshots, next-tool recommendations, mission routes, and prepared context packs.",
      },
      {
        id: "adaptive.model-pool",
        area: "adaptive",
        status: "implemented",
        description: "Bounded model-pool orchestration with thinker, worker, and verifier roles plus deterministic routing/model selection.",
      },
      {
        id: "adaptive.model-profile-learning",
        area: "adaptive",
        status: "implemented",
        description: "Native model-profile registration, deterministic selection, outcome recording, and replayable route trace export.",
      },
      {
        id: "adaptive.required-python-runtime",
        area: "adaptive",
        status: "implemented",
        description: "A required Python runtime from startup for deterministic graph metrics, graph communities, media extraction, trace summaries, and offline policy jobs while TypeScript remains the authoritative MCP control plane.",
      },
      {
        id: "adaptive.deterministic-conductor",
        area: "adaptive",
        status: "implemented",
        description: "Deterministic planner, worker, and verifier scaffolds with replayable conductor traces.",
      },
      {
        id: "adaptive.durable-behavior-policy",
        area: "adaptive",
        status: "implemented",
        description: "Durable brevity and minimality modes with dense output and minimality review primitives.",
      },
      {
        id: "adaptive.native-media-ingestion",
        area: "adaptive",
        status: "implemented",
        description: "Repo-confined PDF and image ingestion with byte hashes, required Python extraction, evidence-ready records, Python package dependency reporting, and OCR safety gates.",
      },
      {
        id: "adaptive.shell-hook-manager",
        area: "adaptive",
        status: "implemented",
        description: "Dry-run-first, marker-based shell hook discovery, install, verify, and uninstall for common terminals with backups and Cmd registry guards.",
      },
      {
        id: "adaptive.discovery-tool-generation",
        area: "adaptive",
        status: "implemented",
        description: "HAR, OpenAPI, bounded HTTP crawl, optional browser capture, endpoint normalization, redaction, and deterministic API tool-spec generation.",
      },
      {
        id: "adaptive.learned-orchestration-policy",
        area: "adaptive",
        status: "implemented",
        description: "Offline trace datasets, deterministic policy training/evaluation, replay thresholds, activation gates, and runtime action clamps for learned orchestration policy.",
      },
      {
        id: "adaptive.safe-live-policy-feedback",
        area: "adaptive",
        status: "implemented",
        description: "Live orchestration outcome feedback that records traces and returns bounded advisory hints without self-training or activating policies.",
      },
      {
        id: "adaptive.orchestration-policy-lab",
        area: "adaptive",
        status: "implemented",
        description: "Research-grade orchestration policy lab with expanded action decisions, deterministic baseline comparison, reasoning trace scoring, and strategy evaluation.",
      },
      {
        id: "adaptive.connector-marketplace",
        area: "adaptive",
        status: "implemented",
        description: "Provider and connector registry with capability-based selection and explicit policy metadata.",
      },
      {
        id: "adaptive.dynamic-task-spawning",
        area: "adaptive",
        status: "implemented",
        description: "Dynamic DAG task expansion with max-depth and max-task guardrails.",
      },
      {
        id: "adaptive.model-pool-orchestration",
        area: "adaptive",
        status: "implemented",
        description: "Bounded thinker, worker, and verifier provider orchestration.",
      },
      {
        id: "adaptive.workbench-artifacts",
        area: "adaptive",
        status: "implemented",
        description: "Static workbench snapshot and HTML rendering for mission, task, gate, and artifact state.",
      },
      {
        id: "adaptive.rich-artifact-types",
        area: "adaptive",
        status: "implemented",
        description: "Typed artifact records for plans, reports, workbench HTML, patch plans, and benchmark reports.",
      },
    ],
  };
}
