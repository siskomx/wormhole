import { describe, expect, it } from "vitest";
import { reviewActionPolicy } from "../src/action-policy.js";
import { reviewToolAdmission } from "../src/tool-registry.js";

describe("action policy", () => {
  it("classifies high-risk commands and emits rollback hints", () => {
    const review = reviewActionPolicy({
      operations: [
        { kind: "command", command: "git", args: ["push", "--force", "origin", "main"] },
        { kind: "file_delete", path: "src/app.ts" },
      ],
    });

    expect(review.riskLevel).toBe("high");
    expect(review.approval).toBe("required");
    expect(review.reasons).toContain("Force-pushing can overwrite remote history.");
    expect(review.rollbackHints).toContain("Capture `git status --short` and current commit before running high-risk operations.");
  });

  it("allows low-risk verification commands", () => {
    const review = reviewActionPolicy({
      operations: [{ kind: "command", command: "npm", args: ["test"] }],
    });

    expect(review.riskLevel).toBe("low");
    expect(review.approval).toBe("not_required");
  });

  it("requires admission for dangerous write and execute tools", () => {
    const review = reviewToolAdmission({
      toolNames: ["repo_index_query", "patch_apply", "agent_dispatch_execute", "shell_hook_install"],
    });
    const byName = new Map(review.decisions.map((decision) => [decision.toolName, decision]));

    expect(review.approval).toBe("required");
    expect(byName.get("repo_index_query")?.approval).toBe("not_required");
    expect(byName.get("patch_apply")?.requiredPreflightTools).toEqual(
      expect.arrayContaining(["action_policy_review", "patch_checkpoint"]),
    );
    expect(byName.get("agent_dispatch_execute")?.requiredPreflightTools).toContain("action_policy_review");
    expect(byName.get("shell_hook_install")?.requiredPreflightTools).toContain("shell_hook_plan");
  });
});
