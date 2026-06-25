import { describe, expect, it } from "vitest";
import { reviewActionPolicy } from "../src/action-policy.js";

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
});
