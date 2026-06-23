export type ScheduledTask = {
  taskId: string;
  objective: string;
  layer: 1 | 2 | 3 | 4;
  dependencies: string[];
  readSet: string[];
  writeSet: string[];
};

export type LockDeferral = {
  taskId: string;
  reason: "write lock conflict";
  conflictingTaskId: string;
  path: string;
};

export type DagSchedule = {
  waves: ScheduledTask[][];
  lockDeferrals: LockDeferral[];
};

export type TaskRunResult = {
  taskId: string;
  status: "completed" | "failed";
  output?: unknown;
  error?: string;
};

export type DagRunResult = {
  status: "completed" | "failed";
  schedule: DagSchedule;
  results: TaskRunResult[];
};

export type DynamicTaskRunResult = TaskRunResult & {
  spawnedTasks?: ScheduledTask[];
};

export type DynamicDagRunResult = DagRunResult & {
  spawnedTaskCount: number;
};

function intersects(left: string[], right: string[]): string | undefined {
  return left.find((value) => right.includes(value));
}

function conflictWithWave(task: ScheduledTask, wave: ScheduledTask[]): LockDeferral | undefined {
  for (const existing of wave) {
    const writeWrite = intersects(task.writeSet, existing.writeSet);
    if (writeWrite) {
      return {
        taskId: task.taskId,
        reason: "write lock conflict",
        conflictingTaskId: existing.taskId,
        path: writeWrite,
      };
    }
    const taskWritesExistingReads = intersects(task.writeSet, existing.readSet);
    if (taskWritesExistingReads) {
      return {
        taskId: task.taskId,
        reason: "write lock conflict",
        conflictingTaskId: existing.taskId,
        path: taskWritesExistingReads,
      };
    }
    const existingWritesTaskReads = intersects(existing.writeSet, task.readSet);
    if (existingWritesTaskReads) {
      return {
        taskId: task.taskId,
        reason: "write lock conflict",
        conflictingTaskId: existing.taskId,
        path: existingWritesTaskReads,
      };
    }
  }
  return undefined;
}

export function createDagSchedule(tasks: ScheduledTask[]): DagSchedule {
  const remaining = [...tasks];
  const completed = new Set<string>();
  const waves: ScheduledTask[][] = [];
  const lockDeferrals: LockDeferral[] = [];

  while (remaining.length > 0) {
    const wave: ScheduledTask[] = [];
    const selected = new Set<string>();

    for (const task of remaining) {
      if (!task.dependencies.every((dependency) => completed.has(dependency))) {
        continue;
      }
      const conflict = conflictWithWave(task, wave);
      if (conflict) {
        lockDeferrals.push(conflict);
        continue;
      }
      wave.push(task);
      selected.add(task.taskId);
    }

    if (wave.length === 0) {
      throw new Error("DAG has a cycle or unresolved dependency");
    }

    waves.push(wave);
    for (const task of wave) {
      completed.add(task.taskId);
    }
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (selected.has(remaining[index]!.taskId)) {
        remaining.splice(index, 1);
      }
    }
  }

  return { waves, lockDeferrals };
}

export async function runDagSchedule(
  tasks: ScheduledTask[],
  worker: (task: ScheduledTask) => Promise<TaskRunResult>,
): Promise<DagRunResult> {
  const schedule = createDagSchedule(tasks);
  const results: TaskRunResult[] = [];

  for (const wave of schedule.waves) {
    const waveResults = await Promise.all(wave.map((task) => worker(task)));
    results.push(...waveResults);
    if (waveResults.some((result) => result.status === "failed")) {
      return { status: "failed", schedule, results };
    }
  }

  return { status: "completed", schedule, results };
}

export async function runDynamicDagSchedule(
  tasks: ScheduledTask[],
  worker: (task: ScheduledTask) => Promise<DynamicTaskRunResult>,
  options: { maxDepth: 1 | 2 | 3 | 4; maxTasks: number },
): Promise<DynamicDagRunResult> {
  const remaining = new Map(tasks.map((task) => [task.taskId, task]));
  const completed = new Set<string>();
  const results: TaskRunResult[] = [];
  const schedule: DagSchedule = { waves: [], lockDeferrals: [] };
  let spawnedTaskCount = 0;

  while (remaining.size > 0) {
    const wave: ScheduledTask[] = [];
    for (const task of remaining.values()) {
      if (!task.dependencies.every((dependency) => completed.has(dependency))) {
        continue;
      }
      const conflict = conflictWithWave(task, wave);
      if (conflict) {
        schedule.lockDeferrals.push(conflict);
        continue;
      }
      wave.push(task);
    }

    if (wave.length === 0) {
      throw new Error("Dynamic DAG has a cycle or unresolved dependency");
    }

    schedule.waves.push(wave);
    const waveResults = await Promise.all(wave.map((task) => worker(task)));
    for (const result of waveResults) {
      results.push({
        taskId: result.taskId,
        status: result.status,
        output: result.output,
        error: result.error,
      });
      if (result.status === "failed") {
        return { status: "failed", schedule, results, spawnedTaskCount };
      }
      const parent = remaining.get(result.taskId);
      for (const spawned of result.spawnedTasks ?? []) {
        if (spawned.layer > options.maxDepth) {
          throw new Error(`Spawned task exceeds max depth: ${spawned.taskId}`);
        }
        if (parent && spawned.layer <= parent.layer) {
          throw new Error(`Spawned task must be deeper than parent: ${spawned.taskId}`);
        }
        if (remaining.has(spawned.taskId) || completed.has(spawned.taskId)) {
          throw new Error(`Duplicate task id: ${spawned.taskId}`);
        }
        spawnedTaskCount += 1;
        remaining.set(spawned.taskId, spawned);
        if (remaining.size + completed.size > options.maxTasks) {
          throw new Error("Dynamic DAG exceeded max task budget");
        }
      }
    }
    for (const task of wave) {
      remaining.delete(task.taskId);
      completed.add(task.taskId);
    }
  }

  return { status: "completed", schedule, results, spawnedTaskCount };
}
