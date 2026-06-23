import type { GateResult, Mission, TaskStatus } from "./kernel.js";

export type WorkbenchTask = {
  taskId: string;
  name: string;
  status: TaskStatus;
  currentFlow?: string;
};

export type WorkbenchArtifact = {
  artifactId: string;
  type: string;
  title: string;
};

export type WorkbenchSnapshotInput = {
  mission: Mission;
  tasks: WorkbenchTask[];
  gate?: GateResult;
  artifacts: WorkbenchArtifact[];
};

export type WorkbenchSection = {
  id: "mission" | "tasks" | "gate" | "artifacts";
  title: string;
};

export type WorkbenchSnapshot = WorkbenchSnapshotInput & {
  createdAt: string;
  sections: WorkbenchSection[];
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createWorkbenchSnapshot(input: WorkbenchSnapshotInput): WorkbenchSnapshot {
  return {
    ...input,
    createdAt: new Date().toISOString(),
    sections: [
      { id: "mission", title: "Mission" },
      { id: "tasks", title: "Tasks" },
      { id: "gate", title: "Gate" },
      { id: "artifacts", title: "Artifacts" },
    ],
  };
}

export function renderWorkbenchHtml(snapshot: WorkbenchSnapshot): string {
  const tasks = snapshot.tasks
    .map(
      (task) =>
        `<li><strong>${escapeHtml(task.name)}</strong> ${escapeHtml(task.status)} ` +
        `${escapeHtml(task.currentFlow ?? "")}</li>`,
    )
    .join("");
  const artifacts = snapshot.artifacts
    .map(
      (artifact) =>
        `<li><strong>${escapeHtml(artifact.title)}</strong> ${escapeHtml(artifact.type)}</li>`,
    )
    .join("");
  const gate = snapshot.gate
    ? `${snapshot.gate.open ? "Open" : "Closed"} ${snapshot.gate.reasons.map(escapeHtml).join(", ")}`
    : "Not requested";

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    "<title>Wormhole Workbench</title>",
    "</head>",
    "<body>",
    `<h1>${escapeHtml(snapshot.mission.objective)}</h1>`,
    `<section><h2>Mission</h2><p>${escapeHtml(snapshot.mission.missionId)}</p></section>`,
    `<section><h2>Tasks</h2><ul>${tasks}</ul></section>`,
    `<section><h2>Gate</h2><p>${gate}</p></section>`,
    `<section><h2>Artifacts</h2><ul>${artifacts}</ul></section>`,
    "</body>",
    "</html>",
  ].join("\n");
}
