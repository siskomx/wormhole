import { randomUUID } from "node:crypto";

export type ArtifactType =
  | "plan"
  | "json_report"
  | "html_workbench"
  | "patch_plan"
  | "benchmark_report";

export type ArtifactRecordInput = {
  missionId: string;
  type: ArtifactType;
  title: string;
  content: string;
  evidenceIds: string[];
  taskIds: string[];
};

export type ArtifactRecord = ArtifactRecordInput & {
  artifactId: string;
  createdAt: string;
};

export function createArtifactRecord(input: ArtifactRecordInput): ArtifactRecord {
  return {
    artifactId: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  };
}
