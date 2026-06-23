export type ArtifactProposal = {
  artifactId: string;
  taskId: string;
  summary: string;
  evidenceIds: string[];
  readSet: string[];
  writeSet: string[];
  risks: string[];
};

export type ReconciliationConflict = {
  kind: "write_write" | "read_write";
  path: string;
  artifactIds: string[];
};

export type ReconciliationResult = {
  status: "merged" | "needs_review";
  summary: string;
  evidenceIds: string[];
  risks: string[];
  provenance: string[];
  conflicts: ReconciliationConflict[];
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function reconcileArtifacts(proposals: ArtifactProposal[]): ReconciliationResult {
  const conflicts: ReconciliationConflict[] = [];

  for (let leftIndex = 0; leftIndex < proposals.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < proposals.length; rightIndex += 1) {
      const left = proposals[leftIndex]!;
      const right = proposals[rightIndex]!;
      for (const writePath of left.writeSet) {
        if (right.writeSet.includes(writePath)) {
          conflicts.push({
            kind: "write_write",
            path: writePath,
            artifactIds: [left.artifactId, right.artifactId],
          });
        } else if (right.readSet.includes(writePath)) {
          conflicts.push({
            kind: "read_write",
            path: writePath,
            artifactIds: [left.artifactId, right.artifactId],
          });
        }
      }
      for (const writePath of right.writeSet) {
        if (left.readSet.includes(writePath)) {
          conflicts.push({
            kind: "read_write",
            path: writePath,
            artifactIds: [left.artifactId, right.artifactId],
          });
        }
      }
    }
  }

  return {
    status: conflicts.length > 0 ? "needs_review" : "merged",
    summary: proposals.map((proposal) => proposal.summary).join("\n"),
    evidenceIds: unique(proposals.flatMap((proposal) => proposal.evidenceIds)),
    risks: unique(proposals.flatMap((proposal) => proposal.risks)),
    provenance: proposals.map((proposal) => proposal.artifactId),
    conflicts,
  };
}
