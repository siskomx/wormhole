import { createDenseSummary, reviewMinimality, type OptimizationFinding } from "./optimization.js";

export type BrevityMode = "normal" | "dense" | "ultra";
export type MinimalityMode = "off" | "review" | "strict";

export type BehaviorMode = {
  brevity: BrevityMode;
  minimality: MinimalityMode;
};

export type BehaviorApplyResult = {
  text: string;
  estimatedTokensSaved: number;
};

export type BehaviorMinimalityResult = {
  text: string;
  findings: OptimizationFinding[];
};

export type BehaviorPolicyStore = {
  setMode(input: Partial<BehaviorMode>): BehaviorMode;
  getMode(): BehaviorMode;
  apply(input: { text: string }): BehaviorApplyResult;
  reviewMinimality(input: { objective: string; planSteps: string[] }): BehaviorMinimalityResult;
};

function cloneMode(mode: BehaviorMode): BehaviorMode {
  return {
    brevity: mode.brevity,
    minimality: mode.minimality,
  };
}

function extractLiterals(text: string): string[] {
  return [...text.matchAll(/`[^`]+`/g)].map(([literal]) => literal);
}

function summarize(inputText: string, brevity: BrevityMode): ReturnType<typeof createDenseSummary> {
  if (brevity === "normal") {
    return createDenseSummary({ text: inputText, maxBullets: 8, maxBulletLength: 200 });
  }
  if (brevity === "ultra") {
    return createDenseSummary({ text: inputText, maxBullets: 3, maxBulletLength: 80 });
  }
  return createDenseSummary({ text: inputText, maxBullets: 5, maxBulletLength: 120 });
}

function preserveBacktickLiterals(summaryText: string, originalText: string): string {
  const literals = [...new Set(extractLiterals(originalText))];
  if (literals.length === 0) {
    return summaryText;
  }

  const missing = literals.filter((literal) => !summaryText.includes(literal));
  if (missing.length === 0) {
    return summaryText;
  }

  const suffix = missing.map((literal) => `- literal: ${literal}`).join("\n");
  return `${summaryText}\n${suffix}`.trim();
}

export function createBehaviorPolicyStore(
  initialMode?: Partial<BehaviorMode>,
  onChange?: (mode: BehaviorMode) => void,
): BehaviorPolicyStore {
  let mode: BehaviorMode = {
    brevity: initialMode?.brevity ?? "normal",
    minimality: initialMode?.minimality ?? "review",
  };

  return {
    setMode(input: Partial<BehaviorMode>): BehaviorMode {
      mode = {
        brevity: input.brevity ?? mode.brevity,
        minimality: input.minimality ?? mode.minimality,
      };
      onChange?.(cloneMode(mode));
      return cloneMode(mode);
    },

    getMode(): BehaviorMode {
      return cloneMode(mode);
    },

    apply(input: { text: string }): BehaviorApplyResult {
      if (mode.brevity === "normal") {
        return {
          text: input.text,
          estimatedTokensSaved: 0,
        };
      }

      const summary = summarize(input.text, mode.brevity);
      return {
        text: preserveBacktickLiterals(summary.content, input.text),
        estimatedTokensSaved: summary.estimatedTokensSaved ?? 0,
      };
    },

    reviewMinimality(input: { objective: string; planSteps: string[] }): BehaviorMinimalityResult {
      if (mode.minimality === "off") {
        return {
          text: "- low: Minimality review is off.",
          findings: [],
        };
      }

      const result = reviewMinimality(input);
      return {
        text: result.content,
        findings: result.findings ?? [],
      };
    },
  };
}
