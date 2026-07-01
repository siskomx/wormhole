import { describe, expect, it } from "vitest";
import {
  evaluateEvidenceRequirements,
  listEvidenceRequirements,
  type EvidenceRequirement,
  type EvidenceRequirementId,
} from "../src/evidence-requirements.js";

describe("evidence requirements", () => {
  it("lists cloned requirement definitions with stable ids", () => {
    const requirements = listEvidenceRequirements();
    const ids: EvidenceRequirementId[] = requirements.map((requirement) => requirement.id);

    expect(ids).toEqual(
      expect.arrayContaining(["relation_paths", "repo_facts_fresh", "verification_output"]),
    );

    const mutable = requirements.find((requirement) => requirement.id === "relation_paths") as
      | EvidenceRequirement
      | undefined;
    expect(mutable).toBeDefined();
    if (mutable) {
      (mutable.recommendedTools as string[]).push("ghost_tool");
    }

    expect(
      listEvidenceRequirements()
        .find((requirement) => requirement.id === "relation_paths")
        ?.recommendedTools,
    ).not.toContain("ghost_tool");
  });

  it("satisfies relation_paths with repo_relation_query", () => {
    const evaluation = evaluateEvidenceRequirements({
      required: ["relation_paths"],
      completedTools: ["repo_relation_query"],
    });

    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.requirements[0]).toMatchObject({
      id: "relation_paths",
      satisfied: true,
      satisfiedBy: ["tool:repo_relation_query"],
    });
  });

  it("satisfies relation_paths with change_impact_analyze", () => {
    const evaluation = evaluateEvidenceRequirements({
      required: ["relation_paths"],
      evidence: [{ kind: "change_impact", toolName: "change_impact_analyze" }],
    });

    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.requirements[0]).toMatchObject({
      id: "relation_paths",
      satisfied: true,
      satisfiedBy: ["tool:change_impact_analyze", "evidence:change_impact"],
    });
  });

  it("satisfies repo_facts_fresh only when refresh tool and fresh fact evidence are both present", () => {
    expect(
      evaluateEvidenceRequirements({
        required: ["repo_facts_fresh"],
        completedTools: ["durable_repo_index_refresh"],
      }).satisfied,
    ).toBe(false);

    expect(
      evaluateEvidenceRequirements({
        required: ["repo_facts_fresh"],
        evidence: [{ kind: "repo_facts", freshness: "fresh" }],
      }).satisfied,
    ).toBe(false);

    expect(
      evaluateEvidenceRequirements({
        required: ["repo_facts_fresh"],
        completedTools: ["durable_repo_index_refresh"],
        evidence: [{ kind: "repo_facts", freshness: "stale" }],
      }).satisfied,
    ).toBe(false);

    const evaluation = evaluateEvidenceRequirements({
      required: ["repo_facts_fresh"],
      completedTools: ["durable_repo_index_refresh"],
      evidence: [{ kind: "repo_facts", freshness: "fresh" }],
    });

    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.requirements[0]).toMatchObject({
      id: "repo_facts_fresh",
      satisfied: true,
      satisfiedBy: ["tool:durable_repo_index_refresh", "evidence:repo_facts:fresh"],
    });
  });

  it("recommends test planning and verification when verification_output is missing", () => {
    const evaluation = evaluateEvidenceRequirements({
      required: ["verification_output"],
      evidence: [{ kind: "source_paths" }],
    });

    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.missingRequirements).toEqual(["verification_output"]);
    expect(evaluation.recommendedTools).toEqual(["test_plan_select", "verification_run"]);
    expect(evaluation.requirements[0]).toMatchObject({
      id: "verification_output",
      satisfied: false,
      recommendedTools: ["test_plan_select", "verification_run"],
    });
  });
});
