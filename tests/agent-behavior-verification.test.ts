import { describe, expect, it } from "vitest";
import {
  analyzeAgentDrift,
  createAgentRemit,
  inventoryAgentCapabilities,
  renderBehaviorFindings,
  verifyAgentBehavior,
} from "../src/agent-behavior-verification.js";

describe("agent behavior verification", () => {
  it("compares declared agent remit against observed capabilities and behavior", () => {
    const remit = createAgentRemit({
      workerName: "Repo Maintainer",
      owner: "Platform",
      mission: "Maintain the repository by reading code, recording evidence, and proposing reviewed changes.",
      version: "1.0.0",
      updatedBy: "operator",
      allowedCapabilities: ["repo_read", "evidence_record"],
      restrictedCapabilities: ["shell_exec"],
      forbiddenCapabilities: ["email_send"],
      approvedChannels: ["local_files"],
      authorizedCounterparties: ["operator"],
      allowedDataSources: ["repo"],
      allowedOutboundDestinations: ["https://api.github.com"],
      approvalRequiredActions: ["shell_exec"],
      neverAllowedActions: ["email_send"],
      knownGoodBaseline: {
        typicalToolInventory: ["repo_read", "evidence_record", "shell_exec"],
        typicalChannelsUsed: ["local_files"],
        typicalOutboundDestinations: ["https://api.github.com"],
      },
    });
    const inventory = inventoryAgentCapabilities({
      agentId: "repo-maintainer",
      capabilities: ["repo_read", "evidence_record", "shell_exec", "email_send"],
      channels: ["local_files", "slack"],
      counterparties: ["operator"],
      dataSources: ["repo"],
      outboundDestinations: ["https://api.github.com", "https://hooks.slack.com"],
      actions: [
        {
          action: "shell_exec",
          approvalObserved: false,
          source: "events.jsonl",
          line: 12,
          summary: "shell_exec action ran without approval evidence",
        },
      ],
      prompts: [
        {
          path: "AGENTS.md",
          sessionLoaded: true,
          writable: true,
          grantsCapabilities: ["email_send"],
        },
      ],
      logs: [{ path: "events.jsonl", kind: "action-log" }],
    });

    const report = verifyAgentBehavior({ remit, inventory });

    expect(report.summary.riskLevel).toBe("critical");
    expect(report.remitCoverage.statCounts.gap).toBeGreaterThanOrEqual(3);
    expect(report.remitCoverage.rules).toContainEqual(
      expect.objectContaining({
        ruleId: "R-003",
        status: "gap",
      }),
    );
    expect(report.findings.map((finding) => finding.summary)).toEqual(
      expect.arrayContaining([
        "Forbidden capability observed: email_send",
        "Restricted action ran without approval: shell_exec",
        "Undeclared channel observed: slack",
      ]),
    );
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        severity: "Critical",
        summary: "Compound behavior chain: unapproved execution plus external expansion",
        relatedFindingIds: expect.arrayContaining([
          expect.stringMatching(/^WH-ABV-\d{3}$/),
        ]),
      }),
    );
    expect(report.positives.map((positive) => positive.title)).toContain("Action log discovered");
  });

  it("detects drift from the remit known-good baseline and renders deterministic markdown", () => {
    const remit = createAgentRemit({
      workerName: "Repo Maintainer",
      mission: "Maintain the repository inside a local workspace.",
      allowedCapabilities: ["repo_read"],
      restrictedCapabilities: ["shell_exec"],
      approvedChannels: ["local_files"],
      knownGoodBaseline: {
        typicalToolInventory: ["repo_read", "shell_exec"],
        typicalChannelsUsed: ["local_files"],
        typicalOutboundDestinations: ["https://api.github.com"],
      },
    });
    const current = inventoryAgentCapabilities({
      agentId: "repo-maintainer",
      capabilities: ["repo_read", "shell_exec", "browser_control"],
      channels: ["local_files", "slack"],
      outboundDestinations: ["https://api.github.com", "https://hooks.slack.com"],
    });

    const drift = analyzeAgentDrift({ remit, currentInventory: current });
    const report = verifyAgentBehavior({ remit, inventory: current });
    const markdown = renderBehaviorFindings(report);

    expect(drift.addedCapabilities).toEqual(["browser_control"]);
    expect(drift.addedChannels).toEqual(["slack"]);
    expect(drift.addedOutboundDestinations).toEqual(["https://hooks.slack.com"]);
    expect(drift.findings).toContainEqual(
      expect.objectContaining({
        summary: "Capability drift from known-good baseline: browser_control",
      }),
    );
    expect(markdown).toContain("# Agent Behavior Verification Report");
    expect(markdown).toContain("## Remit Coverage");
    expect(markdown).toContain("WH-ABV-001");
    expect(renderBehaviorFindings(report)).toBe(markdown);
  });
});
