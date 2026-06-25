# Advanced Native Capability Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for parallel execution, or superpowers:executing-plans for single-agent execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining native-capability gaps called out after the native runtime suite: multimodal ingestion for PDFs/images, shell hooks across common terminals, Browser/HAR/API discovery for automatic tool generation, and learned orchestration policy. These must be Wormhole-native features, not README claims or delegated external products.

**Architecture:** TypeScript remains authoritative for MCP schemas, path policy, evidence state, side-effect permissions, tool manifests, and plugin packaging. Python remains an optional bounded sidecar for workloads where it materially helps: media extraction and offline policy training/evaluation. Browser and shell features are opt-in, dry-run first, reversible, and evidence-recording by default.

**Tech Stack:** TypeScript, Node.js `fs`, `path`, `crypto`, `child_process.spawn`, built-in `fetch`, Vitest, optional Python 3 sidecar, optional Python packages listed in `python/requirements-media.txt`, JSONL trace artifacts, MCPB/Codex plugin metadata.

---

## Scope

This plan adds four native tracks:

- Media ingestion: PDF text/page extraction, image metadata, EXIF-safe summaries, optional OCR, content hashes, and evidence-ready media records.
- Shell hooks: discovery, dry-run planning, idempotent install, verification, and uninstall for PowerShell, Bash, Zsh, Fish, Nushell, and guarded Cmd AutoRun.
- Discovery crawler: HAR import, OpenAPI import, same-origin HTTP crawl, optional browser network capture, endpoint normalization, and deterministic tool-spec generation through the existing tool factory.
- Learned orchestration: trace dataset export, offline reward computation, Q-learning/contextual policy training, replay evaluation, policy activation gates, and runtime-safe action clamps.

This plan does not add vendor-specific hidden behavior. Any learned policy remains bounded by Wormhole's existing evidence gates, budgets, path rules, and approval policy.

---

## File Structure

- Create: `src/media-ingestion.ts`
  - Validates media paths, computes hashes, normalizes sidecar results, and creates evidence-ready records.
- Create: `python/wormhole_sidecar/media_pdf.py`
  - Extracts PDF metadata, page text, page hashes, and warnings through optional `pypdf`.
- Create: `python/wormhole_sidecar/media_image.py`
  - Extracts image dimensions, format, safe EXIF fields, perceptual summary fields, and optional OCR through `Pillow` and optional OCR backend detection.
- Create: `python/requirements-media.txt`
  - Lists optional media packages with exact minimum versions.
- Modify: `python/wormhole_sidecar/runner.py`
  - Registers `pdf_extract`, `image_inspect`, and `media_dependency_report`.
- Modify: `src/python-sidecar.ts`
  - Allows the new sidecar job names and exposes media result types.
- Create: `src/shell-hooks.ts`
  - Discovers shells, renders hook blocks, plans edits, applies marker-based installs, verifies, and uninstalls.
- Create: `src/api-discovery.ts`
  - Defines endpoint observations, auth/header redaction, request normalization, and tool-spec conversion.
- Create: `src/har-import.ts`
  - Converts HAR 1.2 entries into endpoint observations with redacted request/response samples.
- Create: `src/openapi-import.ts`
  - Converts OpenAPI JSON or YAML into endpoint observations and tool factory specs.
- Create: `src/http-crawler.ts`
  - Performs bounded same-origin crawl with `fetch`, robots-aware limits, HTML link/form/script discovery, and endpoint observations.
- Create: `src/browser-capture.ts`
  - Uses optional dynamic browser automation when available, or returns a precise dependency report with setup instructions.
- Create: `src/orchestration-learning.ts`
  - Owns trace schema, reward model, candidate policy validation, action clamps, and activation state.
- Create: `python/wormhole_sidecar/policy_train.py`
  - Trains deterministic offline policies from JSONL traces and evaluates them against replay fixtures.
- Modify: `src/conductor.ts`
  - Adds an optional policy hint input and records trace fields consumed by the learner.
- Modify: `src/tools.ts`
  - Adds handlers for media, shell hook, discovery, and learned-policy tools.
- Modify: `src/mcp-server.ts`
  - Registers the new MCP tool schemas.
- Modify: `src/capabilities.ts`
  - Adds implemented capability IDs for advanced native features.
- Modify: `README.md`
  - Replaces the current caveat with accurate native-feature documentation.
- Modify: `docs/architecture/orchestration-adaptive-capabilities.md`
  - Adds data-flow and safety sections for the four tracks.
- Modify: `docs/contracts/capability-manifest.md`
  - Documents capability IDs, tool contracts, and side-effect boundaries.
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
  - Exposes the new MCP tools to Claude Desktop.
- Modify: `plugins/wormhole/.codex-plugin/plugin.json`
  - Updates Codex plugin description and tool metadata.
- Add tests:
  - `tests/media-ingestion.test.ts`
  - `tests/python-sidecar-media.test.ts`
  - `tests/shell-hooks.test.ts`
  - `tests/har-import.test.ts`
  - `tests/openapi-import.test.ts`
  - `tests/http-crawler.test.ts`
  - `tests/api-discovery.test.ts`
  - `tests/browser-capture.test.ts`
  - `tests/orchestration-learning.test.ts`
  - `tests/python-policy-train.test.ts`
- Modify tests:
  - `tests/tools.test.ts`
  - `tests/mcp-server.test.ts`
  - `tests/capabilities.test.ts`
  - `tests/plugin.test.ts`

---

## Public MCP Tool Surface

Add these tools:

```text
media_dependency_report
media_ingest_pdf
media_ingest_image
shell_hook_discover
shell_hook_plan
shell_hook_install
shell_hook_uninstall
shell_hook_verify
discovery_har_import
discovery_openapi_import
discovery_http_crawl
discovery_browser_capture
discovery_tool_spec_generate
orchestration_trace_record
orchestration_dataset_export
orchestration_policy_train
orchestration_policy_evaluate
orchestration_policy_activate
orchestration_policy_get
```

All tools return structured JSON content and, when they produce durable data, an `artifactId` or `evidenceId` that can be used by the existing Wormhole mission loop.

---

## Task 1: Media Ingestion Contract

**Files:**
- Create: `src/media-ingestion.ts`
- Test: `tests/media-ingestion.test.ts`

- [ ] **Step 1: Write media contract tests**

Create `tests/media-ingestion.test.ts` with cases for path policy, hash stability, and result normalization:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMediaIngestion } from "../src/media-ingestion.js";

describe("media ingestion", () => {
  it("rejects media paths outside the allowed root", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-media-root-"));
    const ingestion = createMediaIngestion({ repoRoot: root });
    await expect(
      ingestion.ingestPdf({ sourcePath: path.join(root, "..", "escape.pdf") }),
    ).rejects.toThrow(/outside repo root/i);
  });

  it("normalizes a sidecar PDF extraction into an evidence-ready record", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-media-root-"));
    const pdf = path.join(root, "sample.pdf");
    writeFileSync(pdf, "%PDF-1.4\n%%EOF\n");
    const ingestion = createMediaIngestion({
      repoRoot: root,
      sidecar: {
        run: async () => ({
          ok: true,
          job: "pdf_extract",
          stdout: "",
          stderr: "",
          durationMs: 2,
          resultHash: "sidecar-hash",
          result: {
            kind: "pdf",
            pageCount: 1,
            pages: [{ pageNumber: 1, text: "Invoice 42", textHash: "abc" }],
            warnings: [],
          },
        }),
      },
    });
    const result = await ingestion.ingestPdf({ sourcePath: pdf });
    expect(result.kind).toBe("pdf");
    expect(result.mediaHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidenceCandidate.summary).toContain("1 page");
    expect(result.evidenceCandidate.sourcePath).toBe(pdf);
  });
});
```

Run:

```bash
npm test -- tests/media-ingestion.test.ts
```

Expected: FAIL with missing `src/media-ingestion.js`.

- [ ] **Step 2: Implement media contract**

Create `src/media-ingestion.ts` with these exported types and factory:

```ts
export type MediaKind = "pdf" | "image";

export type MediaIngestInput = {
  sourcePath: string;
  ocrMode?: "off" | "auto" | "required";
  maxPages?: number;
  maxBytes?: number;
};

export type EvidenceCandidate = {
  sourcePath: string;
  sourceHash: string;
  summary: string;
  metadata: Record<string, unknown>;
};

export type MediaIngestResult = {
  kind: MediaKind;
  sourcePath: string;
  mediaHash: string;
  extractedText: string;
  extractionWarnings: string[];
  evidenceCandidate: EvidenceCandidate;
};

export function createMediaIngestion(config: {
  repoRoot: string;
  sidecar: { run(input: { job: string; payload: unknown }): Promise<unknown> };
}): {
  ingestPdf(input: MediaIngestInput): Promise<MediaIngestResult>;
  ingestImage(input: MediaIngestInput): Promise<MediaIngestResult>;
};
```

Implementation rules:

- Resolve `sourcePath` with `path.resolve`.
- Reject any path outside `repoRoot`.
- Reject files above `maxBytes`, defaulting to 25 MiB.
- Hash raw file bytes with SHA-256.
- For PDFs, send `{ path, mediaHash, maxPages }` to sidecar job `pdf_extract`.
- For images, send `{ path, mediaHash, ocrMode }` to sidecar job `image_inspect`.
- Convert sidecar failures into structured extraction warnings unless `ocrMode` is `required`.
- Build an evidence candidate without calling `recordEvidence`; tool handlers perform that stateful step.

Run:

```bash
npm test -- tests/media-ingestion.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 2: Python Media Sidecar Jobs

**Files:**
- Create: `python/requirements-media.txt`
- Create: `python/wormhole_sidecar/media_pdf.py`
- Create: `python/wormhole_sidecar/media_image.py`
- Modify: `python/wormhole_sidecar/runner.py`
- Modify: `src/python-sidecar.ts`
- Test: `tests/python-sidecar-media.test.ts`

- [ ] **Step 1: Add optional media dependency list**

Create `python/requirements-media.txt`:

```text
pypdf>=4.3.1
Pillow>=10.4.0
pytesseract>=0.3.13
```

The sidecar must work without these packages by returning an `available: false` dependency report. Tests must accept both installed and missing media packages.

- [ ] **Step 2: Write sidecar media tests**

Create `tests/python-sidecar-media.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPythonSidecar } from "../src/python-sidecar.js";

describe("Python media sidecar", () => {
  it("reports media dependency availability", async () => {
    const sidecar = createPythonSidecar({ timeoutMs: 3_000 });
    const result = await sidecar.run({ job: "media_dependency_report", payload: {} });
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ pypdf: expect.any(Object), pillow: expect.any(Object) });
  });

  it("returns structured PDF extraction or a dependency warning", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-pdf-"));
    const pdf = path.join(root, "tiny.pdf");
    writeFileSync(pdf, "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
    const sidecar = createPythonSidecar({ timeoutMs: 3_000 });
    const result = await sidecar.run({
      job: "pdf_extract",
      payload: { path: pdf, mediaHash: "hash", maxPages: 3 },
    });
    expect(result.ok).toBe(true);
    expect(result.result).toHaveProperty("kind", "pdf");
    expect(result.result).toHaveProperty("warnings");
  });
});
```

Run:

```bash
npm test -- tests/python-sidecar-media.test.ts
```

Expected: FAIL until `src/python-sidecar.ts` allows the new jobs and the Python runner dispatches them.

- [ ] **Step 3: Implement Python media modules**

`python/wormhole_sidecar/media_pdf.py` exports:

```py
def dependency_report() -> dict:
    ...

def extract_pdf(payload: dict) -> dict:
    ...
```

Behavior:

- If `pypdf` is unavailable, return `{"kind": "pdf", "available": False, "pages": [], "warnings": ["pypdf unavailable"]}`.
- If available, open the PDF, limit pages by `maxPages`, extract text per page, compute SHA-256 for each page text, and return page metadata.
- Strip NUL characters and normalize CRLF to LF in extracted text.
- Never open paths received from Python outside the exact path sent by TypeScript; TypeScript owns root validation.

`python/wormhole_sidecar/media_image.py` exports:

```py
def dependency_report() -> dict:
    ...

def inspect_image(payload: dict) -> dict:
    ...
```

Behavior:

- If `Pillow` is unavailable, return `{"kind": "image", "available": False, "warnings": ["Pillow unavailable"]}`.
- If available, return width, height, format, mode, safe EXIF keys, and a deterministic color summary.
- If `ocrMode` is `auto` or `required`, use `pytesseract` only when both the Python package and native OCR binary are available.
- For `ocrMode: "required"`, return `ok: false` from the TypeScript media contract when OCR is unavailable.

- [ ] **Step 4: Register sidecar jobs**

In `python/wormhole_sidecar/runner.py`, dispatch:

```py
if job == "media_dependency_report":
    return media_pdf.dependency_report() | {"image": media_image.dependency_report()}
if job == "pdf_extract":
    return media_pdf.extract_pdf(payload)
if job == "image_inspect":
    return media_image.inspect_image(payload)
```

In `src/python-sidecar.ts`, allow:

```ts
type PythonSidecarJob =
  | "probe"
  | "graph_metrics"
  | "graph_communities"
  | "trace_summary"
  | "media_dependency_report"
  | "pdf_extract"
  | "image_inspect"
  | "policy_train"
  | "policy_evaluate";
```

Run:

```bash
npm test -- tests/python-sidecar-media.test.ts tests/media-ingestion.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 3: Shell Hook Manager

**Files:**
- Create: `src/shell-hooks.ts`
- Test: `tests/shell-hooks.test.ts`

- [ ] **Step 1: Write shell hook tests**

Create `tests/shell-hooks.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createShellHookManager } from "../src/shell-hooks.js";

describe("shell hooks", () => {
  it("renders idempotent PowerShell marker blocks", () => {
    const manager = createShellHookManager({ homeDir: "C:/Users/Test", repoRoot: "C:/repo" });
    const block = manager.renderHook({ shell: "powershell", eventLogPath: "C:/repo/.wormhole/shell-events.jsonl" });
    expect(block).toContain("# >>> wormhole shell hook >>>");
    expect(block).toContain("# <<< wormhole shell hook <<<");
    expect(block).toContain("shell-events.jsonl");
  });

  it("plans install without modifying files during dry run", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "wormhole-hooks-"));
    const profile = path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
    const manager = createShellHookManager({ homeDir: home, repoRoot: home });
    const plan = manager.planInstall({ shells: ["powershell"], dryRun: true });
    expect(plan.operations[0].path).toBe(profile);
    expect(plan.operations[0].action).toBe("insert");
  });

  it("uninstalls only the marked block", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "wormhole-hooks-"));
    const profile = path.join(home, ".bashrc");
    writeFileSync(profile, "export KEEP=1\n# >>> wormhole shell hook >>>\nwormhole\n# <<< wormhole shell hook <<<\n");
    const manager = createShellHookManager({ homeDir: home, repoRoot: home });
    manager.uninstall({ shells: ["bash"] });
    expect(readFileSync(profile, "utf8")).toBe("export KEEP=1\n");
  });
});
```

Run:

```bash
npm test -- tests/shell-hooks.test.ts
```

Expected: FAIL with missing `src/shell-hooks.js`.

- [ ] **Step 2: Implement shell discovery and rendering**

`src/shell-hooks.ts` exports:

```ts
export type ShellKind = "powershell" | "windows-powershell" | "bash" | "zsh" | "fish" | "nushell" | "cmd";

export type ShellHookPlan = {
  operations: Array<{
    shell: ShellKind;
    path: string;
    action: "insert" | "replace" | "remove" | "registry-set" | "registry-remove";
    backupPath?: string;
    beforeHash?: string;
    afterHash?: string;
  }>;
  warnings: string[];
};

export function createShellHookManager(config: {
  homeDir: string;
  repoRoot: string;
  now?: () => Date;
}): {
  discover(): Array<{ shell: ShellKind; profilePath?: string; available: boolean; warning?: string }>;
  renderHook(input: { shell: ShellKind; eventLogPath: string }): string;
  planInstall(input: { shells: ShellKind[]; dryRun: boolean; allowRegistry?: boolean }): ShellHookPlan;
  install(input: { shells: ShellKind[]; allowRegistry?: boolean }): ShellHookPlan;
  uninstall(input: { shells: ShellKind[]; allowRegistry?: boolean }): ShellHookPlan;
  verify(input: { shells: ShellKind[] }): ShellHookPlan;
};
```

Rendering rules:

- Use exact marker lines:
  - `# >>> wormhole shell hook >>>`
  - `# <<< wormhole shell hook <<<`
- PowerShell and Windows PowerShell wrap the existing `prompt` function and append compact JSONL records with shell, cwd, previous status, and timestamp.
- Bash and Zsh use `PROMPT_COMMAND` and a guarded preexec/precmd pattern without overwriting existing commands.
- Fish uses `fish_postexec`.
- Nushell edits `config.nu` hook arrays using marker comments and appends JSONL events.
- Cmd uses `HKCU\Software\Microsoft\Command Processor\AutoRun`; `install` rejects Cmd unless `allowRegistry` is true and `uninstall` removes only a value that exactly matches Wormhole's marker command.

Safety rules:

- `planInstall({ dryRun: true })` returns operations without touching files.
- `install` creates timestamped backups before editing.
- `install` replaces an existing Wormhole marker block instead of duplicating it.
- `uninstall` removes only the marker block.
- Profile paths resolve under `homeDir`; reject any custom path outside `homeDir`.

Run:

```bash
npm test -- tests/shell-hooks.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 4: HAR and OpenAPI Import

**Files:**
- Create: `src/api-discovery.ts`
- Create: `src/har-import.ts`
- Create: `src/openapi-import.ts`
- Test: `tests/api-discovery.test.ts`
- Test: `tests/har-import.test.ts`
- Test: `tests/openapi-import.test.ts`

- [ ] **Step 1: Write discovery tests**

Create tests that assert:

- Authorization, Cookie, Set-Cookie, and API key headers are redacted.
- Query parameters are normalized and sorted.
- HAR entries become endpoint observations with method, URL template, status class, content types, and sample hashes.
- OpenAPI paths become deterministic tool specs suitable for `tool_factory_generate`.

Example endpoint type in `src/api-discovery.ts`:

```ts
export type EndpointObservation = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  origin: string;
  pathTemplate: string;
  queryKeys: string[];
  requestContentType?: string;
  responseContentType?: string;
  statusClass?: "2xx" | "3xx" | "4xx" | "5xx";
  sampleHash?: string;
  source: "har" | "openapi" | "http-crawl" | "browser-capture";
};
```

Run:

```bash
npm test -- tests/api-discovery.test.ts tests/har-import.test.ts tests/openapi-import.test.ts
```

Expected: FAIL with missing modules.

- [ ] **Step 2: Implement HAR import**

`src/har-import.ts` exports:

```ts
export function importHar(input: { harJson: unknown; maxEntries?: number }): {
  observations: EndpointObservation[];
  redactions: number;
  warnings: string[];
};
```

Rules:

- Accept HAR 1.2 `log.entries`.
- Ignore `data:` and `file:` URLs.
- Redact sensitive headers and cookies before hashing.
- Do not persist raw bodies; store `sampleHash` and byte counts.
- Collapse numeric and UUID-like path segments into `{id}` only when at least two matching sibling routes exist.

- [ ] **Step 3: Implement OpenAPI import**

`src/openapi-import.ts` exports:

```ts
export function importOpenApi(input: { specText: string; sourceName: string }): {
  observations: EndpointObservation[];
  toolSpecs: Array<{
    name: string;
    description: string;
    command: string;
    args: string[];
    inputSchema: Record<string, unknown>;
  }>;
  warnings: string[];
};
```

Rules:

- Parse JSON directly.
- Parse YAML using a small local parser only for OpenAPI-compatible mappings, or add the `yaml` package if the local parser becomes brittle during implementation.
- Generate stable tool names as `api_<operationId>` when present, otherwise `api_<method>_<normalized_path>`.
- Never include auth token examples in generated args.

Run:

```bash
npm test -- tests/api-discovery.test.ts tests/har-import.test.ts tests/openapi-import.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 5: HTTP Crawl and Optional Browser Capture

**Files:**
- Create: `src/http-crawler.ts`
- Create: `src/browser-capture.ts`
- Test: `tests/http-crawler.test.ts`
- Test: `tests/browser-capture.test.ts`

- [ ] **Step 1: Write crawler tests**

Create tests with a local Node HTTP server that exposes:

- `/`
- `/docs`
- `/api/users`
- an HTML form posting to `/api/search`
- a script tag containing `/api/events`

Assertions:

- Same-origin links are crawled up to `maxPages`.
- Cross-origin links are reported but not fetched unless explicitly allowed.
- Forms and script URLs become endpoint observations.
- Browser capture reports dependency status when browser automation is unavailable.

Run:

```bash
npm test -- tests/http-crawler.test.ts tests/browser-capture.test.ts
```

Expected: FAIL with missing modules.

- [ ] **Step 2: Implement HTTP crawler**

`src/http-crawler.ts` exports:

```ts
export async function crawlHttp(input: {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number;
  allowOrigins?: string[];
  userAgent?: string;
  timeoutMs?: number;
}): Promise<{
  observations: EndpointObservation[];
  pagesVisited: string[];
  skipped: Array<{ url: string; reason: string }>;
  warnings: string[];
}>;
```

Rules:

- Default to same-origin only.
- Default `maxPages` to 25 and `maxDepth` to 3.
- Use `AbortController` for timeouts.
- Parse HTML for links, forms, and script URLs.
- Record response content types and status classes.
- Return warnings for robots, non-HTML content, redirects, and unsupported schemes.

- [ ] **Step 3: Implement optional browser capture**

`src/browser-capture.ts` exports:

```ts
export async function captureBrowserNetwork(input: {
  url: string;
  maxRequests?: number;
  browserEndpoint?: string;
  timeoutMs?: number;
}): Promise<{
  available: boolean;
  observations: EndpointObservation[];
  dependencyReport: string[];
  warnings: string[];
}>;
```

Rules:

- Try dynamic import of `playwright-core`.
- If unavailable, return `available: false` with a dependency report instead of throwing.
- When available, connect to `browserEndpoint` or launch a local browser only when the package and browser binary are present.
- Capture network requests and responses, redact sensitive headers, and normalize observations through `src/api-discovery.ts`.
- Stop after `maxRequests` or `timeoutMs`.

Run:

```bash
npm test -- tests/http-crawler.test.ts tests/browser-capture.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 6: Discovery to Tool Factory Pipeline

**Files:**
- Modify: `src/api-discovery.ts`
- Modify: `src/tool-factory.ts`
- Test: `tests/api-discovery.test.ts`
- Modify test: `tests/tool-factory.test.ts`

- [ ] **Step 1: Add tool-spec generation tests**

Add tests that feed observations from HAR, OpenAPI, and crawl paths into one merged discovery graph and assert:

- Duplicate endpoints merge by method, origin, and path template.
- Safer OpenAPI schemas win over inferred HAR schemas.
- Generated tool specs are deterministic.
- Generated specs can be passed to `toolFactoryGenerate` without manual edits.

- [ ] **Step 2: Implement discovery tool-spec conversion**

Add:

```ts
export function generateToolSpecsFromDiscovery(input: {
  observations: EndpointObservation[];
  baseCommand?: string;
  authMode?: "none" | "bearer-env" | "api-key-env";
}): {
  toolSpecs: ToolFactoryInput[];
  warnings: string[];
};
```

Rules:

- For `bearer-env`, require an env var name in generated metadata but never include a token.
- For mutating methods, mark the generated tool as `sideEffect: true`.
- Include sample hashes in generated docs, not raw samples.
- Emit warnings for ambiguous path parameters and missing schemas.

Run:

```bash
npm test -- tests/api-discovery.test.ts tests/tool-factory.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 7: Learned Orchestration Dataset and Policy

**Files:**
- Create: `src/orchestration-learning.ts`
- Create: `python/wormhole_sidecar/policy_train.py`
- Modify: `python/wormhole_sidecar/runner.py`
- Modify: `src/python-sidecar.ts`
- Modify: `src/conductor.ts`
- Test: `tests/orchestration-learning.test.ts`
- Test: `tests/python-policy-train.test.ts`

- [ ] **Step 1: Write policy tests**

Create `tests/orchestration-learning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clampPolicyAction,
  computeReward,
  createPolicyStore,
  serializeTraceForTraining,
} from "../src/orchestration-learning.js";

describe("orchestration learning", () => {
  it("computes reward from test outcome, evidence sufficiency, and cost", () => {
    const reward = computeReward({
      testsPassed: true,
      evidenceCount: 4,
      openQuestions: 0,
      durationMs: 20_000,
      tokenEstimate: 12_000,
      userCorrectionCount: 0,
    });
    expect(reward).toBeGreaterThan(0);
  });

  it("clamps learned actions to runtime safety limits", () => {
    const action = clampPolicyAction({
      workerCount: 50,
      verifierCount: 10,
      maxDepth: 99,
      modelProfile: "unknown",
    });
    expect(action.workerCount).toBeLessThanOrEqual(6);
    expect(action.verifierCount).toBeLessThanOrEqual(2);
    expect(action.maxDepth).toBeLessThanOrEqual(4);
  });

  it("does not activate a policy below replay thresholds", () => {
    const store = createPolicyStore();
    expect(() =>
      store.activate({
        policyId: "weak",
        replayPassRate: 0.7,
        averageReward: -0.1,
        sampleCount: 100,
      }),
    ).toThrow(/replay threshold/i);
  });
});
```

Run:

```bash
npm test -- tests/orchestration-learning.test.ts
```

Expected: FAIL with missing module.

- [ ] **Step 2: Implement TypeScript learning layer**

`src/orchestration-learning.ts` exports:

```ts
export type OrchestrationTrace = {
  traceId: string;
  taskKind: string;
  graphNodeCount: number;
  evidenceCount: number;
  openQuestions: number;
  action: PolicyAction;
  outcome: PolicyOutcome;
};

export type PolicyAction = {
  workerCount: number;
  verifierCount: number;
  maxDepth: number;
  modelProfile: string;
};

export function computeReward(outcome: PolicyOutcome): number;
export function clampPolicyAction(action: PolicyAction): PolicyAction;
export function serializeTraceForTraining(trace: OrchestrationTrace): string;
export function createPolicyStore(): {
  record(trace: OrchestrationTrace): void;
  exportJsonl(): string;
  evaluate(policyJson: unknown): PolicyEvaluation;
  activate(input: PolicyActivationInput): void;
  getActive(): PolicyActivationInput | undefined;
};
```

Reward rules:

- Tests passing is the largest positive signal.
- Evidence count helps only up to a cap.
- Open questions and user corrections reduce reward.
- Duration and token estimate reduce reward with bounded penalties.
- A policy cannot activate unless replay pass rate is at least `0.9`, sample count is at least `50`, and average reward is positive.

- [ ] **Step 3: Implement Python policy trainer**

Create `tests/python-policy-train.test.ts` to call sidecar jobs `policy_train` and `policy_evaluate` with a tiny JSONL dataset.

`python/wormhole_sidecar/policy_train.py` exports:

```py
def train_policy(payload: dict) -> dict:
    ...

def evaluate_policy(payload: dict) -> dict:
    ...
```

Training behavior:

- Parse JSONL traces from payload.
- Discretize state by task kind, graph size bucket, evidence bucket, and risk bucket.
- Train a deterministic Q-table over allowed actions.
- Use fixed learning rate, discount, and epoch count from payload with safe defaults.
- Return `policyId`, `qTable`, `trainingSamples`, `averageReward`, and warnings.

Evaluation behavior:

- Replay traces against a candidate Q-table.
- Return pass rate, average reward, action distribution, and safety violations.
- Treat any action outside TypeScript clamps as a safety violation.

Run:

```bash
npm test -- tests/orchestration-learning.test.ts tests/python-policy-train.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 8: MCP Tool Wiring

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/mcp-server.ts`
- Modify tests: `tests/tools.test.ts`, `tests/mcp-server.test.ts`

- [ ] **Step 1: Add tool handler tests**

Add tests that verify:

- `media_dependency_report` calls the Python sidecar dependency job.
- `media_ingest_pdf` and `media_ingest_image` produce evidence candidates and can optionally call `recordEvidence`.
- `shell_hook_plan` returns operations without editing files.
- `shell_hook_install` requires explicit `apply: true`.
- `discovery_har_import`, `discovery_openapi_import`, and `discovery_http_crawl` return endpoint observations.
- `discovery_tool_spec_generate` calls the existing tool factory conversion path.
- `orchestration_policy_train` and `orchestration_policy_evaluate` call sidecar jobs.
- `orchestration_policy_activate` rejects weak policy evaluations.

Run:

```bash
npm test -- tests/tools.test.ts tests/mcp-server.test.ts
```

Expected: FAIL until handlers and schemas are registered.

- [ ] **Step 2: Add handlers**

In `src/tools.ts`:

- Instantiate `createMediaIngestion`.
- Instantiate `createShellHookManager`.
- Route discovery tool inputs into `importHar`, `importOpenApi`, `crawlHttp`, `captureBrowserNetwork`, and `generateToolSpecsFromDiscovery`.
- Route policy tools into `createPolicyStore` and Python sidecar jobs.
- Use existing artifact/evidence helpers when returning durable records.
- Keep all file writes inside explicitly named install/export tools.

- [ ] **Step 3: Register MCP schemas**

In `src/mcp-server.ts`, register schemas with strict input fields:

- `sourcePath` for media tools.
- `dryRun`, `apply`, `shells`, and `allowRegistry` for shell tools.
- `harJson`, `specText`, `startUrl`, `maxPages`, `maxDepth`, `authMode` for discovery tools.
- `traceJsonl`, `policyJson`, `activation` for learning tools.

Run:

```bash
npm test -- tests/tools.test.ts tests/mcp-server.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 9: Capability, Docs, and Plugin Metadata

**Files:**
- Modify: `src/capabilities.ts`
- Modify: `README.md`
- Modify: `docs/architecture/orchestration-adaptive-capabilities.md`
- Modify: `docs/contracts/capability-manifest.md`
- Modify: `plugins/wormhole-claude-desktop/manifest.json`
- Modify: `plugins/wormhole/.codex-plugin/plugin.json`
- Modify tests: `tests/capabilities.test.ts`, `tests/plugin.test.ts`

- [ ] **Step 1: Add capability tests**

Assert these capability IDs exist:

```text
adaptive.native-media-ingestion
adaptive.shell-hook-manager
adaptive.discovery-tool-generation
adaptive.learned-orchestration-policy
```

Assert Claude Desktop and Codex plugin metadata mention the new tool names.

Run:

```bash
npm test -- tests/capabilities.test.ts tests/plugin.test.ts
```

Expected: FAIL until metadata is updated.

- [ ] **Step 2: Update docs and manifests**

README text must state:

- Media ingestion is native and optional Python packages unlock richer extraction.
- Shell hooks are opt-in, dry-run first, marker-based, backed up, and reversible.
- Discovery can ingest HAR/OpenAPI, crawl HTTP pages, and use optional browser capture.
- Learned orchestration is offline-trained and safety-clamped; it cannot bypass gates.
- Claude Desktop plugin metadata exposes the same MCP tools as Codex.

Update the architecture doc with a Mermaid flow:

```mermaid
flowchart LR
  "PDF/Image" --> "TypeScript path gate"
  "TypeScript path gate" --> "Python media sidecar"
  "HAR/OpenAPI/HTTP" --> "Discovery observations"
  "Discovery observations" --> "Tool factory"
  "Conductor traces" --> "Policy trainer"
  "Policy trainer" --> "Policy evaluator"
  "Policy evaluator" --> "Safety-clamped activation"
```

Run:

```bash
npm test -- tests/capabilities.test.ts tests/plugin.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 10: End-to-End Verification

- [ ] **Step 1: Run focused tests**

```bash
npm test -- tests/media-ingestion.test.ts tests/python-sidecar-media.test.ts tests/shell-hooks.test.ts tests/api-discovery.test.ts tests/har-import.test.ts tests/openapi-import.test.ts tests/http-crawler.test.ts tests/browser-capture.test.ts tests/orchestration-learning.test.ts tests/python-policy-train.test.ts tests/tools.test.ts tests/mcp-server.test.ts tests/capabilities.test.ts tests/plugin.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

```bash
npm test
npm run typecheck
npm run build
npm run benchmarks:validate
npx --yes @anthropic-ai/mcpb validate plugins/wormhole-claude-desktop
```

Expected: PASS.

- [ ] **Step 3: Search for stale caveats**

```bash
rg -n "not claim native ownership|future extensions|multimodal extraction, shell hooks, website crawling, or learned RL orchestration|Out of scope for this implementation batch" README.md docs plugins src tests
```

Expected: no matches except historical plan documents that intentionally describe previous scope.

- [ ] **Step 4: Commit**

```bash
git add src python tests README.md docs plugins package.json package-lock.json
git commit -m "feat: add advanced native capability suite"
```

---

## Parallel Execution Slices

- Agent A: Tasks 1 and 2, media ingestion and Python sidecar extraction.
- Agent B: Task 3, shell hook manager.
- Agent C: Tasks 4, 5, and 6, discovery import, crawling, and tool generation.
- Agent D: Task 7, learned orchestration dataset, trainer, and evaluator.
- Agent E: Tasks 8, 9, and 10, MCP wiring, docs, plugin metadata, and final verification.

The main orchestrator should merge slices only after each slice passes its focused tests. Shared files `src/tools.ts`, `src/mcp-server.ts`, `src/capabilities.ts`, README, docs, and plugin manifests should be reserved for Agent E to avoid conflicts.

---

## Risk Controls

- Media extraction never grants new file access; TypeScript validates paths before Python receives them.
- OCR is optional unless explicitly requested as required by input.
- Shell hooks are dry-run first and marker-based; uninstall never removes user-authored profile content outside the marker block.
- Browser capture is optional and reports exact dependency status when unavailable.
- Discovery redacts secrets before hashing or returning samples.
- Generated API tools mark mutating methods as side-effecting.
- Learned policies are inactive until replay thresholds pass.
- Learned actions are clamped before use and cannot bypass gates, budgets, shell approvals, or evidence requirements.

---

## Plan Quality Scan

- Every new module has a named test file.
- Every side-effecting feature has dry-run or activation gates.
- Python usage is bounded to media extraction and offline policy jobs.
- Claude Desktop metadata is included in the execution path.
- The stale caveat search is part of final verification.
