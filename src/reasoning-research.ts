export type ReasoningStrategy = "plan-first" | "critique-revise" | "verify-repair";

export type ReasoningTrace = {
  traceId: string;
  strategy: ReasoningStrategy;
  taskKind: string;
  planSummary: string;
  critiqueSummary?: string;
  revisionSummary?: string;
  verifierSummary?: string;
  evidenceReferenced: number;
  evidenceAvailable: number;
  openQuestionsResolved: number;
  openQuestionsRemaining: number;
  outcome: "succeeded" | "partial" | "failed";
  userCorrections: number;
};

export type ReasoningScore = {
  total: number;
  evidenceCoverage: number;
  questionResolution: number;
  reasoningStructure: number;
  outcomeScore: number;
  correctionPenalty: number;
};

export type ScoredReasoningTrace = ReasoningTrace & {
  score: ReasoningScore;
};

export type ReasoningStrategySummary = {
  strategy: ReasoningStrategy;
  sampleCount: number;
  averageScore: number;
  successRate: number;
  recommended: boolean;
};

export type ReasoningResearchStore = {
  record(trace: ReasoningTrace): ScoredReasoningTrace;
  exportJsonl(): string;
  evaluateStrategies(): ReasoningStrategySummary[];
};

function bounded(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function evidenceCoverage(trace: ReasoningTrace): number {
  if (trace.evidenceAvailable <= 0) {
    return 1;
  }
  return bounded(trace.evidenceReferenced / trace.evidenceAvailable);
}

function questionResolution(trace: ReasoningTrace): number {
  const total = trace.openQuestionsResolved + trace.openQuestionsRemaining;
  if (total <= 0) {
    return 1;
  }
  return bounded(trace.openQuestionsResolved / total);
}

function reasoningStructure(trace: ReasoningTrace): number {
  const hasPlan = trace.planSummary.trim().length > 0 ? 1 : 0;
  if (trace.strategy === "plan-first") {
    return hasPlan;
  }

  if (trace.strategy === "critique-revise") {
    const hasCritique = trace.critiqueSummary?.trim() ? 1 : 0;
    const hasRevision = trace.revisionSummary?.trim() ? 1 : 0;
    const hasVerifier = trace.verifierSummary?.trim() ? 1 : 0;
    return (hasPlan + hasCritique + hasRevision + hasVerifier) / 4;
  }

  const hasRevision = trace.revisionSummary?.trim() ? 1 : 0;
  const hasVerifier = trace.verifierSummary?.trim() ? 1 : 0;
  return (hasPlan + hasRevision + hasVerifier) / 3;
}

function outcomeScore(trace: ReasoningTrace): number {
  if (trace.outcome === "succeeded") {
    return 1;
  }
  if (trace.outcome === "partial") {
    return 0.65;
  }
  return 0;
}

export function scoreReasoningTrace(trace: ReasoningTrace): ReasoningScore {
  const coverage = evidenceCoverage(trace);
  const questions = questionResolution(trace);
  const structure = bounded(reasoningStructure(trace));
  const outcome = outcomeScore(trace);
  const penalty = bounded(trace.userCorrections / 5) * 0.3;
  const total = bounded(
    coverage * 0.3 +
      questions * 0.2 +
      structure * 0.2 +
      outcome * 0.3 -
      penalty,
  );

  return {
    total: rounded(total),
    evidenceCoverage: rounded(coverage),
    questionResolution: rounded(questions),
    reasoningStructure: rounded(structure),
    outcomeScore: rounded(outcome),
    correctionPenalty: rounded(penalty),
  };
}

export function createReasoningResearchStore(): ReasoningResearchStore {
  const traces: ScoredReasoningTrace[] = [];

  return {
    record(trace) {
      const scored = {
        ...trace,
        score: scoreReasoningTrace(trace),
      };
      traces.push(scored);
      return { ...scored, score: { ...scored.score } };
    },

    exportJsonl() {
      return traces.map((trace) => JSON.stringify(trace)).join("\n");
    },

    evaluateStrategies() {
      const byStrategy = new Map<ReasoningStrategy, ScoredReasoningTrace[]>();
      for (const trace of traces) {
        byStrategy.set(trace.strategy, [...(byStrategy.get(trace.strategy) ?? []), trace]);
      }

      const summaries = [...byStrategy.entries()].map(([strategy, samples]) => {
        const averageScore = samples.reduce((sum, sample) => sum + sample.score.total, 0) / samples.length;
        const successes = samples.filter((sample) => sample.outcome === "succeeded").length;
        return {
          strategy,
          sampleCount: samples.length,
          averageScore: rounded(averageScore),
          successRate: rounded(successes / samples.length),
          recommended: false,
        };
      }).sort(
        (left, right) =>
          right.averageScore - left.averageScore ||
          right.successRate - left.successRate ||
          left.strategy.localeCompare(right.strategy),
      );

      const best = summaries[0];
      if (best && best.sampleCount >= 2) {
        best.recommended = true;
      }

      return summaries;
    },
  };
}
