import { describe, expect, it } from "vitest";
import { createWorkbenchSnapshot, renderWorkbenchHtml } from "../src/workbench.js";

describe("workbench snapshot and rendering", () => {
  it("creates a static workbench view model and HTML", () => {
    const snapshot = createWorkbenchSnapshot({
      mission: {
        missionId: "M1",
        objective: "Plan a migration",
        repoRoot: "/repo",
      },
      tasks: [
        {
          taskId: "T1",
          name: "Dax",
          status: "running",
          currentFlow: "Inspecting config",
        },
      ],
      gate: { open: false, reasons: ["Need evidence"] },
      artifacts: [{ artifactId: "A1", type: "plan", title: "Migration plan" }],
    });
    const html = renderWorkbenchHtml(snapshot);

    expect(snapshot.sections.map((section) => section.id)).toEqual([
      "mission",
      "tasks",
      "gate",
      "artifacts",
    ]);
    expect(html).toContain("Plan a migration");
    expect(html).toContain("Inspecting config");
    expect(html).toContain("Migration plan");
  });
});
