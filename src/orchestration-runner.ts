import { randomUUID } from "node:crypto";
import {
  createDagSchedule,
  runDynamicDagSchedule,
  type DagSchedule,
  type DynamicTaskRunResult,
  type ScheduledTask,
  type TaskRunResult,
} from "./scheduler.js";

export type LocalOrchestrationInput = {
  missionId: string;
  tasks: ScheduledTask[];
  maxDepth: 1 | 2 | 3 | 4;
  maxTasks: number;
};

export type LocalOrchestrationPlan = {
  runId: string;
  missionId: string;
  status: "planned" | "blocked";
  schedule: DagSchedule;
  taskCount: number;
  maxDepth: 1 | 2 | 3 | 4;
  maxTasks: number;
  blockedReason?: string;
};

export type LocalOrchestrationRunResult = {
  runId: string;
  missionId: string;
  status: "completed" | "failed" | "blocked";
  plan: LocalOrchestrationPlan;
  schedule: DagSchedule;
  results: TaskRunResult[];
  spawnedTaskCount: number;
  failureReason?: string;
};

export type LocalTaskOutcome = DynamicTaskRunResult;

export type LocalOrchestrationOutcomeInput = LocalOrchestrationInput & {
  outcomes: LocalTaskOutcome[];
};

const EMPTY_SCHEDULE: DagSchedule = { waves: [], lockDeferrals: [] };

export function planLocalOrchestration(input: LocalOrchestrationInput): LocalOrchestrationPlan {
  const blockedReason = validateLocalOrchestrationInput(input);
  if (blockedReason) {
    return {
      runId: randomUUID(),
      missionId: input.missionId,
      status: "blocked",
      schedule: EMPTY_SCHEDULE,
      taskCount: input.tasks.length,
      maxDepth: input.maxDepth,
      maxTasks: input.maxTasks,
      blockedReason,
    };
  }

  try {
    return {
      runId: randomUUID(),
      missionId: input.missionId,
      status: "planned",
      schedule: createDagSchedule(input.tasks),
      taskCount: input.tasks.length,
      maxDepth: input.maxDepth,
      maxTasks: input.maxTasks,
    };
  } catch (error) {
    return {
      runId: randomUUID(),
      missionId: input.missionId,
      status: "blocked",
      schedule: EMPTY_SCHEDULE,
      taskCount: input.tasks.length,
      maxDepth: input.maxDepth,
      maxTasks: input.maxTasks,
      blockedReason: error instanceof Error ? error.message : "Local orchestration planning failed",
    };
  }
}

export async function executeLocalOrchestration(
  input: LocalOrchestrationInput,
  worker: (task: ScheduledTask) => Promise<DynamicTaskRunResult>,
): Promise<LocalOrchestrationRunResult> {
  const plan = planLocalOrchestration(input);
  if (plan.status === "blocked") {
    return {
      runId: plan.runId,
      missionId: input.missionId,
      status: "blocked",
      plan,
      schedule: plan.schedule,
      results: [],
      spawnedTaskCount: 0,
      failureReason: plan.blockedReason,
    };
  }

  try {
    const result = await runDynamicDagSchedule(input.tasks, worker, {
      maxDepth: input.maxDepth,
      maxTasks: input.maxTasks,
    });
    const failedTask = result.results.find((taskResult) => taskResult.status === "failed");
    return {
      runId: plan.runId,
      missionId: input.missionId,
      status: result.status,
      plan,
      schedule: result.schedule,
      results: result.results,
      spawnedTaskCount: result.spawnedTaskCount,
      failureReason: failedTask?.error,
    };
  } catch (error) {
    return {
      runId: plan.runId,
      missionId: input.missionId,
      status: "blocked",
      plan,
      schedule: plan.schedule,
      results: [],
      spawnedTaskCount: 0,
      failureReason: error instanceof Error ? error.message : "Local orchestration execution failed",
    };
  }
}

export function executeLocalOrchestrationWithOutcomes(
  input: LocalOrchestrationOutcomeInput,
): Promise<LocalOrchestrationRunResult> {
  const outcomes = new Map(input.outcomes.map((outcome) => [outcome.taskId, outcome]));
  return executeLocalOrchestration(input, async (task) => {
    const outcome = outcomes.get(task.taskId);
    if (!outcome) {
      return {
        taskId: task.taskId,
        status: "failed",
        error: `No local outcome supplied for task: ${task.taskId}`,
      };
    }
    return {
      taskId: task.taskId,
      status: outcome.status,
      output: outcome.output,
      error: outcome.error,
      spawnedTasks: outcome.spawnedTasks,
    };
  });
}

function validateLocalOrchestrationInput(input: LocalOrchestrationInput): string | undefined {
  if (input.maxTasks < 1) {
    return "Local orchestration maxTasks must be at least 1";
  }
  if (input.tasks.length > input.maxTasks) {
    return `Initial task count ${input.tasks.length} exceeds max task budget ${input.maxTasks}`;
  }

  const taskIds = new Set<string>();
  for (const task of input.tasks) {
    if (taskIds.has(task.taskId)) {
      return `Duplicate task id: ${task.taskId}`;
    }
    taskIds.add(task.taskId);
    if (task.layer > input.maxDepth) {
      return `Task exceeds max depth: ${task.taskId}`;
    }
  }

  for (const task of input.tasks) {
    for (const dependency of task.dependencies) {
      if (!taskIds.has(dependency)) {
        return `Missing dependency ${dependency} for task ${task.taskId}`;
      }
    }
  }

  return undefined;
}
