import { randomUUID } from "node:crypto";

export type AgentTransport =
  | "mcp-stdio"
  | "mcp-http"
  | "http"
  | "cli"
  | "sdk"
  | "provider-api";

export type AgentInstallation = "available" | "installed" | "disabled";
export type AgentAuthentication = "on_install" | "on_use" | "none";
export type AgentRunStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export type AgentDescriptor = {
  agentId: string;
  displayName: string;
  target: string;
  transport: AgentTransport;
  capabilities: string[];
  installation: AgentInstallation;
  authentication: AgentAuthentication;
  maxConcurrentTasks: number;
  supportsInterrupt: boolean;
  runtime?: {
    command?: string;
    args?: string[];
    endpoint?: string;
    method?: "POST" | "PUT" | "PATCH";
    timeoutMs?: number;
  };
};

export type AgentDispatchInput = {
  missionId: string;
  taskId: string;
  objective: string;
  requiredCapabilities: string[];
  preferredTargets?: string[];
  payload?: unknown;
  timeoutMs?: number;
};

export type AgentRunResult = {
  status: "completed" | "failed";
  summary: string;
  evidenceIds?: string[];
  artifactIds?: string[];
  output?: unknown;
};

export type AgentRunRecord = AgentDispatchInput & {
  runId: string;
  assignedAgentId: string;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
  result?: AgentRunResult;
  interruptReason?: string;
};

export type AgentRegistry = {
  register(agent: AgentDescriptor): AgentDescriptor;
  list(): AgentDescriptor[];
  dispatch(input: AgentDispatchInput): AgentRunRecord;
  status(runId: string): AgentRunRecord;
  complete(runId: string, result: AgentRunResult): AgentRunRecord;
  interrupt(runId: string, reason: string): AgentRunRecord;
  snapshot(): AgentRegistrySnapshot;
};

export type AgentRegistrySnapshot = {
  agents: AgentDescriptor[];
  runs: AgentRunRecord[];
};

function activeRunCount(agentId: string, runs: AgentRunRecord[]): number {
  return runs.filter(
    (run) =>
      run.assignedAgentId === agentId &&
      (run.status === "queued" || run.status === "running"),
  ).length;
}

function canRunTask(
  agent: AgentDescriptor,
  input: AgentDispatchInput,
  runs: AgentRunRecord[],
): boolean {
  if (agent.installation === "disabled") {
    return false;
  }
  if (
    input.preferredTargets &&
    input.preferredTargets.length > 0 &&
    !input.preferredTargets.includes(agent.target)
  ) {
    return false;
  }
  if (!input.requiredCapabilities.every((capability) => agent.capabilities.includes(capability))) {
    return false;
  }
  return activeRunCount(agent.agentId, runs) < agent.maxConcurrentTasks;
}

function cloneRun(run: AgentRunRecord): AgentRunRecord {
  return {
    ...run,
    requiredCapabilities: [...run.requiredCapabilities],
    preferredTargets: run.preferredTargets ? [...run.preferredTargets] : undefined,
    result: run.result
      ? {
          ...run.result,
          evidenceIds: run.result.evidenceIds ? [...run.result.evidenceIds] : undefined,
          artifactIds: run.result.artifactIds ? [...run.result.artifactIds] : undefined,
        }
      : undefined,
  };
}

export function createAgentRegistry(
  snapshot: Partial<AgentRegistrySnapshot> = {},
  onChange?: (snapshot: AgentRegistrySnapshot) => void,
): AgentRegistry {
  const agents = new Map<string, AgentDescriptor>(
    (snapshot.agents ?? []).map((agent) => [agent.agentId, { ...agent, capabilities: [...agent.capabilities] }]),
  );
  const runs = new Map<string, AgentRunRecord>(
    (snapshot.runs ?? []).map((run) => [run.runId, cloneRun(run)]),
  );

  function snapshotState(): AgentRegistrySnapshot {
    return {
      agents: [...agents.values()].map((agent) => ({ ...agent, capabilities: [...agent.capabilities] })),
      runs: [...runs.values()].map(cloneRun),
    };
  }

  function notifyChange(): void {
    onChange?.(snapshotState());
  }

  function getRun(runId: string): AgentRunRecord {
    const run = runs.get(runId);
    if (!run) {
      throw new Error(`Agent run not found: ${runId}`);
    }
    return run;
  }

  return {
    register(agent: AgentDescriptor): AgentDescriptor {
      if (agent.maxConcurrentTasks < 1) {
        throw new Error("Agent maxConcurrentTasks must be at least 1");
      }
      if (agent.capabilities.length === 0) {
        throw new Error("Agent must declare at least one capability");
      }
      const registered = {
        ...agent,
        capabilities: [...agent.capabilities],
      };
      agents.set(agent.agentId, registered);
      notifyChange();
      return { ...registered, capabilities: [...registered.capabilities] };
    },

    list(): AgentDescriptor[] {
      return [...agents.values()].map((agent) => ({
        ...agent,
        capabilities: [...agent.capabilities],
      }));
    },

    dispatch(input: AgentDispatchInput): AgentRunRecord {
      const currentRuns = [...runs.values()];
      const agent = [...agents.values()].find((candidate) =>
        canRunTask(candidate, input, currentRuns),
      );
      if (!agent) {
        throw new Error("No available agent satisfies task requirements");
      }
      const now = new Date().toISOString();
      const run: AgentRunRecord = {
        ...input,
        requiredCapabilities: [...input.requiredCapabilities],
        preferredTargets: input.preferredTargets ? [...input.preferredTargets] : undefined,
        runId: randomUUID(),
        assignedAgentId: agent.agentId,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      };
      runs.set(run.runId, run);
      notifyChange();
      return cloneRun(run);
    },

    status(runId: string): AgentRunRecord {
      return cloneRun(getRun(runId));
    },

    complete(runId: string, result: AgentRunResult): AgentRunRecord {
      const run = getRun(runId);
      if (run.status === "interrupted") {
        throw new Error("Cannot complete interrupted agent run");
      }
      run.status = result.status;
      run.result = {
        ...result,
        evidenceIds: result.evidenceIds ? [...result.evidenceIds] : undefined,
        artifactIds: result.artifactIds ? [...result.artifactIds] : undefined,
      };
      run.updatedAt = new Date().toISOString();
      notifyChange();
      return cloneRun(run);
    },

    interrupt(runId: string, reason: string): AgentRunRecord {
      const run = getRun(runId);
      const agent = agents.get(run.assignedAgentId);
      if (!agent) {
        throw new Error(`Agent not found: ${run.assignedAgentId}`);
      }
      if (!agent.supportsInterrupt) {
        throw new Error("Agent does not support interrupts");
      }
      run.status = "interrupted";
      run.interruptReason = reason;
      run.updatedAt = new Date().toISOString();
      notifyChange();
      return cloneRun(run);
    },

    snapshot: snapshotState,
  };
}
