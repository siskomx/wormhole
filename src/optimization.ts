export type OptimizationKind =
  | "command_output_compaction"
  | "context_compression"
  | "dense_summary"
  | "minimality_review";

export type OptimizationFinding = {
  severity: "low" | "medium" | "high";
  phrase: string;
  message: string;
};

export type OptimizationResult = {
  kind: OptimizationKind;
  content: string;
  originalCharCount: number;
  optimizedCharCount: number;
  notes: string[];
  droppedLineCount?: number;
  bullets?: string[];
  findings?: OptimizationFinding[];
};

export type ContextItem = {
  id: string;
  source: string;
  text: string;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxChars: number): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function result(
  kind: OptimizationKind,
  original: string,
  content: string,
  notes: string[],
  extra: Partial<OptimizationResult> = {},
): OptimizationResult {
  return {
    kind,
    content,
    originalCharCount: original.length,
    optimizedCharCount: content.length,
    notes,
    ...extra,
  };
}

export function compactCommandOutput(input: {
  content: string;
  maxLines?: number;
  maxChars?: number;
}): OptimizationResult {
  const maxLines = input.maxLines ?? 80;
  const maxChars = input.maxChars ?? 6000;
  const lines = input.content.split(/\r?\n/);
  const diagnosticPattern = /(error|fail|failed|exception|traceback|warn|exited|exit code)/i;

  if (lines.length <= maxLines && input.content.length <= maxChars) {
    return result("command_output_compaction", input.content, input.content, [
      "Command output already fits budget.",
    ], {
      droppedLineCount: 0,
    });
  }

  const selected = new Map<number, string>();
  const headCount = Math.min(3, lines.length);
  const tailCount = Math.min(3, lines.length);

  for (let index = 0; index < headCount; index += 1) {
    selected.set(index, lines[index] ?? "");
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (diagnosticPattern.test(line)) {
      selected.set(index, line);
    }
  }
  for (let index = Math.max(0, lines.length - tailCount); index < lines.length; index += 1) {
    selected.set(index, lines[index] ?? "");
  }

  const ordered = [...selected.entries()].sort(([left], [right]) => left - right);
  const compactedLines: string[] = [];
  let previousIndex = -1;
  let omitted = 0;

  for (const [index, line] of ordered) {
    const gap = index - previousIndex - 1;
    if (gap > 0) {
      omitted += gap;
      compactedLines.push(`[... omitted ${gap} lines ...]`);
    }
    compactedLines.push(line);
    previousIndex = index;
  }

  let content = compactedLines.join("\n");
  if (content.length > maxChars) {
    content = `${content.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n[... truncated output ...]`;
  }

  return result(
    "command_output_compaction",
    input.content,
    content,
    ["Preserved command head, tail, and diagnostic lines."],
    {
      droppedLineCount: omitted,
    },
  );
}

export function compressContext(input: {
  items: ContextItem[];
  maxCharsPerItem?: number;
}): OptimizationResult {
  const maxCharsPerItem = input.maxCharsPerItem ?? 240;
  const original = input.items.map((item) => `${item.id} ${item.source} ${item.text}`).join("\n");
  const content = input.items
    .map((item) => `[${item.id}] ${item.source}: ${truncateText(item.text, maxCharsPerItem)}`)
    .join("\n");

  return result("context_compression", original, content, [
    "Preserved context ids and source labels.",
  ]);
}

export function createDenseSummary(input: {
  text: string;
  maxBullets?: number;
  maxBulletLength?: number;
}): OptimizationResult {
  const maxBullets = input.maxBullets ?? 5;
  const maxBulletLength = input.maxBulletLength ?? 120;
  const sentences =
    input.text.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ??
    [];
  const bullets = sentences
    .slice(0, maxBullets)
    .map((sentence) => truncateText(sentence, maxBulletLength));
  const content = bullets.map((bullet) => `- ${bullet}`).join("\n");

  return result("dense_summary", input.text, content, [
    "Used deterministic first-sentence compression.",
  ], {
    bullets,
  });
}

export function reviewMinimality(input: {
  objective: string;
  planSteps: string[];
}): OptimizationResult {
  const original = [input.objective, ...input.planSteps].join("\n");
  const phrases = [
    "kubernetes",
    "microservice",
    "distributed event bus",
    "event bus",
    "rewrite",
    "new framework",
    "queue",
    "cache layer",
    "multi-tenant",
    "plugin marketplace",
  ];
  const lower = original.toLowerCase();
  const findings = phrases
    .filter((phrase) => lower.includes(phrase))
    .map<OptimizationFinding>((phrase) => ({
      severity:
        phrase === "kubernetes" || phrase === "microservice" || phrase === "distributed event bus"
          ? "high"
          : "medium",
      phrase,
      message: `Prefer the smallest change that satisfies the objective before adding ${phrase}.`,
    }));

  const content =
    findings.length > 0
      ? findings
          .map((finding) => `- ${finding.severity}: ${finding.message}`)
          .join("\n")
      : "- low: Plan appears scoped to the stated objective.";

  return result("minimality_review", original, content, [
    "Flagged common overbuilding terms with deterministic phrase matching.",
  ], {
    findings,
  });
}

export function optimizeText(input: {
  kind: OptimizationKind;
  content: string;
}): OptimizationResult {
  switch (input.kind) {
    case "command_output_compaction":
      return compactCommandOutput({ content: input.content });
    case "context_compression":
      return compressContext({
        items: [{ id: "T1", source: "direct_input", text: input.content }],
      });
    case "dense_summary":
      return createDenseSummary({ text: input.content });
    case "minimality_review":
      return reviewMinimality({
        objective: "Review direct input for minimality.",
        planSteps: [input.content],
      });
  }
}
