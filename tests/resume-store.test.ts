import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createResumeRepoFingerprint,
  createResumeStore,
  writeResumeArtifacts,
} from "../src/resume-store.js";

const fingerprint = {
  source: "git" as const,
  head: "abc123",
  dirty: false,
  statusHash: "sha256:clean",
};

describe("resume store", () => {
  it("records material events with deterministic trust defaults", () => {
    const store = createResumeStore();

    const scratch = store.record({
      repoRoot: "C:/repo",
      objective: "Continue a large plan",
      kind: "design_direction",
      summary: "Prefer explicit resume tools before host-level capture.",
    });
    const handoff = store.record({
      repoRoot: "C:/repo",
      objective: "Continue a large plan",
      kind: "exact_next_action",
      summary: "Build resume_record first.",
      nextActions: ["Add resume-store tests"],
    });
    const canonical = store.record({
      repoRoot: "C:/repo",
      objective: "Continue a large plan",
      kind: "verification",
      summary: "Ollama model panel agreed on strict Step 0 loader.",
      evidenceIds: ["evidence-1"],
    });

    expect(scratch.trust).toBe("scratch");
    expect(handoff.trust).toBe("handoff");
    expect(canonical.trust).toBe("canonical");
    expect(scratch.recordId).toMatch(/^resume-record-/);
    expect(store.snapshot().records.map((record) => record.recordId)).toEqual([
      scratch.recordId,
      handoff.recordId,
      canonical.recordId,
    ]);
  });

  it("creates a checkpoint and validates verified canonical context references", () => {
    const store = createResumeStore();
    const scratch = store.record({
      repoRoot: "C:/repo",
      objective: "Continue a large plan",
      kind: "design_direction",
      summary: "Important chat-only decision.",
    });
    store.record({
      repoRoot: "C:/repo",
      objective: "Continue a large plan",
      kind: "verification",
      summary: "Source-backed context exists.",
      contextPackIds: ["ctxpack:1"],
    });

    const beforeCheckpoint = store.validate({ repoRoot: "C:/repo" });
    expect(beforeCheckpoint.valid).toBe(false);
    expect(beforeCheckpoint.missingCheckpoint).toBe(true);
    expect(beforeCheckpoint.staleMaterialRecordIds).toContain(scratch.recordId);

    const checkpoint = store.checkpoint({
      repoRoot: "C:/repo",
      objective: "Continue a large plan",
      reason: "Before fresh session",
      repoFingerprint: fingerprint,
    });

    expect(checkpoint.recordIds).toEqual(store.snapshot().records.map((record) => record.recordId));
    expect(checkpoint.unauditedRecordCount).toBe(1);
    expect(checkpoint.trustCounts).toEqual({ scratch: 1, handoff: 0, canonical: 1 });

    const afterCheckpoint = store.validate({
      repoRoot: "C:/repo",
      requireCanonical: true,
      groundTruth: {
        evidenceIds: [],
        contextPackIds: ["ctxpack:1"],
        repoFingerprint: fingerprint,
        existingChangedFiles: [],
      },
    });
    expect(afterCheckpoint.valid).toBe(true);
    expect(afterCheckpoint.staleMaterialRecordIds).toEqual([]);
    expect(afterCheckpoint.unauditedRecordIds).toEqual([scratch.recordId]);

    const scratchNote = store.record({
      repoRoot: "C:/repo",
      objective: "Continue a large plan",
      kind: "design_direction",
      summary: "A later scratch note should be reported without failing validation.",
    });
    const withScratch = store.validate({
      repoRoot: "C:/repo",
      requireCanonical: true,
      groundTruth: {
        evidenceIds: [],
        contextPackIds: ["ctxpack:1"],
        repoFingerprint: fingerprint,
        existingChangedFiles: [],
      },
    });
    expect(withScratch.valid).toBe(true);
    expect(withScratch.staleScratchRecordIds).toEqual([scratchNote.recordId]);
  });

  it("rejects unverified canonical references, missing changed files, and repo drift", () => {
    const store = createResumeStore();
    store.record({
      repoRoot: "C:/repo",
      objective: "Continue a large plan",
      kind: "exact_next_action",
      summary: "Edit a file based on evidence.",
      evidenceIds: ["missing-evidence"],
      changedFiles: ["src/missing.ts"],
    });
    store.checkpoint({
      repoRoot: "C:/repo",
      objective: "Continue a large plan",
      reason: "Before fresh session",
      repoFingerprint: fingerprint,
    });

    const result = store.validate({
      repoRoot: "C:/repo",
      requireCanonical: true,
      groundTruth: {
        evidenceIds: [],
        contextPackIds: [],
        repoFingerprint: { ...fingerprint, statusHash: "sha256:changed" },
        existingChangedFiles: [],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.unresolvedEvidenceIds).toEqual(["missing-evidence"]);
    expect(result.missingChangedFiles).toEqual(["src/missing.ts"]);
    expect(result.repoFingerprintChanged).toBe(true);
    expect(result.reasons).toContain("Latest checkpoint does not include a verified canonical resume record.");
  });

  it("writes latest and checkpoint artifacts and prunes stale checkpoint files", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-resume-store-"));
    try {
      const store = createResumeStore();
      store.record({
        repoRoot,
        objective: "Continue a large plan",
        kind: "exact_next_action",
        summary: "Run resume_validate before implementation.",
        nextActions: ["Run npm test -- tests/resume-store.test.ts"],
        evidenceIds: ["evidence-2"],
      });
      const firstCheckpoint = store.checkpoint({
        repoRoot,
        objective: "Continue a large plan",
        reason: "Plan handoff",
        repoFingerprint: fingerprint,
      });
      writeResumeArtifacts({
        repoRoot,
        checkpoint: firstCheckpoint,
        retainedCheckpointIds: [firstCheckpoint.checkpointId],
      });

      const secondCheckpoint = store.checkpoint({
        repoRoot,
        objective: "Continue a large plan",
        reason: "Updated handoff",
        repoFingerprint: fingerprint,
      });
      const result = writeResumeArtifacts({
        repoRoot,
        checkpoint: secondCheckpoint,
        retainedCheckpointIds: [secondCheckpoint.checkpointId],
      });

      expect(result.files.map((file) => file.relativePath).sort()).toEqual([
        `.wormhole/resume/checkpoints/${secondCheckpoint.checkpointId}.json`,
        `.wormhole/resume/checkpoints/${secondCheckpoint.checkpointId}.md`,
        ".wormhole/resume/latest.json",
        ".wormhole/resume/latest.md",
      ]);
      expect(result.prunedFiles).toEqual([
        `.wormhole/resume/checkpoints/${firstCheckpoint.checkpointId}.json`,
        `.wormhole/resume/checkpoints/${firstCheckpoint.checkpointId}.md`,
      ]);
      for (const file of result.files) {
        expect(existsSync(file.absolutePath)).toBe(true);
        expect(file.bytes).toBeGreaterThan(20);
      }
      expect(
        existsSync(path.join(repoRoot, ".wormhole", "resume", "checkpoints", `${firstCheckpoint.checkpointId}.json`)),
      ).toBe(false);

      const latest = JSON.parse(readFileSync(path.join(repoRoot, ".wormhole", "resume", "latest.json"), "utf8")) as {
        checkpointId: string;
        checkpointPath: string;
        resumePath: string;
      };
      const markdown = readFileSync(path.join(repoRoot, ".wormhole", "resume", "latest.md"), "utf8");

      expect(latest.checkpointId).toBe(secondCheckpoint.checkpointId);
      expect(markdown).toContain("# Wormhole Resume");
      expect(markdown).toContain("Exact Next Actions");
      expect(markdown).toContain("Run resume_validate before implementation.");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("creates a filesystem fingerprint when git metadata is unavailable", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "wormhole-resume-fingerprint-"));
    try {
      writeFileSync(path.join(repoRoot, "notes.md"), "first\n");
      const first = createResumeRepoFingerprint(repoRoot);
      writeFileSync(path.join(repoRoot, "notes.md"), "first\nsecond\n");
      const second = createResumeRepoFingerprint(repoRoot);

      expect(first.source).toBe("filesystem");
      expect(second.source).toBe("filesystem");
      expect(second.statusHash).not.toBe(first.statusHash);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("resume store hasState", () => {
  it("reports existence per normalized repo root", () => {
    const store = createResumeStore();
    expect(store.hasState({ repoRoot: "/repo/a" })).toBe(false);
    store.record({ repoRoot: "/repo/a", objective: "o", kind: "exact_next_action", summary: "s" });
    expect(store.hasState({ repoRoot: "/repo/a" })).toBe(true);
    // normalization: trailing-slash / segment forms resolve to the same root
    expect(store.hasState({ repoRoot: "/repo/a/" })).toBe(true);
    expect(store.hasState({ repoRoot: "/repo/b" })).toBe(false);
  });
});
