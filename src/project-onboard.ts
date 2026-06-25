import { reviewActionPolicy, type ActionPolicyOperation, type ActionPolicyReview } from "./action-policy.js";
import { createDependencySecurityReport, type DependencySecurityReport } from "./dependency-security.js";
import { refreshDurableRepoIndex, refreshDurableSemanticIndex, searchDurableSemanticIndex } from "./durable-index-store.js";
import { lspProbe, type LspProbeResult } from "./lsp-ground-truth.js";
import { detectProjectContract, type ProjectContract } from "./project-contract.js";
import { scanRepoForSecrets, type RepoSecretScanResult } from "./safety-scan.js";
import type { SemanticRecordInput, SemanticSearchResult } from "./semantic-search.js";
import { analyzeTestImpactV2, type TestImpactV2Result } from "./test-impact-v2.js";
import { createVerificationPlan, type VerificationPlan } from "./verification-runner.js";
import type { RepoIndexSummary } from "./repo-index.js";

export type ProjectOnboardImpact = Omit<TestImpactV2Result, "likelyTests"> & {
  likelyTests: string[];
  testRecommendations: TestImpactV2Result["likelyTests"];
};

export type ProjectOnboardReport = {
  repoRoot: string;
  contract: ProjectContract;
  repoIndex: RepoIndexSummary;
  lsp: LspProbeResult;
  safety: RepoSecretScanResult;
  impact: ProjectOnboardImpact;
  verificationPlan: VerificationPlan;
  dependencySecurity: DependencySecurityReport;
  actionPolicy: ActionPolicyReview;
  semantic?: SemanticSearchResult;
  recommendations: string[];
};

export function projectOnboard(input: {
  repoRoot: string;
  changedFiles?: string[];
  diffText?: string;
  semanticRecords?: SemanticRecordInput[];
  semanticQuery?: string;
  action?: { operations: ActionPolicyOperation[] };
}): ProjectOnboardReport {
  const contract = detectProjectContract({ repoRoot: input.repoRoot });
  const repoIndex = refreshDurableRepoIndex({ repoRoot: input.repoRoot }).summary;
  const lsp = lspProbe({ repoRoot: input.repoRoot });
  const safety = scanRepoForSecrets({ repoRoot: input.repoRoot });
  const impact = analyzeTestImpactV2({
    repoRoot: input.repoRoot,
    changedFiles: input.changedFiles ?? [],
    diffText: input.diffText,
  });
  const impactForPlan = {
    ...impact,
    likelyTests: impact.likelyTests.map((test) => test.path),
  };
  const verificationPlan = createVerificationPlan({ contract, impact: impactForPlan });
  const dependencySecurity = createDependencySecurityReport({ repoRoot: input.repoRoot });
  const actionPolicy = reviewActionPolicy(input.action ?? { operations: [] });

  let semantic: SemanticSearchResult | undefined;
  if (input.semanticRecords && input.semanticRecords.length > 0) {
    refreshDurableSemanticIndex({ repoRoot: input.repoRoot, records: input.semanticRecords });
    semantic = searchDurableSemanticIndex({
      repoRoot: input.repoRoot,
      query: input.semanticQuery ?? input.semanticRecords[0]?.text ?? "",
    });
  }

  return {
    repoRoot: input.repoRoot,
    contract,
    repoIndex,
    lsp,
    safety,
    impact: {
      ...impact,
      likelyTests: impactForPlan.likelyTests,
      testRecommendations: impact.likelyTests,
    },
    verificationPlan,
    dependencySecurity,
    actionPolicy,
    semantic,
    recommendations: createRecommendations({
      impact,
      safety,
      actionPolicy,
      dependencySecurity,
    }),
  };
}

function createRecommendations(input: {
  impact: TestImpactV2Result;
  safety: RepoSecretScanResult;
  actionPolicy: ActionPolicyReview;
  dependencySecurity: DependencySecurityReport;
}): string[] {
  const recommendations = new Set<string>();
  if (input.impact.changedFiles.length > 0) {
    recommendations.add("Run focused verification before editing impacted files.");
  }
  if (input.safety.findings.length > 0) {
    recommendations.add("Resolve or intentionally ignore secret findings before sharing artifacts.");
  }
  if (input.actionPolicy.approval !== "not_required") {
    recommendations.add("Get approval before running risky actions.");
  }
  if (input.dependencySecurity.findings.some((finding) => finding.kind === "missing-lockfile")) {
    recommendations.add("Add a lockfile before relying on dependency security results.");
  }
  if (recommendations.size === 0) {
    recommendations.add("Record evidence and proceed through the normal Wormhole gate.");
  }
  return [...recommendations];
}
