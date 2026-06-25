import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

describe("agent behavior verification tool handlers", () => {
  it("exposes remit, inventory, verification, coverage, drift, and render tools", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-agent-behavior-tools-"));

    try {
      const tools = createToolHandlers(createInMemoryKernel(), {
        allowedRepoRoots: [repoRoot],
      });
      const remit = tools.agentRemitCreate({
        workerName: "Repo Maintainer",
        mission: "Maintain the repository inside a local workspace.",
        allowedCapabilities: ["repo_read"],
        restrictedCapabilities: ["shell_exec"],
        forbiddenCapabilities: ["email_send"],
        approvedChannels: ["local_files"],
        allowedOutboundDestinations: ["https://api.github.com"],
        knownGoodBaseline: {
          typicalToolInventory: ["repo_read", "shell_exec"],
          typicalChannelsUsed: ["local_files"],
          typicalOutboundDestinations: ["https://api.github.com"],
        },
      });
      const inventory = tools.agentCapabilityInventory({
        repoRoot,
        agentId: "repo-maintainer",
        capabilities: ["repo_read", "shell_exec", "email_send"],
        channels: ["local_files", "slack"],
        outboundDestinations: ["https://api.github.com", "https://hooks.slack.com"],
        actions: [
          {
            action: "shell_exec",
            approvalObserved: false,
            source: "events.jsonl",
            line: 7,
          },
        ],
        logs: [{ path: "events.jsonl", kind: "action-log" }],
      });
      const report = tools.agentBehaviorVerify({ remit, inventory });
      const coverage = tools.remitCoverageReport({ report });
      const drift = tools.agentDriftAnalyze({ remit, currentInventory: inventory });
      const rendered = tools.behaviorFindingsRender({ report });

      expect(remit.rules.map((rule) => rule.ruleId)).toContain("R-003");
      expect(inventory.repoRoot).toBe(repoRoot);
      expect(report.summary.riskLevel).toBe("critical");
      expect(coverage.markdown).toContain("# Remit Coverage");
      expect(drift.addedChannels).toEqual(["slack"]);
      expect(rendered.markdown).toContain("# Agent Behavior Verification Report");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
