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
