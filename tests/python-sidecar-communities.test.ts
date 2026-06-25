import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createPythonSidecar } from "../src/python-sidecar.js";

type PythonCommand = {
  command: string;
  args?: string[];
};

function findPython(): PythonCommand | undefined {
  const candidates: PythonCommand[] =
    process.platform === "win32"
      ? [
          { command: "python", args: ["-m", "wormhole_sidecar.runner"] },
          { command: "py", args: ["-3", "-m", "wormhole_sidecar.runner"] },
        ]
      : [
          { command: "python3", args: ["-m", "wormhole_sidecar.runner"] },
          { command: "python", args: ["-m", "wormhole_sidecar.runner"] },
        ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...(candidate.args ?? []).filter((arg) => arg !== "-m" && arg !== "wormhole_sidecar.runner"), "--version"], {
      encoding: "utf8",
      shell: false,
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  return undefined;
}

function requirePython(): PythonCommand {
  const python = findPython();
  expect(python, "Python is required for the Wormhole runtime").toBeDefined();
  return python as PythonCommand;
}

describe("Python graph communities", () => {
  it("detects deterministic graph communities", async () => {
    const python = requirePython();

    const sidecar = createPythonSidecar({ command: python.command, args: python.args, timeoutMs: 2_000 });
    const result = await sidecar.run({
      job: "graph_communities",
      payload: {
        nodes: [
          { id: "src/api.ts" },
          { id: "src/db.ts" },
          { id: "docs/usage.md" },
          { id: "docs/design.md" },
          { id: "notes/todo.md" },
        ],
        edges: [
          { from: "src/api.ts", to: "src/db.ts" },
          { from: "docs/usage.md", to: "docs/design.md" },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({
      communityCount: 3,
      communities: [
        { id: "community-1", members: ["docs/design.md", "docs/usage.md"] },
        { id: "community-2", members: ["notes/todo.md"] },
        { id: "community-3", members: ["src/api.ts", "src/db.ts"] },
      ],
    });
  });
});
