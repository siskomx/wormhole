import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExecutionFlowRecord } from "./execution-flow-store.js";
import type { GraphCommunityRecord } from "./graph-communities.js";
import type { SurprisingConnection } from "./surprising-connections.js";
import { getRepoGraphReport, type RepoIndex } from "./repo-index.js";

export type GraphWikiPage = {
  relativePath: string;
  content: string;
};

export type GraphWikiWriteResult = {
  repoRoot: string;
  files: Array<{
    relativePath: string;
    absolutePath: string;
    bytes: number;
  }>;
};

export function renderGraphWiki(input: {
  repoRoot: string;
  index: RepoIndex;
  communities: GraphCommunityRecord[];
  flows?: ExecutionFlowRecord[];
  surprisingConnections?: SurprisingConnection[];
  scope?: "all" | "overview" | "communities" | "flows";
  communityId?: string;
  flowId?: string;
}): GraphWikiPage[] {
  const scope = input.scope ?? "all";
  const flows = input.flows ?? [];
  const surprisingConnections = input.surprisingConnections ?? [];
  const pages: GraphWikiPage[] = [];

  if (scope === "all" || scope === "overview") {
    pages.push({
      relativePath: ".wormhole/graph-wiki/index.md",
      content: renderOverview({
        index: input.index,
        communities: input.communities,
        flows,
        surprisingConnections,
      }),
    });
  }

  if (scope === "all" || scope === "communities") {
    for (const community of input.communities.filter(
      (candidate) => !input.communityId || candidate.id === input.communityId,
    )) {
      pages.push({
        relativePath: `.wormhole/graph-wiki/communities/${slug(community.id)}.md`,
        content: renderCommunityPage(community, flows),
      });
    }
  }

  if (scope === "all" || scope === "flows") {
    for (const flow of flows.filter((candidate) => !input.flowId || candidate.id === input.flowId)) {
      pages.push({
        relativePath: `.wormhole/graph-wiki/flows/${slug(flow.id)}.md`,
        content: renderFlowPage(flow, input.communities),
      });
    }
  }

  return pages;
}

export function writeGraphWiki(input: {
  repoRoot: string;
  pages: GraphWikiPage[];
}): GraphWikiWriteResult {
  const repoRoot = path.resolve(input.repoRoot);
  const files = input.pages.map((page) => {
    const absolutePath = resolveRepoPath(repoRoot, page.relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const content = `${page.content.trimEnd()}\n`;
    writeFileSync(absolutePath, content, "utf8");
    return {
      relativePath: page.relativePath,
      absolutePath,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  });
  return {
    repoRoot,
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
}

function renderOverview(input: {
  index: RepoIndex;
  communities: GraphCommunityRecord[];
  flows: ExecutionFlowRecord[];
  surprisingConnections: SurprisingConnection[];
}): string {
  const report = getRepoGraphReport(input.index);
  return [
    "# Graph Wiki",
    "",
    `Repo: ${input.index.repoRoot}`,
    `Fingerprint: ${input.index.fingerprint}`,
    `Summary: ${report.summary}`,
    `Index health: ${report.indexHealth.status}`,
    "",
    "## Communities",
    "",
    ...(input.communities.length > 0
      ? input.communities.map(
          (community) =>
            `- ${community.id}: ${community.label}, files=${community.fileCount}, symbols=${community.symbolCount}`,
        )
      : ["- none"]),
    "",
    "## Execution Flows",
    "",
    ...(input.flows.length > 0
      ? input.flows.map((flow) => `- ${flow.id}: ${flow.name} (${flow.kind})`)
      : ["- none"]),
    "",
    "## Surprising Connections",
    "",
    ...(input.surprisingConnections.length > 0
      ? input.surprisingConnections
          .slice(0, 12)
          .map((connection) => `- ${connection.from} -> ${connection.to}: ${connection.reason}`)
      : ["- none"]),
    "",
  ].join("\n");
}

function renderCommunityPage(community: GraphCommunityRecord, flows: ExecutionFlowRecord[]): string {
  const relatedFlows = flows.filter((flow) => flow.communityIds.includes(community.id));
  return [
    `# Community ${community.label}`,
    "",
    `ID: ${community.id}`,
    `Files: ${community.fileCount}`,
    `Symbols: ${community.symbolCount}`,
    "",
    "## Top Files",
    "",
    ...(community.topFiles.length > 0 ? community.topFiles.map((file) => `- ${file}`) : ["- none"]),
    "",
    "## Members",
    "",
    ...community.members.map((member) => `- ${member}`),
    "",
    "## Related Flows",
    "",
    ...(relatedFlows.length > 0 ? relatedFlows.map((flow) => `- ${flow.name} (${flow.id})`) : ["- none"]),
    "",
  ].join("\n");
}

function renderFlowPage(flow: ExecutionFlowRecord, communities: GraphCommunityRecord[]): string {
  const relatedCommunities = communities.filter((community) => flow.communityIds.includes(community.id));
  return [
    `# Flow ${flow.name}`,
    "",
    `ID: ${flow.id}`,
    `Kind: ${flow.kind}`,
    `Entrypoint: ${flow.path}`,
    ...(flow.symbol ? [`Symbol: ${flow.symbol}`] : []),
    ...(flow.command ? [`Command: ${flow.command}`] : []),
    "",
    "## Downstream Files",
    "",
    ...(flow.downstreamFiles.length > 0 ? flow.downstreamFiles.map((file) => `- ${file}`) : ["- none"]),
    "",
    "## Communities",
    "",
    ...(relatedCommunities.length > 0
      ? relatedCommunities.map((community) => `- ${community.id}: ${community.label}`)
      : ["- none"]),
    "",
  ].join("\n");
}

function resolveRepoPath(repoRoot: string, relativePath: string): string {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relativeToRoot = path.relative(repoRoot, absolutePath);
  if (relativeToRoot === "" || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Graph wiki path must stay within repoRoot");
  }
  if (existsSync(absolutePath) && path.relative(repoRoot, absolutePath).startsWith("..")) {
    throw new Error("Graph wiki path must stay within repoRoot");
  }
  return absolutePath;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
