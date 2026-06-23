export type WormholeTrack = "v1" | "v2" | "v3";

export type CapabilityStatus = "implemented" | "planned";

export type ConnectorTarget = "generic-mcp" | "claude-code" | "codex";

export type WormholeCapability = {
  id: string;
  track: WormholeTrack;
  status: CapabilityStatus;
  description: string;
};

export type WormholeConnector = {
  target: ConnectorTarget;
  status: CapabilityStatus;
  transport: "mcp-stdio" | "plugin-manifest" | "connector-contract";
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
        target: "codex",
        status: "planned",
        transport: "plugin-manifest",
        description: "Codex can consume the repo-local plugin metadata and MCP server configuration.",
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
        status: "planned",
        description: "Four-layer orchestration with parent-owned budgets, child manifests, and mergeable artifacts.",
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
        id: "v3.adaptive-model-pool",
        track: "v3",
        status: "planned",
        description: "Fugu-inspired routing that chooses model/provider depth from benchmark feedback, policy constraints, and task risk.",
      },
      {
        id: "v3.connector-marketplace",
        track: "v3",
        status: "planned",
        description: "Provider and connector registry with explicit opt-outs, audit trails, and benchmark-scored routing profiles.",
      },
    ],
  };
}
