# Contributing

Thanks for helping improve Wormhole.

Wormhole is an evidence-aware MCP operating layer for AI coding agents. Contributions should preserve the project's core bias toward repo-native evidence, explicit verification, and safe write/execute workflows.

## Getting Started

Requirements:

- Node.js 22.5 or newer.
- npm.

Install dependencies:

```bash
npm install
```

Run the main checks:

```bash
npm test
npm run typecheck
npm run build
```

## Development Guidelines

- Keep changes focused on one behavior or documentation improvement.
- Prefer existing project patterns over new abstractions.
- Add or update tests when behavior changes.
- Keep generated artifacts, local indexes, and machine-specific files out of commits unless the project explicitly tracks them.
- Do not include secrets, access tokens, private logs, or customer data in issues, tests, fixtures, or commits.

## Pull Requests

Before opening a pull request:

1. Rebase or merge the latest target branch.
2. Run the relevant focused tests.
3. Run `npm run typecheck`.
4. Run `npm run build` when source files or package metadata changed.
5. Update docs or changelog entries when user-facing behavior changes.

In the pull request, explain:

- What changed.
- Why it changed.
- How you verified it.
- Any risks, follow-up work, or intentionally deferred scope.

## Issues

Use bug reports for reproducible failures and feature requests for proposed behavior changes.

For security vulnerabilities, do not open a public issue. Follow `SECURITY.md`.
