export type WormholeCapabilityArea = "core" | "orchestration" | "adaptive";

export type CapabilityStatus = "implemented" | "planned";

export type ConnectorTarget =
  | "generic-mcp"
  | "claude-code"
  | "claude-desktop"
  | "codex"
  | "printing-press"
  | "graphify"
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
        description: "Native source-backed context records, ranked context queries, and budgeted context pack rendering with provenance.",
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
        status: "planned",
        description: "Optional adapters for external optimization systems while keeping Wormhole-native primitives as the baseline.",
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
        description: "Generic external agent registration, dispatch, status, interrupt, and completion contracts for Hermes, Pi, and other workers.",
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
        description: "Deterministic repo-local index with file, symbol, import, link, reference, provenance, confidence, query, explain, report, and dependency-path tools.",
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
