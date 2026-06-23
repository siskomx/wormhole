export type RoutingLevel = "low" | "medium" | "high";
export type RepoSize = "small" | "medium" | "large";
export type RoutingMode = "fast" | "balanced" | "deep";

export type ModelDescriptor = {
  providerId: string;
  modelId: string;
  strengths: string[];
  maxDepth: 1 | 2 | 3 | 4;
  costTier: "low" | "medium" | "high";
  privacy: "local" | "external";
};

export type ProviderRegistry = {
  models: ModelDescriptor[];
};

export type RoutingInput = {
  taskCategory: string;
  ambiguity: RoutingLevel;
  risk: RoutingLevel;
  repoSize: RepoSize;
  requiresPrivacy: boolean;
};

export type RejectedModel = {
  providerId: string;
  modelId: string;
  reason: string;
};

export type RoutingPlan = {
  mode: RoutingMode;
  maxDepth: 1 | 2 | 3 | 4;
  verifierCount: number;
  selectedModel: ModelDescriptor;
  rejectedModels: RejectedModel[];
  reasons: string[];
};

export function createProviderRegistry(models: ModelDescriptor[]): ProviderRegistry {
  return { models };
}

function desiredMode(input: RoutingInput): RoutingMode {
  if (input.risk === "high" || input.ambiguity === "high" || input.repoSize === "large") {
    return "deep";
  }
  if (input.risk === "medium" || input.ambiguity === "medium" || input.repoSize === "medium") {
    return "balanced";
  }
  return "fast";
}

function requiredDepth(mode: RoutingMode): 1 | 2 | 3 | 4 {
  if (mode === "deep") {
    return 4;
  }
  if (mode === "balanced") {
    return 3;
  }
  return 2;
}

function scoreModel(model: ModelDescriptor, input: RoutingInput): number {
  let score = model.maxDepth * 10;
  if (model.strengths.includes("planning")) {
    score += 5;
  }
  if (model.strengths.includes("review")) {
    score += input.risk === "high" ? 8 : 3;
  }
  if (model.strengths.includes("coding")) {
    score += 4;
  }
  if (model.strengths.includes(input.taskCategory)) {
    score += 6;
  }
  if (model.costTier === "low" && input.risk === "low") {
    score += 3;
  }
  return score;
}

export function selectRoutingPlan(input: RoutingInput, registry: ProviderRegistry): RoutingPlan {
  const rejectedModels: RejectedModel[] = [];
  const privacyFiltered = registry.models.filter((model) => {
    if (input.requiresPrivacy && model.privacy !== "local") {
      rejectedModels.push({
        providerId: model.providerId,
        modelId: model.modelId,
        reason: "privacy requirement",
      });
      return false;
    }
    return true;
  });
  if (privacyFiltered.length === 0) {
    throw new Error("No model satisfies routing constraints");
  }

  const mode = desiredMode(input);
  const targetDepth = requiredDepth(mode);
  const selectedModel = [...privacyFiltered].sort(
    (left, right) => scoreModel(right, input) - scoreModel(left, input),
  )[0]!;
  const maxDepth = Math.min(targetDepth, selectedModel.maxDepth) as 1 | 2 | 3 | 4;

  return {
    mode,
    maxDepth,
    verifierCount: mode === "deep" ? 2 : mode === "balanced" ? 1 : 0,
    selectedModel,
    rejectedModels,
    reasons: [
      `Selected ${mode} mode for ${input.risk} risk, ${input.ambiguity} ambiguity, ${input.repoSize} repo.`,
      `Selected model ${selectedModel.providerId}/${selectedModel.modelId}.`,
    ],
  };
}
