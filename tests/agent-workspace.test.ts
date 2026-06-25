import { describe, expect, it } from "vitest";
import { createAgentWorkspaceStore } from "../src/agent-workspace.js";

describe("agent workspace memory", () => {
  it("creates a shared workspace and stores attributed records", () => {
    const store = createAgentWorkspaceStore();
    const workspace = store.create({
      missionId: "M1",
      objective: "Coordinate concurrent repository review agents.",
    });

    const record = store.write({
      workspaceId: workspace.workspaceId,
      runId: "run-a",
      key: "risk.auth",
      value: { severity: "high", summary: "Auth flow needs review." },
      provenance: { evidenceIds: ["E1"], sourceTool: "agent_dispatch_execute" },
    });
    const read = store.read({ workspaceId: workspace.workspaceId, key: "risk.auth" });

    expect(workspace.workspaceId).toMatch(/^agentws:/);
    expect(record.contentHash).toMatch(/^sha256:/);
    expect(read.records).toEqual([
      expect.objectContaining({
        key: "risk.auth",
        runId: "run-a",
        provenance: { evidenceIds: ["E1"], sourceTool: "agent_dispatch_execute" },
      }),
    ]);
  });

  it("detects conflicting concurrent writes during merge", () => {
    const store = createAgentWorkspaceStore();
    const workspace = store.create({ missionId: "M1" });
    store.write({
      workspaceId: workspace.workspaceId,
      runId: "run-a",
      key: "decision.storage",
      value: "Use JSONL for append-only state.",
    });
    store.write({
      workspaceId: workspace.workspaceId,
      runId: "run-b",
      key: "decision.storage",
      value: "Use SQLite for append-only state.",
    });
    store.write({
      workspaceId: workspace.workspaceId,
      runId: "run-b",
      key: "finding.tests",
      value: "Add focused merge tests.",
    });

    const merged = store.merge({
      workspaceId: workspace.workspaceId,
      runIds: ["run-a", "run-b"],
    });

    expect(merged.conflicts).toEqual([
      expect.objectContaining({
        key: "decision.storage",
        recordIds: expect.arrayContaining([
          expect.stringMatching(/^agentwsrec:/),
          expect.stringMatching(/^agentwsrec:/),
        ]),
      }),
    ]);
    expect(merged.mergedRecords.map((record) => record.key)).toContain("finding.tests");
  });

  it("restores workspaces and records from snapshots", () => {
    const first = createAgentWorkspaceStore();
    const workspace = first.create({ missionId: "M1", objective: "Persist workspace memory." });
    const record = first.write({
      workspaceId: workspace.workspaceId,
      runId: "run-a",
      key: "summary",
      value: "Workspace state survives handler recreation.",
    });

    const second = createAgentWorkspaceStore(first.snapshot());
    const read = second.read({ workspaceId: workspace.workspaceId });

    expect(read.workspace.workspaceId).toBe(workspace.workspaceId);
    expect(read.records[0]?.recordId).toBe(record.recordId);
  });
});
