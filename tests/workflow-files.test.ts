import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeWorkflowArtifacts } from "../src/workflow-files.js";
import { createFeatureWorkflow } from "../src/workflows.js";

function createClientAgentFixtureRepo(): string {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-workflow-files-"));
  mkdirSync(path.join(repoRoot, "backend", "tests", "workflows"), { recursive: true });
  mkdirSync(path.join(repoRoot, "docs", "workflows", "behavior"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "backend", "tests", "workflows", "org-client-agent-invoice-review.workflow.test.ts"),
    "test('client agent invoice review workflow', () => expect(true).toBe(true));\n",
  );
  writeFileSync(
    path.join(repoRoot, "docs", "workflows", "behavior", "org-client-agent-invoice-review.behavior.json"),
    JSON.stringify({ feature: "client-agent", behavior: "invoice review" }, null, 2),
  );
  return repoRoot;
}

describe("workflow artifact files", () => {
  it("writes durable workflow state, markdown resume, and latest pointer", () => {
    const repoRoot = createClientAgentFixtureRepo();
    try {
      const workflow = createFeatureWorkflow({
        repoRoot,
        objective: "Continue the client agent invoice workflow",
        missionId: "mission-client-agent",
      });

      const result = writeWorkflowArtifacts({ repoRoot, workflow });

      expect(result.files.map((file) => file.relativePath)).toEqual([
        ".wormhole/workflows/latest.json",
        `.wormhole/workflows/${workflow.run.runId}.json`,
        `.wormhole/workflows/${workflow.run.runId}.md`,
      ]);
      expect(result.requiredArtifacts.map((artifact) => artifact.relativePath)).toEqual(
        workflow.requiredArtifacts.map((artifact) => artifact.path).sort((left, right) => left.localeCompare(right)),
      );
      expect(result.requiredArtifacts.every((artifact) => artifact.status === "written")).toBe(true);
      for (const file of result.files) {
        expect(existsSync(file.absolutePath)).toBe(true);
        expect(file.bytes).toBeGreaterThan(20);
      }

      const runJson = JSON.parse(
        readFileSync(path.join(repoRoot, ".wormhole", "workflows", `${workflow.run.runId}.json`), "utf8"),
      ) as typeof workflow;
      const latestJson = JSON.parse(
        readFileSync(path.join(repoRoot, ".wormhole", "workflows", "latest.json"), "utf8"),
      ) as { runId: string; workflowPath: string; resumePath: string };
      const resume = readFileSync(
        path.join(repoRoot, ".wormhole", "workflows", `${workflow.run.runId}.md`),
        "utf8",
      );

      expect(runJson.run.runId).toBe(workflow.run.runId);
      expect(runJson.featureBindings.map((feature) => feature.featureId)).toEqual(["client-agent"]);
      expect(latestJson).toEqual({
        runId: workflow.run.runId,
        workflowPath: `.wormhole/workflows/${workflow.run.runId}.json`,
        resumePath: `.wormhole/workflows/${workflow.run.runId}.md`,
      });
      expect(resume).toContain("# Workflow Resume");
      expect(resume).toContain("client-agent");
      expect(resume).toContain("Exact Next Action");
      expect(resume).toContain("## Source Of Truth");
      expect(resume).toContain("## Supporting Docs");
      expect(resume).toContain("backend/tests/workflows/org-client-agent-invoice-review.workflow.test.ts");
      expect(resume).toContain("docs/workflows/behavior/org-client-agent-invoice-review.behavior.json");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
