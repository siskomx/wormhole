import { getToolProfile, type ToolCapabilityProfile, type ToolProfileId } from "./tool-profiles.js";
import {
  TOOL_REGISTRY,
  reviewToolAdmission,
  type ToolAdmissionReview,
  type ToolPack,
  type ToolPhase,
  type ToolPlane,
  type ToolRegistryEntry,
  type ToolRisk,
} from "./tool-registry.js";

export type ToolPromotionFilters = {
  plane?: ToolPlane;
  phase?: ToolPhase;
  pack?: ToolPack;
  risk?: ToolRisk;
};

export type ToolSearchForPromotionInput = ToolPromotionFilters & {
  profileId?: ToolProfileId;
  query?: string;
  objective?: string;
  toolNames?: string[];
  limit?: number;
  allowOutOfProfile?: boolean;
  overrideReason?: string;
  registry?: ToolRegistryEntry[];
};

export type ToolPromotionSearchInput = ToolSearchForPromotionInput;

export type ToolPromotionCandidate = {
  tool: ToolRegistryEntry;
  score: number;
  matchedTerms: string[];
  profileAllowed: boolean;
  bootstrap: boolean;
  requested: boolean;
};

export type HiddenToolPromotion = {
  toolName: string;
  requested: boolean;
  reason: string;
  profileId?: ToolProfileId;
  tool?: ToolRegistryEntry;
};

export type ToolPromotionSearchResult = {
  profile?: ToolCapabilityProfile;
  profileId?: ToolProfileId;
  objective?: string;
  query?: string;
  filters: ToolPromotionFilters;
  candidates: ToolPromotionCandidate[];
  promotedTools: ToolPromotionCandidate[];
  hiddenTools: HiddenToolPromotion[];
  unknownTools: string[];
  warnings: string[];
  recoveryTools: string[];
  hiddenRequestedToolCount: number;
  outOfProfileToolCount: number;
};

export type ToolPromotionReviewInput = ToolPromotionSearchInput;

export type ToolPromotionReview = ToolPromotionSearchResult & {
  admission: ToolAdmissionReview;
};

export type ToolPromotionScope = {
  missionId?: string;
  sessionId?: string;
};

export type ToolPromotionRecordInput = ToolPromotionReviewInput & {
  missionId?: string;
  sessionId?: string;
  sequence?: number;
  createdAt?: string;
};

export type ToolPromotionRecord = ToolPromotionReview & {
  promotionId: string;
  createdAt: string;
  scope: ToolPromotionScope;
  objective?: string;
  query?: string;
};

type ScoredTool = {
  tool: ToolRegistryEntry;
  score: number;
  matchedTerms: string[];
  registryIndex: number;
  requestedIndex: number;
  requested: boolean;
  profileAllowed: boolean;
  bootstrap: boolean;
};

const FALLBACK_RECOVERY_TOOLS = ["tool_catalog_query", "tool_admission_review"] as const;

export function searchToolsForPromotion(
  input: ToolSearchForPromotionInput = {},
  registry: ToolRegistryEntry[] = TOOL_REGISTRY,
): ToolPromotionSearchResult {
  const activeRegistry = input.registry ?? registry;
  const profile = input.profileId ? getToolProfile(input.profileId) : undefined;
  const registryByName = new Map(activeRegistry.map((tool, index) => [tool.name, { tool, index }]));
  const requestedToolNames = input.toolNames
    ? uniqueInOrder(input.toolNames.map((toolName) => toolName.trim()).filter(Boolean))
    : [];
  const hasRequestedToolNames = requestedToolNames.length > 0;
  const unknownTools = hasRequestedToolNames
    ? requestedToolNames.filter((toolName) => !registryByName.has(toolName))
    : [];
  const filters = promotionFilters(input);
  const terms = tokenize(`${input.query ?? ""} ${input.objective ?? ""}`);
  const sourceTools = hasRequestedToolNames
    ? requestedToolNames.flatMap((toolName, requestedIndex): ScoredTool[] => {
        const entry = registryByName.get(toolName);
        if (!entry || !matchesFilters(entry.tool, filters)) {
          return [];
        }
        return [
          scoreTool({
            tool: entry.tool,
            terms,
            profile,
            registryIndex: entry.index,
            requestedIndex,
            requested: true,
          }),
        ];
      })
    : activeRegistry
        .map((tool, registryIndex) =>
          scoreTool({
            tool,
            terms,
            profile,
            registryIndex,
            requestedIndex: registryIndex,
            requested: false,
          }),
        )
        .filter((candidate) => matchesFilters(candidate.tool, filters))
        .filter((candidate) => terms.length === 0 || candidate.matchedTerms.length > 0);

  const overrideReason = input.overrideReason?.trim() ?? "";
  const acceptsOutOfProfile = Boolean(profile && input.allowOutOfProfile && overrideReason);
  const warnings: string[] = [];
  const hiddenTools: HiddenToolPromotion[] = [];
  const acceptedCandidates: ScoredTool[] = [];
  let outOfProfileToolCount = 0;

  for (const candidate of sourceTools) {
    if (!profile || candidate.profileAllowed) {
      acceptedCandidates.push(candidate);
      continue;
    }

    outOfProfileToolCount += 1;
    if (acceptsOutOfProfile) {
      acceptedCandidates.push(candidate);
      continue;
    }

    hiddenTools.push({
      toolName: candidate.tool.name,
      requested: candidate.requested,
      reason: outOfProfileReason(profile.profileId),
      profileId: profile.profileId,
      tool: cloneTool(candidate.tool),
    });
  }

  if (profile && input.allowOutOfProfile && outOfProfileToolCount > 0) {
    if (overrideReason) {
      warnings.push(`Out-of-profile override accepted for ${profile.profileId}: ${overrideReason}`);
    } else {
      warnings.push("allowOutOfProfile requires a non-empty overrideReason; out-of-profile tools remain hidden.");
    }
  }

  const orderedCandidates = hasRequestedToolNames
    ? [...acceptedCandidates].sort((left, right) => left.requestedIndex - right.requestedIndex)
    : [...acceptedCandidates].sort(
        (left, right) => right.score - left.score || left.registryIndex - right.registryIndex,
      );
  const limitedCandidates = applyLimit(orderedCandidates, input.limit);
  const candidates = limitedCandidates.map(toPromotionCandidate);

  return {
    ...(profile ? { profile: cloneProfile(profile) } : {}),
    ...(profile ? { profileId: profile.profileId } : {}),
    ...(input.objective !== undefined ? { objective: input.objective } : {}),
    ...(input.query !== undefined ? { query: input.query } : {}),
    filters,
    candidates,
    promotedTools: candidates.map(cloneCandidate),
    hiddenTools,
    unknownTools,
    warnings,
    recoveryTools: profile ? [...profile.recoveryTools] : [...FALLBACK_RECOVERY_TOOLS],
    hiddenRequestedToolCount: hiddenTools.filter((tool) => tool.requested).length,
    outOfProfileToolCount,
  };
}

export function reviewToolPromotion(
  input: ToolPromotionReviewInput = {},
  registry: ToolRegistryEntry[] = TOOL_REGISTRY,
): ToolPromotionReview {
  const activeRegistry = input.registry ?? registry;
  const search = searchToolsForPromotion(input, activeRegistry);
  return {
    ...search,
    admission: reviewToolAdmission(
      { toolNames: search.promotedTools.map((candidate) => candidate.tool.name) },
      activeRegistry,
    ),
  };
}

export function createToolPromotionRecord(input: ToolPromotionRecordInput): ToolPromotionRecord {
  const sequence = input.sequence ?? 1;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const review = reviewToolPromotion(input, input.registry ?? TOOL_REGISTRY);
  const missionPart = normalizeScopePart(input.missionId);
  const sessionPart = normalizeScopePart(input.sessionId);

  return {
    ...review,
    promotionId: `tool-promotion-${missionPart}-${sessionPart}-${sequence}`,
    createdAt,
    scope: {
      ...(input.missionId !== undefined ? { missionId: input.missionId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    },
    ...(input.objective !== undefined ? { objective: input.objective } : {}),
    ...(input.query !== undefined ? { query: input.query } : {}),
    promotedTools: review.promotedTools.map(cloneCandidate),
  };
}

function scoreTool(input: {
  tool: ToolRegistryEntry;
  terms: string[];
  profile: ToolCapabilityProfile | undefined;
  registryIndex: number;
  requestedIndex: number;
  requested: boolean;
}): ScoredTool {
  const allowedTools = input.profile ? new Set(input.profile.allowedTools) : undefined;
  const bootstrapTools = input.profile ? new Set(input.profile.bootstrapTools) : undefined;
  const profileAllowed = allowedTools ? allowedTools.has(input.tool.name) : true;
  const bootstrap = bootstrapTools ? bootstrapTools.has(input.tool.name) : false;
  let score = input.terms.length === 0 ? 1 : 0;
  const matchedTerms = new Set<string>();

  for (const term of input.terms) {
    const termScore = scoreTerm(input.tool, term);
    if (termScore > 0) {
      matchedTerms.add(term);
      score += termScore;
    }
  }

  if (input.profile) {
    if (profileAllowed) {
      score += 25;
    }
    if (bootstrap) {
      score += 50;
    }
  }

  return {
    tool: input.tool,
    score,
    matchedTerms: [...matchedTerms],
    registryIndex: input.registryIndex,
    requestedIndex: input.requestedIndex,
    requested: input.requested,
    profileAllowed,
    bootstrap,
  };
}

function scoreTerm(tool: ToolRegistryEntry, term: string): number {
  let score = 0;
  const nameTerms = searchableTerms([tool.name]);
  const summaryTerms = searchableTerms([tool.summary]);
  const inputTerms = searchableTerms(tool.inputs);
  const metadataTerms = searchableTerms([tool.plane, tool.phase, tool.pack, tool.risk]);
  const exactCompoundWeight = term.includes("-") || term.includes("_");

  if (nameTerms.has(term)) {
    score += exactCompoundWeight ? 30 : 10;
  }
  if (summaryTerms.has(term)) {
    score += 4;
  }
  if (inputTerms.has(term)) {
    score += 2;
  }
  if (metadataTerms.has(term)) {
    score += exactCompoundWeight ? 30 : 3;
  }

  return score;
}

function toPromotionCandidate(candidate: ScoredTool): ToolPromotionCandidate {
  return {
    tool: cloneTool(candidate.tool),
    score: candidate.score,
    matchedTerms: [...candidate.matchedTerms],
    profileAllowed: candidate.profileAllowed,
    bootstrap: candidate.bootstrap,
    requested: candidate.requested,
  };
}

function promotionFilters(input: ToolPromotionFilters): ToolPromotionFilters {
  return {
    ...(input.plane !== undefined ? { plane: input.plane } : {}),
    ...(input.phase !== undefined ? { phase: input.phase } : {}),
    ...(input.pack !== undefined ? { pack: input.pack } : {}),
    ...(input.risk !== undefined ? { risk: input.risk } : {}),
  };
}

function matchesFilters(tool: ToolRegistryEntry, filters: ToolPromotionFilters): boolean {
  return (
    (!filters.plane || tool.plane === filters.plane) &&
    (!filters.phase || tool.phase === filters.phase) &&
    (!filters.pack || tool.pack === filters.pack) &&
    (!filters.risk || tool.risk === filters.risk)
  );
}

function tokenize(value: string): string[] {
  return [...searchableTerms([value])];
}

function searchableTerms(values: readonly string[]): Set<string> {
  const terms = new Set<string>();
  for (const value of values) {
    for (const chunk of normalizedSearchChunks(value)) {
      terms.add(chunk);
      for (const part of chunk.split(/[_-]+/).filter(Boolean)) {
        terms.add(part);
      }
    }
  }
  return terms;
}

function normalizedSearchChunks(value: string): string[] {
  return (
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z0-9_-]+/g) ?? []
  );
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    uniqueValues.push(value);
  }
  return uniqueValues;
}

function applyLimit(candidates: ScoredTool[], limit: number | undefined): ScoredTool[] {
  if (!limit || limit < 1) {
    return candidates;
  }
  return candidates.slice(0, limit);
}

function cloneTool(tool: ToolRegistryEntry): ToolRegistryEntry {
  return {
    ...tool,
    inputs: [...tool.inputs],
  };
}

function cloneCandidate(candidate: ToolPromotionCandidate): ToolPromotionCandidate {
  return {
    ...candidate,
    tool: cloneTool(candidate.tool),
    matchedTerms: [...candidate.matchedTerms],
  };
}

function cloneProfile(profile: ToolCapabilityProfile): ToolCapabilityProfile {
  return {
    ...profile,
    bootstrapTools: [...profile.bootstrapTools],
    allowedTools: [...profile.allowedTools],
    requiredEvidence: [...profile.requiredEvidence],
    verificationGates: [...profile.verificationGates],
    recoveryTools: [...profile.recoveryTools],
  };
}

function outOfProfileReason(profileId: ToolProfileId): string {
  return `Tool is outside profile ${profileId}. Pass allowOutOfProfile with overrideReason to include it.`;
}

function normalizeScopePart(value: string | undefined): string {
  const normalized = (value ?? "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
  return normalized || "none";
}
