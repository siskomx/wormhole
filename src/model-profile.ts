import { createHash } from "node:crypto";

export type ModelProfileMode = "fast" | "balanced" | "deep" | "ultra";
export type ModelProfileTier = "low" | "medium" | "high";
export type ModelPrivacy = "local" | "external";
export type ModelOutcomeStatus = "succeeded" | "failed" | "partial";

export type ModelProfile = {
  profileId: string;
  providerId: string;
  modelId: string;
  strengths: string[];
  modes: ModelProfileMode[];
  costTier: ModelProfileTier;
  latencyTier: ModelProfileTier;
  privacy: ModelPrivacy;
  contextWindow: number;
};

export type ModelProfileSelectInput = {
  taskType: string;
  mode: ModelProfileMode;
  requiredStrengths: string[];
  requiresPrivacy?: boolean;
  deniedProviders?: string[];
};

export type ModelProfileStats = {
  runCount: number;
  successCount: number;
  failureCount: number;
  partialCount: number;
  averageQuality: number;
  averageLatencyMs: number;
};

export type ModelProfileSelection = {
  traceId: string;
  profile: ModelProfile;
  score: number;
  reasonCodes: string[];
};

export type ModelProfileOutcomeInput = {
  traceId: string;
  status: ModelOutcomeStatus;
  latencyMs: number;
  outputQuality: number;
  notes?: string;
};

export type ModelProfileOutcome = ModelProfileOutcomeInput & {
  profileStats: ModelProfileStats;
};

export type ModelProfileTrace = {
  traceId: string;
  input: ModelProfileSelectInput;
  selectedProfileId: string;
  score: number;
  reasonCodes: string[];
  createdAt: string;
  outcome?: ModelProfileOutcomeInput;
};

export type ModelProfileRegistry = {
  register(profile: ModelProfile): ModelProfile;
  select(input: ModelProfileSelectInput): ModelProfileSelection;
  recordOutcome(input: ModelProfileOutcomeInput): ModelProfileOutcome;
  exportTraces(): string;
  snapshot(): ModelProfileRegistrySnapshot;
};

export type ModelProfileRegistrySnapshot = {
  profiles: ModelProfile[];
  statsByProfile: Array<[string, ModelProfileStats]>;
  traces: ModelProfileTrace[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cloneProfile(profile: ModelProfile): ModelProfile {
  return {
    ...profile,
    strengths: [...profile.strengths],
    modes: [...profile.modes],
  };
}

function emptyStats(): ModelProfileStats {
  return {
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    partialCount: 0,
    averageQuality: 0,
    averageLatencyMs: 0,
  };
}

function scoreProfile(
  profile: ModelProfile,
  input: ModelProfileSelectInput,
  stats: ModelProfileStats,
): { score: number; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  let score = 0;
  for (const strength of input.requiredStrengths) {
    if (profile.strengths.includes(strength)) {
      score += 10;
      reasonCodes.push(`strength:${strength}`);
    }
  }
  if (profile.modes.includes(input.mode)) {
    score += 5;
    reasonCodes.push(`mode:${input.mode}`);
  }
  if (input.requiresPrivacy && profile.privacy === "local") {
    score += 6;
    reasonCodes.push("privacy:local-required");
  }
  if (profile.latencyTier === "low" && input.mode === "fast") {
    score += 3;
    reasonCodes.push("latency:low");
  }
  if (profile.costTier === "low") {
    score += 1;
    reasonCodes.push("cost:low");
  }
  if (stats.runCount > 0) {
    score += stats.averageQuality;
    reasonCodes.push(`history:quality-${stats.averageQuality.toFixed(2)}`);
  }
  return { score, reasonCodes };
}

export function createModelProfileRegistry(
  snapshot: Partial<ModelProfileRegistrySnapshot> = {},
  onChange?: (snapshot: ModelProfileRegistrySnapshot) => void,
): ModelProfileRegistry {
  const profiles = new Map<string, ModelProfile>(
    (snapshot.profiles ?? []).map((profile) => [profile.profileId, cloneProfile(profile)]),
  );
  const statsByProfile = new Map<string, ModelProfileStats>(
    (snapshot.statsByProfile ?? []).map(([profileId, stats]) => [profileId, { ...stats }]),
  );
  const traces = new Map<string, ModelProfileTrace>(
    (snapshot.traces ?? []).map((trace) => [
      trace.traceId,
      {
        ...trace,
        input: {
          ...trace.input,
          requiredStrengths: [...trace.input.requiredStrengths],
          deniedProviders: trace.input.deniedProviders ? [...trace.input.deniedProviders] : undefined,
        },
        reasonCodes: [...trace.reasonCodes],
        outcome: trace.outcome ? { ...trace.outcome } : undefined,
      },
    ]),
  );

  function snapshotState(): ModelProfileRegistrySnapshot {
    return {
      profiles: [...profiles.values()].map(cloneProfile),
      statsByProfile: [...statsByProfile.entries()].map(([profileId, stats]) => [profileId, { ...stats }]),
      traces: [...traces.values()].map((trace) => ({
        ...trace,
        input: {
          ...trace.input,
          requiredStrengths: [...trace.input.requiredStrengths],
          deniedProviders: trace.input.deniedProviders ? [...trace.input.deniedProviders] : undefined,
        },
        reasonCodes: [...trace.reasonCodes],
        outcome: trace.outcome ? { ...trace.outcome } : undefined,
      })),
    };
  }

  function notifyChange(): void {
    onChange?.(snapshotState());
  }

  return {
    register(profile: ModelProfile): ModelProfile {
      if (profile.strengths.length === 0) {
        throw new Error("Model profile must declare at least one strength");
      }
      if (profile.modes.length === 0) {
        throw new Error("Model profile must declare at least one mode");
      }
      const registered = cloneProfile(profile);
      profiles.set(profile.profileId, registered);
      statsByProfile.set(profile.profileId, statsByProfile.get(profile.profileId) ?? emptyStats());
      notifyChange();
      return cloneProfile(registered);
    },

    select(input: ModelProfileSelectInput): ModelProfileSelection {
      const denied = new Set(input.deniedProviders ?? []);
      const candidates = [...profiles.values()].filter((profile) => {
        if (denied.has(profile.providerId)) {
          return false;
        }
        if (input.requiresPrivacy && profile.privacy !== "local") {
          return false;
        }
        return input.requiredStrengths.every((strength) => profile.strengths.includes(strength));
      });
      if (candidates.length === 0) {
        throw new Error("No model profile satisfies task requirements");
      }
      const ranked = candidates
        .map((profile) => ({
          profile,
          ...scoreProfile(profile, input, statsByProfile.get(profile.profileId) ?? emptyStats()),
        }))
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          return left.profile.profileId.localeCompare(right.profile.profileId);
        });
      const selected = ranked[0];
      if (!selected) {
        throw new Error("No model profile satisfies task requirements");
      }
      const traceSeed = JSON.stringify({
        input,
        selectedProfileId: selected.profile.profileId,
        score: selected.score,
        traceIndex: traces.size,
      });
      const traceId = `route:sha256:${sha256(traceSeed)}`;
      traces.set(traceId, {
        traceId,
        input: {
          ...input,
          requiredStrengths: [...input.requiredStrengths],
          deniedProviders: input.deniedProviders ? [...input.deniedProviders] : undefined,
        },
        selectedProfileId: selected.profile.profileId,
        score: selected.score,
        reasonCodes: [...selected.reasonCodes],
        createdAt: new Date().toISOString(),
      });
      notifyChange();
      return {
        traceId,
        profile: cloneProfile(selected.profile),
        score: selected.score,
        reasonCodes: [...selected.reasonCodes],
      };
    },

    recordOutcome(input: ModelProfileOutcomeInput): ModelProfileOutcome {
      const trace = traces.get(input.traceId);
      if (!trace) {
        throw new Error(`Model profile trace not found: ${input.traceId}`);
      }
      trace.outcome = { ...input };
      const stats = statsByProfile.get(trace.selectedProfileId) ?? emptyStats();
      const nextRunCount = stats.runCount + 1;
      const nextAverageQuality =
        (stats.averageQuality * stats.runCount + input.outputQuality) / nextRunCount;
      const nextAverageLatencyMs =
        (stats.averageLatencyMs * stats.runCount + input.latencyMs) / nextRunCount;
      const updated: ModelProfileStats = {
        runCount: nextRunCount,
        successCount: stats.successCount + (input.status === "succeeded" ? 1 : 0),
        failureCount: stats.failureCount + (input.status === "failed" ? 1 : 0),
        partialCount: stats.partialCount + (input.status === "partial" ? 1 : 0),
        averageQuality: nextAverageQuality,
        averageLatencyMs: nextAverageLatencyMs,
      };
      statsByProfile.set(trace.selectedProfileId, updated);
      notifyChange();
      return {
        ...input,
        profileStats: { ...updated },
      };
    },

    exportTraces(): string {
      return JSON.stringify([...traces.values()], null, 2);
    },

    snapshot: snapshotState,
  };
}
