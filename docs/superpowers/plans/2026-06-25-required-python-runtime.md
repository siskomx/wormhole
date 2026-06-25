**Goal:** Make Python a required first-class Wormhole runtime from startup instead of an optional sidecar.

**Architecture:** Keep TypeScript as the MCP/control-plane runtime for schemas, event logs, gates, and plugin packaging. Require the repo-local Python package at process startup for graph metrics, graph communities, media extraction, trace summaries, and offline policy jobs. Startup fails fast with a clear setup hint when Python or the `wormhole_sidecar` package cannot be probed.

**Tech Stack:** TypeScript, Node.js `child_process.spawn`, Vitest, Python 3, repo-local `python/wormhole_sidecar`, MCPB/Codex plugin metadata.

## Tasks

- [x] Add runtime contract tests for required Python startup probes.
- [x] Add CLI startup verification so MCP startup checks Python before accepting clients.
- [x] Make `python_sidecar_probe` report required runtime status.
- [x] Require checked-in Python runner tests to find Python instead of treating absence as a skip.
- [x] Update capability manifests, README, architecture docs, and plugin metadata from optional sidecar language to required Python runtime language.
- [x] Add a top-level Python requirements file for first-setup installation.
- [x] Run focused tests, then full test/typecheck/build/benchmark verification.

## Acceptance

- `requirePythonRuntime` succeeds against a working sidecar probe and throws a setup-focused error when the interpreter cannot start.
- The CLI calls the required Python runtime check before connecting the MCP server.
- `adaptive.required-python-runtime` replaces `adaptive.optional-python-sidecar` in the live capability manifest.
- Active README, contract docs, architecture docs, and plugin metadata describe Python as required from first startup.
- Existing media dependency warnings remain valid for optional third-party packages such as OCR support; Python itself is no longer optional.
