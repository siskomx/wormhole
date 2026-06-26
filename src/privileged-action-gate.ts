import { reviewActionPolicy, type ActionPolicyOperation } from "./action-policy.js";
import { reviewToolAdmission, type ToolAdmissionApproval } from "./tool-registry.js";
import type { OperationRiskLevel } from "./safety-scan.js";

export const PRIVILEGED_ACTION_KINDS = [
  "command",
  "network",
  "file_write",
  "file_delete",
  "shell_hook",
  "adapter_execute",
] as const;

export type PrivilegedActionKind = (typeof PRIVILEGED_ACTION_KINDS)[number];
export type PrivilegedActionMode = "disabled" | "trusted_local" | "strict";

export type PrivilegedActionPolicy = {
  mode?: PrivilegedActionMode;
  disabledTools?: string[];
  disabledKinds?: PrivilegedActionKind[];
  approvedTools?: string[];
  approvedActionIds?: string[];
};

export type PrivilegedActionRequest = {
  actionId?: string;
  toolName: string;
  kind: PrivilegedActionKind;
  operations: ActionPolicyOperation[];
  target?: {
    repoRoot?: string;
    path?: string;
    command?: string;
    args?: string[];
    url?: string;
    adapterId?: string;
  };
  metadata?: Record<string, unknown>;
};

export type PrivilegedActionDecision = {
  allowed: boolean;
  mode: PrivilegedActionMode;
  approval: ToolAdmissionApproval;
  riskLevel: OperationRiskLevel;
  reasons: string[];
  requiredPreflightTools: string[];
};

export type PrivilegedActionGate = {
  review(request: PrivilegedActionRequest): PrivilegedActionDecision;
  assertAllowed(request: PrivilegedActionRequest): PrivilegedActionDecision;
};

export function createPrivilegedActionGate(policy: PrivilegedActionPolicy = {}): PrivilegedActionGate {
  const mode = policy.mode ?? parseMode(process.env.WORMHOLE_PRIVILEGED_ACTION_MODE) ?? "trusted_local";
  const disabledTools = new Set(policy.disabledTools ?? []);
  const disabledKinds = new Set(policy.disabledKinds ?? []);
  const approvedTools = new Set(policy.approvedTools ?? []);
  const approvedActionIds = new Set(policy.approvedActionIds ?? []);

  function review(request: PrivilegedActionRequest): PrivilegedActionDecision {
    const actionReview = reviewActionPolicy({ operations: request.operations });
    const admission = reviewToolAdmission({ toolNames: [request.toolName] });
    const decision = admission.decisions[0];
    const requiredPreflightTools = decision?.requiredPreflightTools ?? [];
    const approval = maxApproval(actionReview.approval, admission.approval);
    const reasons = [...new Set([
      ...actionReview.reasons,
      ...(decision?.reasons ?? []),
    ])];

    if (mode === "disabled") {
      return {
        allowed: true,
        mode,
        approval,
        riskLevel: actionReview.riskLevel,
        reasons,
        requiredPreflightTools,
      };
    }

    if (disabledTools.has(request.toolName)) {
      return {
        allowed: false,
        mode,
        approval,
        riskLevel: actionReview.riskLevel,
        reasons: [`${request.toolName} is disabled by privileged action policy.`, ...reasons],
        requiredPreflightTools,
      };
    }
    if (disabledKinds.has(request.kind)) {
      return {
        allowed: false,
        mode,
        approval,
        riskLevel: actionReview.riskLevel,
        reasons: [`${request.kind} actions are disabled by privileged action policy.`, ...reasons],
        requiredPreflightTools,
      };
    }

    if (mode === "strict" && approval === "required") {
      const approved =
        approvedTools.has(request.toolName) ||
        (request.actionId !== undefined && approvedActionIds.has(request.actionId));
      return {
        allowed: approved,
        mode,
        approval,
        riskLevel: actionReview.riskLevel,
        reasons: approved
          ? reasons
          : ["Strict privileged action policy requires host approval for this action.", ...reasons],
        requiredPreflightTools,
      };
    }

    return {
      allowed: true,
      mode,
      approval,
      riskLevel: actionReview.riskLevel,
      reasons,
      requiredPreflightTools,
    };
  }

  return {
    review,
    assertAllowed(request: PrivilegedActionRequest): PrivilegedActionDecision {
      const decision = review(request);
      if (!decision.allowed) {
        throw new Error(`Privileged action blocked: ${decision.reasons.join(" ")}`);
      }
      return decision;
    },
  };
}

function parseMode(value: string | undefined): PrivilegedActionMode | undefined {
  return value === "disabled" || value === "trusted_local" || value === "strict" ? value : undefined;
}

const APPROVAL_RANK: Record<ToolAdmissionApproval, number> = {
  not_required: 0,
  recommended: 1,
  required: 2,
};

function maxApproval(left: ToolAdmissionApproval, right: ToolAdmissionApproval): ToolAdmissionApproval {
  return APPROVAL_RANK[right] > APPROVAL_RANK[left] ? right : left;
}
