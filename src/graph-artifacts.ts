import type { RepoIndex } from "./repo-index.js";
import { getRepoGraphReport } from "./repo-index.js";

export type GraphCommunity = {
  id: string;
  members: string[];
};

export type GraphArtifacts = {
  graphJson: string;
  reportMarkdown: string;
  graphHtml: string;
};

export function createGraphArtifacts(
  index: RepoIndex,
  input: { communities?: GraphCommunity[] } = {},
): GraphArtifacts {
  const communities = input.communities ?? [];
  const graph = {
    repoRoot: index.repoRoot,
    builtAt: index.builtAt,
    files: index.files,
    symbols: index.symbols,
    edges: index.edges,
    communities,
  };
  const nativeReport = getRepoGraphReport(index);
  const graphJson = JSON.stringify(graph, null, 2);
  const reportMarkdown = [
    "# Wormhole Graph Report",
    "",
    "## Native Repo Summary",
    "",
    nativeReport.summary,
    "",
    "## Communities",
    "",
    ...(communities.length > 0
      ? communities.map(
          (community) =>
            `- ${escapeMarkdownText(community.id)}: ${community.members
              .map(escapeMarkdownText)
              .join(", ")}`,
        )
      : ["- none detected"]),
    "",
    nativeReport.markdown,
  ].join("\n");
  const graphHtml = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    "<title>Wormhole Graph</title>",
    "<style>body{font-family:Arial,sans-serif;margin:24px;}pre{white-space:pre-wrap;word-break:break-word;}ul{padding-left:20px;}li{margin:4px 0;}</style>",
    "</head>",
    "<body>",
    "<h1>Wormhole Graph</h1>",
    `<p>${escapeHtml(nativeReport.summary)}</p>`,
    "<h2>Top Files</h2>",
    "<ul>",
    ...nativeReport.topFiles.map(
      (file) => `<li>${escapeHtml(file.path)}: ${escapeHtml(String(file.edgeCount))} edges</li>`,
    ),
    "</ul>",
    "<h2>Graph JSON</h2>",
    `<pre>${escapeHtml(graphJson)}</pre>`,
    "</body>",
    "</html>",
  ].join("\n");

  return { graphJson, reportMarkdown, graphHtml };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}
