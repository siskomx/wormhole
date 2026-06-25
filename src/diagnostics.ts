import { createHash } from "node:crypto";
import path from "node:path";

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export type DiagnosticRecord = {
  diagnosticId: string;
  source: string;
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  recordedAt: string;
};

export type DiagnosticStoreSnapshot = {
  diagnostics: DiagnosticRecord[];
};

export type DiagnosticQuery = {
  severity?: DiagnosticSeverity;
  file?: string;
  source?: string;
};

type LspDiagnostic = {
  range: {
    start: { line: number; character: number };
    end?: { line: number; character: number };
  };
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
};

export function normalizeCommandDiagnostics(input: {
  source: string;
  output: string;
}): DiagnosticRecord[] {
  const diagnostics: DiagnosticRecord[] = [];
  const lines = input.output.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const parsed = parseCommandDiagnosticLine(input.source, line);
    if (parsed) {
      diagnostics.push(parsed);
    }
  }
  return diagnostics;
}

export function normalizeLspDiagnostics(input: {
  uri: string;
  diagnostics: LspDiagnostic[];
}): DiagnosticRecord[] {
  const file = filePathFromUri(input.uri);
  return input.diagnostics.map((diagnostic) =>
    createDiagnostic({
      source: diagnostic.source ?? "lsp",
      severity: severityFromLsp(diagnostic.severity),
      message: diagnostic.message,
      file,
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    }),
  );
}

export function createDiagnosticStore(
  snapshot: Partial<DiagnosticStoreSnapshot> = {},
  onChange?: (snapshot: DiagnosticStoreSnapshot) => void,
) {
  const diagnostics = [...(snapshot.diagnostics ?? [])];

  function emit(): void {
    onChange?.({ diagnostics: [...diagnostics] });
  }

  return {
    recordMany(records: DiagnosticRecord[]): DiagnosticRecord[] {
      diagnostics.push(...records);
      emit();
      return [...records];
    },
    query(query: DiagnosticQuery = {}): { diagnostics: DiagnosticRecord[] } {
      return {
        diagnostics: diagnostics.filter((diagnostic) => {
          if (query.severity && diagnostic.severity !== query.severity) {
            return false;
          }
          if (query.source && diagnostic.source !== query.source) {
            return false;
          }
          if (query.file && !diagnostic.file?.replace(/\\/g, "/").endsWith(query.file.replace(/\\/g, "/"))) {
            return false;
          }
          return true;
        }),
      };
    },
    snapshot(): DiagnosticStoreSnapshot {
      return { diagnostics: [...diagnostics] };
    },
  };
}

function parseCommandDiagnosticLine(source: string, line: string): DiagnosticRecord | undefined {
  const typescript = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+([A-Z]+\d+):\s*(.+)$/);
  if (typescript) {
    return createDiagnostic({
      source,
      file: normalizePath(typescript[1] ?? ""),
      line: Number(typescript[2]),
      column: Number(typescript[3]),
      severity: typescript[4] === "warning" ? "warning" : "error",
      code: typescript[5],
      message: typescript[6] ?? "",
    });
  }

  const fail = line.match(/^FAIL\s+(.+)$/);
  if (fail) {
    return createDiagnostic({
      source,
      file: normalizePath((fail[1] ?? "").split(/\s+>/, 1)[0] ?? ""),
      severity: "error",
      message: line.trim(),
    });
  }

  const generic = line.match(/^(?:Error:\s*)?(.+?):(\d+):(\d+)\s+(.+)$/);
  if (generic) {
    return createDiagnostic({
      source,
      file: normalizePath(generic[1] ?? ""),
      line: Number(generic[2]),
      column: Number(generic[3]),
      severity: "error",
      message: generic[4] ?? "",
    });
  }

  return undefined;
}

function createDiagnostic(input: Omit<DiagnosticRecord, "diagnosticId" | "recordedAt">): DiagnosticRecord {
  const base = {
    recordedAt: new Date().toISOString(),
    ...input,
  };
  return {
    diagnosticId: `diag:${createHash("sha256")
      .update(JSON.stringify(base))
      .digest("hex")
      .slice(0, 16)}`,
    ...base,
  };
}

function severityFromLsp(severity?: number): DiagnosticSeverity {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "info";
  }
}

function filePathFromUri(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }
  const url = new URL(uri);
  const decoded = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:\//.test(decoded)) {
    return decoded.slice(1).replace(/\//g, path.sep);
  }
  return decoded;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").trim();
}
