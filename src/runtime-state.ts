import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type JsonRuntimeStateStore<T extends object> = {
  read(): T;
  write(state: T): T;
  update(mutator: (state: T) => T): T;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createJsonRuntimeStateStore<T extends object>(input: {
  statePath: string;
  defaultState: T;
}): JsonRuntimeStateStore<T> {
  const statePath = path.resolve(input.statePath);

  function read(): T {
    if (!existsSync(statePath)) {
      return clone(input.defaultState);
    }
    try {
      return {
        ...clone(input.defaultState),
        ...(JSON.parse(readFileSync(statePath, "utf8")) as Partial<T>),
      };
    } catch {
      return clone(input.defaultState);
    }
  }

  function write(state: T): T {
    mkdirSync(path.dirname(statePath), { recursive: true });
    const next = clone(state);
    const tempPath = `${statePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    renameSync(tempPath, statePath);
    return next;
  }

  return {
    read,
    write,
    update(mutator) {
      return write(mutator(read()));
    },
  };
}
