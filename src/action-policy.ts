import { reviewOperationRisk, type OperationRiskLevel } from "./safety-scan.js";

export type ActionPolicyOperation =
  | { kind: "command"; command: string; args?: string[] }
  | { kind: "file_write"; path: string }
  | { kind: "file_delete"; path: string }
  | { kind: "tool_write"; targetDir: string }
  | { kind: "network"; url: string; method?: string };

export type ActionPolicyReview = {
  riskLevel: OperationRiskLevel;
  approval: "not_required" | "recommended" | "required";
  reasons: string[];
  rollbackHints: string[];
};

const RISK_ORDER: Record<OperationRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function reviewActionPolicy(input: {
  operations: ActionPolicyOperation[];
}): ActionPolicyReview {
  let riskLevel: OperationRiskLevel = "low";
  const reasons: string[] = [];
  const rollbackHints = new Set<string>();

  for (const operation of input.operations) {
    if (operation.kind === "command") {
      const commandRisk = reviewOperationRisk({
        command: operation.command,
        args: operation.args,
      });
      riskLevel = maxRisk(riskLevel, commandRisk.riskLevel);
      reasons.push(...commandRisk.reasons);
      if (commandRisk.riskLevel === "high") {
        rollbackHints.add("Capture `git status --short` and current commit before running high-risk operations.");
      }
      continue;
    }

    if (operation.kind === "file_delete") {
      riskLevel = maxRisk(riskLevel, "high");
      reasons.push(`Deleting ${operation.path} can remove source state.`);
      rollbackHints.add(`Confirm ${operation.path} is tracked or backed up before deletion.`);
      continue;
    }

    if (operation.kind === "file_write" || operation.kind === "tool_write") {
      riskLevel = maxRisk(riskLevel, "medium");
      const target = operation.kind === "file_write" ? operation.path : operation.targetDir;
      reasons.push(`Writing ${target} changes workspace state.`);
      rollbackHints.add("Review `git diff` before and after the write.");
      continue;
    }

    if (operation.kind === "network") {
      riskLevel = maxRisk(riskLevel, operation.method && operation.method !== "GET" ? "medium" : "low");
      reasons.push(`Network ${operation.method ?? "GET"} request to ${operation.url} should be bounded and attributable.`);
    }
  }

  return {
    riskLevel,
    approval:
      riskLevel === "high" ? "required" : riskLevel === "medium" ? "recommended" : "not_required",
    reasons: reasons.length > 0 ? [...new Set(reasons)] : ["No risky operations detected."],
    rollbackHints: [...rollbackHints],
  };
}

function maxRisk(left: OperationRiskLevel, right: OperationRiskLevel): OperationRiskLevel {
  return RISK_ORDER[right] > RISK_ORDER[left] ? right : left;
}
