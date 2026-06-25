import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PythonCommand = {
  command: string;
  args?: string[];
};

function findPython(): PythonCommand | undefined {
  const candidates: PythonCommand[] =
    process.platform === "win32"
      ? [{ command: "python" }, { command: "py", args: ["-3"] }]
      : [{ command: "python3" }, { command: "python" }];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...(candidate.args ?? []), "--version"], {
      encoding: "utf8",
      shell: false,
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  return undefined;
}

function runPythonJson(python: PythonCommand, code: string): unknown {
  const result = spawnSync(python.command, [...(python.args ?? []), "-c", code], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: path.resolve("python"),
    },
    shell: false,
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as unknown;
}

describe("Python media sidecar modules", () => {
  it("reports optional media dependency availability without crashing", () => {
    const python = findPython();
    if (!python) {
      expect(python).toBeUndefined();
      return;
    }

    const result = runPythonJson(
      python,
      [
        "import json",
        "from wormhole_sidecar import media_image, media_pdf",
        "print(json.dumps({'pdf': media_pdf.dependency_report(), 'image': media_image.dependency_report()}, sort_keys=True))",
      ].join("\n"),
    );

    expect(result).toMatchObject({
      pdf: { pypdf: expect.any(Object) },
      image: { pillow: expect.any(Object), pytesseract: expect.any(Object) },
    });
  });

  it("returns structured PDF extraction or a dependency warning", () => {
    const python = findPython();
    if (!python) {
      expect(python).toBeUndefined();
      return;
    }

    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-pdf-"));
    const pdf = path.join(root, "tiny.pdf");
    writeFileSync(pdf, "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

    try {
      const result = runPythonJson(
        python,
        [
          "import json",
          "from wormhole_sidecar.media_pdf import extract_pdf",
          `payload = {"path": ${JSON.stringify(pdf)}, "mediaHash": "hash", "maxPages": 3}`,
          "print(json.dumps(extract_pdf(payload), sort_keys=True))",
        ].join("\n"),
      );

      expect(result).toMatchObject({
        kind: "pdf",
        pages: expect.any(Array),
        warnings: expect.any(Array),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns structured image inspection or a dependency warning", () => {
    const python = findPython();
    if (!python) {
      expect(python).toBeUndefined();
      return;
    }

    const root = mkdtempSync(path.join(os.tmpdir(), "wormhole-image-"));
    const image = path.join(root, "tiny.png");
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGNgYPgPAAEDAQDq1X4bAAAAAElFTkSuQmCC",
      "base64",
    );
    writeFileSync(image, tinyPng);

    try {
      const result = runPythonJson(
        python,
        [
          "import json",
          "from wormhole_sidecar.media_image import inspect_image",
          `payload = {"path": ${JSON.stringify(image)}, "mediaHash": "hash", "ocrMode": "auto"}`,
          "print(json.dumps(inspect_image(payload), sort_keys=True))",
        ].join("\n"),
      );

      expect(result).toMatchObject({
        kind: "image",
        warnings: expect.any(Array),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
