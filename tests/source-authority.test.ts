import { describe, expect, it } from "vitest";
import { classifySourceProvenance } from "../src/source-authority.js";

describe("source authority", () => {
  it("classifies current code as authoritative and docs as supporting", () => {
    const code = classifySourceProvenance({
      sourcePath: "backend/src/modules/chat/ChatService.ts",
      sourceHash: "sha256:code",
    });
    const doc = classifySourceProvenance({
      sourcePath: "docs/discoveries/features/chat.md",
      sourceHash: "sha256:doc",
    });

    expect(code).toMatchObject({
      authority: "current_code",
      freshness: "current",
      authorityScore: 1,
      sourcePath: "backend/src/modules/chat/ChatService.ts",
    });
    expect(doc).toMatchObject({
      authority: "supporting_doc",
      freshness: "unknown",
      sourcePath: "docs/discoveries/features/chat.md",
    });
    expect(doc.authorityScore).toBeLessThan(code.authorityScore);
  });

  it("classifies generated workflow notes as low-trust generated notes", () => {
    const generated = classifySourceProvenance({
      sourcePath: ".wormhole/workflows/latest.md",
      sourceHash: "sha256:generated",
    });

    expect(generated).toMatchObject({
      authority: "generated_note",
      freshness: "unknown",
      sourcePath: ".wormhole/workflows/latest.md",
    });
    expect(generated.authorityScore).toBeLessThan(0.3);
  });
});
