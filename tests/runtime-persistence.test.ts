import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryKernel } from "../src/kernel.js";
import { createToolHandlers } from "../src/tools.js";

describe("runtime handler persistence", () => {
  it("restores agent, model, context, optimization, behavior, stats, tool promotion, and policy state", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-handler-state-"));
    const runtimeStatePath = path.join(root, "runtime-state.json");

    try {
      const first = createToolHandlers(createInMemoryKernel(), { runtimeStatePath, allowedRepoRoots: [root] });
      first.agentRegister({
        agentId: "cli-helper",
        displayName: "CLI Helper",
        target: "local-cli",
        transport: "cli",
        capabilities: ["coding"],
        installation: "installed",
        authentication: "none",
        maxConcurrentTasks: 1,
        supportsInterrupt: true,
      });
      first.modelProfileRegister({
        profileId: "small-local",
        providerId: "local",
        modelId: "small",
        strengths: ["coding"],
        modes: ["fast"],
        costTier: "low",
        latencyTier: "low",
        privacy: "local",
        contextWindow: 8000,
      });
      const optimized = first.optimizationApply({
        kind: "dense_summary",
        content: "Keep this original content available after restart.",
      });
      const context = first.ctxRecord({
        source: "src/context-store.ts",
        sourceType: "file",
        text: "Context packs should survive handler recreation for coding agents.",
        tags: ["context", "persistence"],
      });
      const pack = first.ctxPackCreate({
        objective: "Restore context packs",
        query: "context persistence",
        maxChars: 240,
      });
      const workspace = first.agentWorkspaceCreate({
        missionId: "M1",
        objective: "Persist shared agent workspace memory",
      });
      const workspaceRecord = first.agentWorkspaceWrite({
        workspaceId: workspace.workspaceId,
        runId: "run-a",
        key: "finding",
        value: "Agent workspace memory survives handler recreation.",
      });
      const resumeRecord = first.resumeRecord({
        repoRoot: root,
        objective: "Persist resume checkpoint",
        kind: "exact_next_action",
        summary: "Resume records survive handler recreation.",
        nextActions: ["Call resume_load in the next chat"],
        contextPackIds: [pack.packId],
      });
      const resumeCheckpoint = first.resumeCheckpoint({
        repoRoot: root,
        objective: "Persist resume checkpoint",
        reason: "Before handler recreation",
      });
      await first.optimizedCommandRun({
        command: process.execPath,
        args: ["-e", "for (let i = 0; i < 20; i += 1) console.log(`persisted stat ${i}`);"],
        timeoutMs: 2_000,
      });
      first.behaviorModeSet({ brevity: "dense", minimality: "strict" });
      const promotion = first.toolPromote({
        missionId: "M1",
        sessionId: "S1",
        profileId: "feature-implementation",
        objective: "Persist promoted tools",
        query: "patch verify evidence",
        toolNames: ["patch_apply", "verification_run", "record_evidence"],
      });
      const secondPromotion = first.toolPromote({
        missionId: "M1",
        sessionId: "S1",
        profileId: "feature-implementation",
        objective: "Persist promoted tools",
        query: "gate evidence",
        toolNames: ["gate_request", "record_evidence"],
      });
      expect(secondPromotion.promotionId).not.toBe(promotion.promotionId);

      const trace = {
        traceId: "trace-1",
        taskKind: "feature",
        graphNodeCount: 100,
        evidenceCount: 4,
        openQuestions: 0,
        action: {
          workerCount: 2,
          verifierCount: 1,
          maxDepth: 3,
          modelProfile: "balanced",
          splitStrategy: "parallel" as const,
          contextBudget: "large" as const,
          evidenceMode: "strict" as const,
          stopRule: "verify" as const,
        },
        outcome: {
          testsPassed: true,
          evidenceCount: 4,
          openQuestions: 0,
          durationMs: 1000,
          tokenEstimate: 2000,
          userCorrectionCount: 0,
        },
      };
      for (let index = 1; index <= 60; index += 1) {
        first.orchestrationTraceRecord({ ...trace, traceId: `trace-${index}` });
      }
      const evaluation = first.orchestrationPolicyEvaluate({
        policyJson: {
          policyId: "persisted-policy",
          qTable: {
            "feature|graph:medium|evidence:medium|risk:low": {
              "workers=2|verifiers=1|depth=3|model=balanced|split=parallel|context=large|evidence=strict|stop=verify": 1,
            },
          },
        },
      });
      first.orchestrationPolicyActivate({ evaluationId: evaluation.evaluationId });

      const second = createToolHandlers(createInMemoryKernel(), { runtimeStatePath, allowedRepoRoots: [root] });
      const restoredPromotion = second.toolPromotionStatus({ missionId: "M1", sessionId: "S1" });
      const run = second.agentDispatch({
        missionId: "M1",
        taskId: "T1",
        objective: "Use restored agent",
        requiredCapabilities: ["coding"],
      });
      const route = second.modelProfileSelect({
        taskType: "coding",
        mode: "fast",
        requiredStrengths: ["coding"],
      });
      const conductor = second.conductorPlan({
        objective: "Use restored active policy",
        risk: "low",
        complexity: "low",
        requiredStrengths: ["coding"],
        modelProfileIds: ["small-local"],
      });

      expect(run.assignedAgentId).toBe("cli-helper");
      expect(route.profile.profileId).toBe("small-local");
      expect(second.optimizationRetrieve({ retrievalId: optimized.retrievalId }).originalContent).toContain(
        "original content",
      );
      expect(second.ctxPackQuery({ query: "context persistence", limit: 1 }).results[0]?.contextId).toBe(
        context.contextId,
      );
      expect(second.ctxPackRender({ packId: pack.packId })).toContain("Context packs should survive");
      expect(second.agentWorkspaceRead({ workspaceId: workspace.workspaceId }).records[0]?.recordId).toBe(
        workspaceRecord.recordId,
      );
      expect(second.resumeLoad({ repoRoot: root }).records[0]?.recordId).toBe(resumeRecord.recordId);
      expect(second.resumeValidate({ repoRoot: root, requireCanonical: true }).checkpoint?.checkpointId).toBe(
        resumeCheckpoint.checkpointId,
      );
      expect(second.optimizationStats().runCount).toBe(1);
      expect(second.behaviorModeGet()).toEqual({ brevity: "dense", minimality: "strict" });
      expect(restoredPromotion.count).toBe(2);
      expect(restoredPromotion.records.map((record) => record.promotionId)).toEqual([
        promotion.promotionId,
        secondPromotion.promotionId,
      ]);
      expect(restoredPromotion.records[0]?.promotedTools.map((candidate) => candidate.tool.name)).toEqual([
        "patch_apply",
        "verification_run",
        "record_evidence",
      ]);
      expect(restoredPromotion.records[1]?.promotedTools.map((candidate) => candidate.tool.name)).toEqual([
        "gate_request",
        "record_evidence",
      ]);
      expect(second.orchestrationPolicyGet()?.policyId).toBe("persisted-policy");
      expect(conductor.trace.reasonCodes).toContain("policy:persisted-policy");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
