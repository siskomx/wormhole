import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GraphCommunityRecord } from "./graph-communities.js";
import type {
  EntrypointFlow,
  EntrypointFlowDiscovery,
  EntrypointKind,
  ProjectObservationEvidence,
} from "./project-intelligence.js";

export type ExecutionFlowStore = {
  version: 1;
  repoRoot: string;
  generatedAt: string;
  fingerprint: string;
  flows: ExecutionFlowRecord[];
};

export type ExecutionFlowRecord = {
  id: string;
  name: string;
  kind: EntrypointKind;
  entrypointId: string;
  path: string;
  command?: string;
  symbol?: string;
  downstreamFiles: string[];
  communityIds: string[];
  evidence: ProjectObservationEvidence[];
};

export type ExecutionFlowListResult = {
  repoRoot: string;
  fingerprint?: string;
  flows: ExecutionFlowRecord[];
  refused?: true;
  reason?: string;
  hint?: string;
};

export type ExecutionFlowGetResult = {
  repoRoot: string;
  fingerprint?: string;
  flow?: ExecutionFlowRecord;
  refused?: true;
  reason?: string;
  hint?: string;
};

const STORE_RELATIVE_PATH = ".wormhole/flows/index.json";
const REFRESH_HINT = "Run flows_refresh before querying named execution flows.";

export function refreshExecutionFlows(input: {
  repoRoot: string;
  discovery: EntrypointFlowDiscovery;
  communities?: GraphCommunityRecord[];
}): ExecutionFlowStore {
  const repoRoot = path.resolve(input.repoRoot);
  const flows = input.discovery.entrypoints.map((entrypoint) =>
    normalizeFlow(entrypoint, input.communities ?? []),
  );
  const store: ExecutionFlowStore = {
    version: 1,
    repoRoot,
    generatedAt: new Date().toISOString(),
    fingerprint: input.discovery.fingerprint,
    flows: flows.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
  };
  writeJson(storePath(repoRoot), store);
  return store;
}

export function readExecutionFlowStore(repoRoot: string): ExecutionFlowStore | undefined {
  return readJson<ExecutionFlowStore>(storePath(path.resolve(repoRoot)));
}

export function listExecutionFlows(input: {
  repoRoot: string;
  currentFingerprint?: string;
  kind?: EntrypointKind;
  query?: string;
}): ExecutionFlowListResult {
  const store = readExecutionFlowStore(input.repoRoot);
  const repoRoot = path.resolve(input.repoRoot);
  if (!store) {
    return {
      repoRoot,
      flows: [],
      refused: true,
      reason: "Execution flow store is missing.",
      hint: REFRESH_HINT,
    };
  }
  if (input.currentFingerprint && store.fingerprint !== input.currentFingerprint) {
    return {
      repoRoot,
      fingerprint: store.fingerprint,
      flows: [],
      refused: true,
      reason: "Execution flow store is stale for the current repo index.",
      hint: REFRESH_HINT,
    };
  }
  const query = input.query?.toLowerCase().trim();
  const flows = store.flows
    .filter((flow) => !input.kind || flow.kind === input.kind)
    .filter((flow) => !query || searchableFlowText(flow).includes(query));
  return {
    repoRoot,
    fingerprint: store.fingerprint,
    flows,
  };
}

export function getExecutionFlow(input: {
  repoRoot: string;
  idOrName: string;
  currentFingerprint?: string;
}): ExecutionFlowGetResult {
  const store = readExecutionFlowStore(input.repoRoot);
  const repoRoot = path.resolve(input.repoRoot);
  if (!store) {
    return {
      repoRoot,
      refused: true,
      reason: "Execution flow store is missing.",
      hint: REFRESH_HINT,
    };
  }
  if (input.currentFingerprint && store.fingerprint !== input.currentFingerprint) {
    return {
      repoRoot,
      fingerprint: store.fingerprint,
      refused: true,
      reason: "Execution flow store is stale for the current repo index.",
      hint: REFRESH_HINT,
    };
  }
  const lookup = input.idOrName.toLowerCase();
  const flow = store.flows.find(
    (candidate) =>
      candidate.id === input.idOrName ||
      candidate.name === input.idOrName ||
      slug(candidate.name) === slug(lookup),
  );
  if (!flow) {
    return {
      repoRoot,
      fingerprint: store.fingerprint,
      refused: true,
      reason: `Execution flow not found: ${input.idOrName}`,
      hint: "Use list_flows to inspect available flow ids and names.",
    };
  }
  return {
    repoRoot,
    fingerprint: store.fingerprint,
    flow,
  };
}

export function executionFlowStorePath(repoRoot: string): string {
  return storePath(path.resolve(repoRoot));
}

function normalizeFlow(entrypoint: EntrypointFlow, communities: GraphCommunityRecord[]): ExecutionFlowRecord {
  const name = `${entrypoint.kind} ${entrypoint.symbol ?? entrypoint.command ?? entrypoint.name ?? entrypoint.path}`;
  return {
    id: stableFlowId(entrypoint.entrypointId),
    name,
    kind: entrypoint.kind,
    entrypointId: entrypoint.entrypointId,
    path: entrypoint.path,
    ...(entrypoint.command ? { command: entrypoint.command } : {}),
    ...(entrypoint.symbol ? { symbol: entrypoint.symbol } : {}),
    downstreamFiles: [...entrypoint.downstreamFiles],
    communityIds: communityIdsForFlow(entrypoint, communities),
    evidence: [...entrypoint.evidence],
  };
}

function communityIdsForFlow(entrypoint: EntrypointFlow, communities: GraphCommunityRecord[]): string[] {
  const flowFiles = new Set([entrypoint.path, ...entrypoint.downstreamFiles]);
  return communities
    .filter((community) => community.members.some((member) => flowFiles.has(fileForNode(member) ?? "")))
    .map((community) => community.id)
    .sort((left, right) => left.localeCompare(right));
}

function stableFlowId(entrypointId: string): string {
  return `flow:${createHash("sha256").update(entrypointId).digest("hex").slice(0, 12)}`;
}

function searchableFlowText(flow: ExecutionFlowRecord): string {
  return [
    flow.id,
    flow.name,
    flow.kind,
    flow.entrypointId,
    flow.path,
    flow.command ?? "",
    flow.symbol ?? "",
    flow.downstreamFiles.join(" "),
    flow.communityIds.join(" "),
  ].join(" ").toLowerCase();
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fileForNode(nodeId: string): string | undefined {
  if (nodeId.startsWith("external:")) {
    return undefined;
  }
  return nodeId.split("#", 1)[0] ?? nodeId;
}

function storePath(repoRoot: string): string {
  return path.join(repoRoot, STORE_RELATIVE_PATH);
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}
