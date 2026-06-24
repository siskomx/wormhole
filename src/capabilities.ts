export type WormholeTrack = "v1" | "v2" | "v3";

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
  track: WormholeTrack;
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
        description: "Local MCP server exposing the v1 evidence, question, gate, status, and plan tools.",
      },
      {
        target: "claude-code",
        status: "implemented",
        transport: "mcp-stdio",
        description: "Claude Code can attach to the Wormhole MCP server and drive the v1 workflow.",
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
        description: "Printing Press generated CLIs and MCP servers can be registered as Wormhole capabilities and converted into external agent workers.",
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
        id: "v1.evidence-gated-planning",
        track: "v1",
        status: "implemented",
        description: "Append-only JSONL planning state, evidence records, question ledger, batch gate, and Markdown plan artifact.",
      },
      {
        id: "v2.parallel-sub-orchestrators",
        track: "v2",
        status: "implemented",
        description: "Four-layer task records plus deterministic DAG scheduling with dependency waves and read/write lock separation.",
      },
      {
        id: "v2.live-sub-orchestrator-control",
        track: "v2",
        status: "implemented",
        description: "Task registration, heartbeat/status reporting, mailbox messages, direction-change pause/ack, and immediate interrupts for active sub-orchestrators.",
      },
      {
        id: "v2.context-compression",
        track: "v2",
        status: "implemented",
        description: "Wormhole-native command compaction, context compression, dense summaries, and minimality review primitives.",
      },
      {
        id: "v2.first-party-optimization-primitives",
        track: "v2",
        status: "implemented",
        description: "Deterministic local versions of RTK-style command compaction, Headroom-style context compression, Caveman-style dense summaries, and Ponytail-style minimality review.",
      },
      {
        id: "v2.external-optimization-adapters",
        track: "v2",
        status: "planned",
        description: "Optional adapters for external optimization systems while keeping Wormhole-native primitives as the baseline.",
      },
      {
        id: "v2.content-addressed-evidence-cache",
        track: "v2",
        status: "implemented",
        description: "SHA-256 addressed evidence cache for raw source content and replayable provenance handles.",
      },
      {
        id: "v2.reconciliation-engine",
        track: "v2",
        status: "implemented",
        description: "Artifact reconciliation with provenance merge and read/write conflict detection.",
      },
      {
        id: "v2.benchmark-runner",
        track: "v2",
        status: "implemented",
        description: "Benchmark comparison runner that captures unaided and Wormhole plans and emits anonymized review pairs.",
      },
      {
        id: "v2.codex-runtime-adapter",
        track: "v2",
        status: "implemented",
        description: "Codex adapter config generation and validation for local plugin/runtime attachment.",
      },
      {
        id: "v2.external-agent-adapters",
        track: "v2",
        status: "implemented",
        description: "Generic external agent registration, dispatch, status, interrupt, and completion contracts for Hermes, Pi, and other workers.",
      },
      {
        id: "v2.printing-press-cli-adapters",
        track: "v2",
        status: "implemented",
        description: "Printing Press generated CLI registry, capability selection, and conversion into Wormhole external agent workers.",
      },
      {
        id: "v2.repo-index-graph",
        track: "v2",
        status: "implemented",
        description: "Deterministic repo-local index with file, symbol, import, link, query, explain, and dependency-path tools.",
      },
      {
        id: "v2.local-orchestration-runner",
        track: "v2",
        status: "implemented",
        description: "Adapter-free local orchestration planning and deterministic execution over DAG waves, depth limits, task budgets, and spawned local tasks.",
      },
      {
        id: "v3.adaptive-routing-model-selection",
        track: "v3",
        status: "implemented",
        description: "Deterministic fast/balanced/deep routing and model selection from provider capability manifests.",
      },
      {
        id: "v3.connector-registry",
        track: "v3",
        status: "implemented",
        description: "Connector registry and capability-based connector selection.",
      },
      {
        id: "v3.graph-first-codebase-query",
        track: "v3",
        status: "implemented",
        description: "Graph-first codebase query workflow that lets agents ask the repo index before broad grep or file-reading passes.",
      },
      {
        id: "v3.adaptive-model-pool",
        track: "v3",
        status: "implemented",
        description: "Bounded model-pool orchestration with thinker, worker, and verifier roles plus deterministic routing/model selection.",
      },
      {
        id: "v3.connector-marketplace",
        track: "v3",
        status: "implemented",
        description: "Provider and connector registry with capability-based selection and explicit policy metadata.",
      },
      {
        id: "v3.dynamic-task-spawning",
        track: "v3",
        status: "implemented",
        description: "Dynamic DAG task expansion with max-depth and max-task guardrails.",
      },
      {
        id: "v3.model-pool-orchestration",
        track: "v3",
        status: "implemented",
        description: "Bounded thinker, worker, and verifier provider orchestration.",
      },
      {
        id: "v3.workbench-artifacts",
        track: "v3",
        status: "implemented",
        description: "Static workbench snapshot and HTML rendering for mission, task, gate, and artifact state.",
      },
      {
        id: "v3.rich-artifact-types",
        track: "v3",
        status: "implemented",
        description: "Typed artifact records for plans, reports, workbench HTML, patch plans, and benchmark reports.",
      },
    ],
  };
}
