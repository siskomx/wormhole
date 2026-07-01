import path from "node:path";
import type {
  RepoIndexEdgeKind,
  RepoIndexSymbol,
  RepoIndexSymbolKind,
} from "./repo-index.js";
import {
  loadTreeSitterLanguage,
  type TreeSitterLanguageId,
} from "./tree-sitter-loader.js";

export type RepoIndexParserInfo = {
  engine: "tree-sitter" | "fallback";
  language: string;
  reason?: string;
};

export type RepoIndexEdgeDraft = {
  from: string;
  specifier: string;
  kind: Extract<RepoIndexEdgeKind, "imports" | "links">;
  line: number;
};

export type RepoIndexCallDraft = {
  path: string;
  callerName?: string;
  calleeName: string;
  line: number;
};

export type RepoFileExtractionInput = {
  path: string;
  language: string;
  content: string;
};

export type RepoFileExtractionResult = {
  symbols: RepoIndexSymbol[];
  edgeDrafts: RepoIndexEdgeDraft[];
  callDrafts: RepoIndexCallDraft[];
  parser: RepoIndexParserInfo;
};

type AstNode = {
  type: string;
  text: string;
  startIndex: number;
  hasError?: boolean;
  namedChildCount: number;
  namedChild: (index: number) => AstNode | null;
  childForFieldName?: (fieldName: string) => AstNode | null;
};

type ParserWithParse = {
  parse: (content: string) => { rootNode: AstNode };
};

type SymbolDraft = {
  kind: RepoIndexSymbolKind;
  name: string;
  line: number;
};

const MAX_TREE_SITTER_NODES_PER_FILE = 100_000;

export function extractRepoFileFacts(input: RepoFileExtractionInput): RepoFileExtractionResult {
  const treeSitterLanguage = treeSitterLanguageFor(input.path, input.language);
  if (!treeSitterLanguage) {
    return extractFallbackFacts(input);
  }

  const loaded = loadTreeSitterLanguage(treeSitterLanguage);
  if (!loaded.available) {
    return extractFallbackFacts(
      input,
      `PARSER_FALLBACK: ${treeSitterLanguage} parser unavailable: ${loaded.reason}`,
    );
  }

  try {
    const parser = loaded.parser as ParserWithParse;
    const tree = parser.parse(input.content);
    if (tree.rootNode.hasError) {
      return extractFallbackFacts(
        input,
        `PARSER_FALLBACK: ${treeSitterLanguage} parse contained errors`,
      );
    }
    return {
      ...extractTreeSitterFacts(input, tree.rootNode),
      parser: { engine: "tree-sitter", language: treeSitterLanguage },
    };
  } catch (error) {
    return extractFallbackFacts(
      input,
      `PARSER_FALLBACK: ${treeSitterLanguage} parser failed: ${errorMessage(error)}`,
    );
  }
}

function extractTreeSitterFacts(
  input: RepoFileExtractionInput,
  rootNode: AstNode,
): Omit<RepoFileExtractionResult, "parser"> {
  const lineStarts = createLineStarts(input.content);
  const symbols: RepoIndexSymbol[] = [];
  const edgeDrafts: RepoIndexEdgeDraft[] = [];
  const callDrafts: RepoIndexCallDraft[] = [];
  const seenSymbols = new Set<string>();
  const seenEdges = new Set<string>();
  const seenCalls = new Set<string>();

  function addSymbol(draft: SymbolDraft): void {
    const cleanedName =
      draft.kind === "section"
        ? cleanMarkdownSymbolName(draft.name)
        : cleanCodeSymbolName(draft.name);
    if (!cleanedName) {
      return;
    }
    const key = `${cleanedName}:${draft.line}`;
    if (seenSymbols.has(key)) {
      return;
    }
    seenSymbols.add(key);
    symbols.push({
      id: `${input.path}#${cleanedName}:${draft.line}`,
      name: cleanedName,
      kind: draft.kind,
      path: input.path,
      line: draft.line,
    });
  }

  function addEdge(
    kind: Extract<RepoIndexEdgeKind, "imports" | "links">,
    specifier: string,
    line: number,
  ): void {
    if (!specifier) {
      return;
    }
    const key = `${kind}:${specifier}:${line}`;
    if (seenEdges.has(key)) {
      return;
    }
    seenEdges.add(key);
    edgeDrafts.push({ from: input.path, kind, specifier, line });
  }

  function addCall(callerName: string | undefined, calleeName: string, line: number): void {
    if (!calleeName || IGNORED_CALLEES.has(calleeName)) {
      return;
    }
    const key = `${callerName ?? ""}:${calleeName}:${line}`;
    if (seenCalls.has(key)) {
      return;
    }
    seenCalls.add(key);
    callDrafts.push({ path: input.path, ...(callerName ? { callerName } : {}), calleeName, line });
  }

  const stack: Array<{ node: AstNode; currentFunctionName?: string }> = [{ node: rootNode }];
  let visitedNodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    visitedNodes += 1;
    if (visitedNodes > MAX_TREE_SITTER_NODES_PER_FILE) {
      break;
    }
    const { node, currentFunctionName } = current;
    const line = lineForOffset(lineStarts, node.startIndex);
    const symbolDrafts = symbolDraftsForNode(input.language, node, line);
    let childFunctionName = currentFunctionName;
    for (const draft of symbolDrafts) {
      addSymbol(draft);
      if (draft.kind === "function") {
        childFunctionName = cleanCodeSymbolName(draft.name);
      }
    }

    for (const draft of edgeDraftsForNode(input.path, input.language, node, line)) {
      addEdge(draft.kind, draft.specifier, draft.line);
    }

    const calleeName = calleeNameForNode(input.language, node);
    if (calleeName) {
      addCall(currentFunctionName, calleeName, line);
    }

    for (let index = node.namedChildCount - 1; index >= 0; index -= 1) {
      const child = node.namedChild(index);
      if (child) {
        stack.push({ node: child, currentFunctionName: childFunctionName });
      }
    }
  }

  return { symbols, edgeDrafts, callDrafts };
}

function symbolDraftsForNode(language: string, node: AstNode, line: number): SymbolDraft[] {
  const name = nameForNode(node);
  switch (language) {
    case "javascript":
    case "typescript":
      return symbolDraftsForJavaScript(node, name, line);
    case "python":
      return symbolDraftsForPython(node, name, line);
    case "rust":
      return symbolDraftsForRust(node, name, line);
    case "csharp":
      return symbolDraftsForCSharp(node, name, line);
    default:
      return [];
  }
}

function symbolDraftsForJavaScript(
  node: AstNode,
  name: string | undefined,
  line: number,
): SymbolDraft[] {
  if (!name) {
    return [];
  }
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration":
    case "method_definition":
      return [{ kind: "function", name, line }];
    case "class_declaration":
      return [{ kind: "class", name, line }];
    case "interface_declaration":
      return [{ kind: "interface", name, line }];
    case "type_alias_declaration":
      return [{ kind: "type", name, line }];
    case "variable_declarator": {
      const valueType = node.childForFieldName?.("value")?.type ?? "";
      return [
        {
          kind: /(?:arrow_function|function)/.test(valueType) ? "function" : "constant",
          name,
          line,
        },
      ];
    }
    default:
      return [];
  }
}

function symbolDraftsForPython(
  node: AstNode,
  name: string | undefined,
  line: number,
): SymbolDraft[] {
  if (node.type === "function_definition" && name) {
    return [{ kind: "function", name, line }];
  }
  if (node.type === "class_definition" && name) {
    return [{ kind: "class", name, line }];
  }
  if (node.type === "assignment") {
    const constant = node.text.match(/^([A-Z][A-Z0-9_]*)\s*=/);
    if (constant?.[1]) {
      return [{ kind: "constant", name: constant[1], line }];
    }
  }
  return [];
}

function symbolDraftsForRust(
  node: AstNode,
  name: string | undefined,
  line: number,
): SymbolDraft[] {
  if (!name) {
    return [];
  }
  switch (node.type) {
    case "function_item":
      return [{ kind: "function", name, line }];
    case "struct_item":
      return [{ kind: "class", name, line }];
    case "enum_item":
      return [{ kind: "type", name, line }];
    case "trait_item":
      return [{ kind: "interface", name, line }];
    case "const_item":
    case "static_item":
      return [{ kind: "constant", name, line }];
    default:
      return [];
  }
}

function symbolDraftsForCSharp(
  node: AstNode,
  name: string | undefined,
  line: number,
): SymbolDraft[] {
  if (!name) {
    return [];
  }
  switch (node.type) {
    case "method_declaration":
    case "local_function_statement":
      return [{ kind: "function", name, line }];
    case "class_declaration":
      return [{ kind: "class", name, line }];
    case "interface_declaration":
      return [{ kind: "interface", name, line }];
    case "record_declaration":
    case "struct_declaration":
    case "enum_declaration":
      return [{ kind: "type", name, line }];
    default:
      return [];
  }
}

function edgeDraftsForNode(
  relativePath: string,
  language: string,
  node: AstNode,
  line: number,
): RepoIndexEdgeDraft[] {
  if (language === "javascript" || language === "typescript") {
    return edgeDraftsForJavaScript(relativePath, node, line);
  }
  if (language === "python") {
    return edgeDraftsForPython(relativePath, node, line);
  }
  if (language === "rust") {
    return edgeDraftsForRust(relativePath, node, line);
  }
  return [];
}

function edgeDraftsForJavaScript(
  relativePath: string,
  node: AstNode,
  line: number,
): RepoIndexEdgeDraft[] {
  if (node.type !== "import_statement" && node.type !== "export_statement" && node.type !== "call_expression") {
    return [];
  }
  const drafts: RepoIndexEdgeDraft[] = [];
  for (const regex of [
    /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[^'"]+\s+from\s+["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const match of node.text.matchAll(regex)) {
      drafts.push({
        from: relativePath,
        kind: "imports",
        specifier: match[1] ?? "",
        line,
      });
    }
  }
  return drafts;
}

function edgeDraftsForPython(
  relativePath: string,
  node: AstNode,
  line: number,
): RepoIndexEdgeDraft[] {
  if (node.type !== "import_from_statement") {
    return [];
  }
  const match = node.text.match(/^\s*from\s+(\.+[A-Za-z0-9_.]*)\s+import\s+/);
  if (!match?.[1]) {
    return [];
  }
  return [
    {
      from: relativePath,
      kind: "imports",
      specifier: normalizePythonRelativeSpecifier(match[1]),
      line,
    },
  ];
}

function edgeDraftsForRust(
  relativePath: string,
  node: AstNode,
  line: number,
): RepoIndexEdgeDraft[] {
  const drafts: RepoIndexEdgeDraft[] = [];
  if (node.type === "mod_item") {
    const match = node.text.match(/^\s*(?:pub\s+)?mod\s+([A-Za-z_][\w]*)\s*;/);
    if (match?.[1]) {
      drafts.push({ from: relativePath, kind: "imports", specifier: `./${match[1]}`, line });
    }
  }
  if (node.type === "use_declaration") {
    const match = node.text.match(/^\s*use\s+crate::([A-Za-z_][\w:]*)/);
    if (match?.[1]) {
      drafts.push({
        from: relativePath,
        kind: "imports",
        specifier: normalizeRustCrateSpecifier(relativePath, match[1]),
        line,
      });
    }
  }
  return drafts;
}

function calleeNameForNode(language: string, node: AstNode): string | undefined {
  const callNodeTypes = new Set(
    language === "python"
      ? ["call"]
      : language === "csharp"
        ? ["invocation_expression"]
        : ["call_expression"],
  );
  if (!callNodeTypes.has(node.type)) {
    return undefined;
  }

  const functionNode = node.childForFieldName?.("function");
  const calleeText = functionNode?.text ?? node.text.split("(", 1)[0] ?? "";
  const match = calleeText.trim().match(/(?:\.|::)?([A-Za-z_$][\w$]*)$/);
  return match?.[1];
}

function nameForNode(node: AstNode): string | undefined {
  const named = node.childForFieldName?.("name")?.text;
  if (named) {
    return named;
  }
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child && child.type === "identifier") {
      return child.text;
    }
  }
  return undefined;
}

function extractFallbackFacts(
  input: RepoFileExtractionInput,
  reason?: string,
): RepoFileExtractionResult {
  return {
    symbols: extractFallbackSymbols(input.path, input.language, input.content),
    edgeDrafts: extractFallbackEdgeDrafts(input.path, input.language, input.content),
    callDrafts: [],
    parser: {
      engine: "fallback",
      language: input.language,
      ...(reason ? { reason } : {}),
    },
  };
}

function extractFallbackSymbols(
  relativePath: string,
  language: string,
  content: string,
): RepoIndexSymbol[] {
  const lineStarts = createLineStarts(content);
  const symbols: RepoIndexSymbol[] = [];
  const seen = new Set<string>();

  function add(kind: RepoIndexSymbolKind, name: string, offset: number): void {
    const cleanedName =
      kind === "section" ? cleanMarkdownSymbolName(name) : cleanCodeSymbolName(name);
    if (!cleanedName) {
      return;
    }
    const line = lineForOffset(lineStarts, offset);
    const key = `${cleanedName}:${line}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    symbols.push({
      id: `${relativePath}#${cleanedName}:${line}`,
      name: cleanedName,
      kind,
      path: relativePath,
      line,
    });
  }

  if (language === "markdown") {
    for (const match of content.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
      add("section", match[2] ?? "", match.index ?? 0);
    }
    return symbols;
  }

  if (language === "typescript" || language === "javascript") {
    addRegexMatches(content, /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g, "function", add);
    addRegexMatches(content, /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g, "class", add);
    addRegexMatches(content, /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/g, "interface", add);
    addRegexMatches(content, /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g, "type", add);
    addRegexMatches(
      content,
      /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
      "function",
      add,
    );
    addRegexMatches(content, /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g, "constant", add);
  }

  if (language === "python") {
    addRegexMatches(content, /^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/gm, "function", add);
    addRegexMatches(content, /^class\s+([A-Za-z_][\w]*)\b/gm, "class", add);
    addRegexMatches(content, /^([A-Z][A-Z0-9_]*)\s*=/gm, "constant", add);
  }

  if (language === "rust") {
    addRegexMatches(
      content,
      /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*\(/g,
      "function",
      add,
    );
    addRegexMatches(content, /\b(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][\w]*)\b/g, "class", add);
    addRegexMatches(content, /\b(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_][\w]*)\b/g, "type", add);
    addRegexMatches(content, /\b(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_][\w]*)\b/g, "interface", add);
    addRegexMatches(content, /\b(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+([A-Za-z_][\w]*)\s*:/g, "constant", add);
  }

  if (language === "csharp") {
    addRegexMatches(content, /\b(?:public|private|protected|internal)?\s*(?:sealed\s+|abstract\s+|static\s+|partial\s+)*class\s+([A-Za-z_][\w]*)\b/g, "class", add);
    addRegexMatches(content, /\b(?:public|private|protected|internal)?\s*(?:partial\s+)?interface\s+([A-Za-z_][\w]*)\b/g, "interface", add);
    addRegexMatches(content, /\b(?:public|private|protected|internal)?\s*(?:readonly\s+)?(?:record|struct|enum)\s+([A-Za-z_][\w]*)\b/g, "type", add);
    addRegexMatches(
      content,
      /\b(?:public|private|protected|internal)\s+(?:static\s+|async\s+|virtual\s+|override\s+|sealed\s+|new\s+|partial\s+)*[A-Za-z_][\w<>,\[\]?]*(?:\s+[A-Za-z_][\w<>,\[\]?]*)?\s+([A-Za-z_][\w]*)\s*\(/g,
      "function",
      add,
    );
  }

  return symbols;
}

function addRegexMatches(
  content: string,
  regex: RegExp,
  kind: RepoIndexSymbolKind,
  add: (kind: RepoIndexSymbolKind, name: string, offset: number) => void,
): void {
  for (const match of content.matchAll(regex)) {
    add(kind, match[1] ?? "", match.index ?? 0);
  }
}

function extractFallbackEdgeDrafts(
  relativePath: string,
  language: string,
  content: string,
): RepoIndexEdgeDraft[] {
  const lineStarts = createLineStarts(content);
  const drafts: RepoIndexEdgeDraft[] = [];

  function add(
    kind: Extract<RepoIndexEdgeKind, "imports" | "links">,
    specifier: string,
    offset: number,
  ): void {
    if (!specifier) {
      return;
    }
    drafts.push({
      from: relativePath,
      specifier,
      kind,
      line: lineForOffset(lineStarts, offset),
    });
  }

  if (language === "typescript" || language === "javascript") {
    for (const regex of [
      /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
      /\bexport\s+[^'"]+\s+from\s+["']([^"']+)["']/g,
      /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    ]) {
      for (const match of content.matchAll(regex)) {
        add("imports", match[1] ?? "", match.index ?? 0);
      }
    }
  }

  if (language === "python") {
    for (const match of content.matchAll(/^\s*from\s+(\.+[A-Za-z0-9_.]*)\s+import\s+/gm)) {
      add("imports", normalizePythonRelativeSpecifier(match[1] ?? ""), match.index ?? 0);
    }
  }

  if (language === "rust") {
    for (const match of content.matchAll(/^\s*(?:pub\s+)?mod\s+([A-Za-z_][\w]*)\s*;/gm)) {
      add("imports", `./${match[1] ?? ""}`, match.index ?? 0);
    }
    for (const match of content.matchAll(/^\s*use\s+crate::([A-Za-z_][\w:]*)/gm)) {
      add("imports", normalizeRustCrateSpecifier(relativePath, match[1] ?? ""), match.index ?? 0);
    }
  }

  if (language === "markdown") {
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)#?]+)(?:[)#?][^)]*)?\)/g)) {
      add("links", match[1] ?? "", match.index ?? 0);
    }
  }

  return drafts;
}

function treeSitterLanguageFor(relativePath: string, language: string): TreeSitterLanguageId | undefined {
  const extension = path.extname(relativePath).toLowerCase();
  if (language === "typescript") {
    return extension === ".tsx" ? "tsx" : "typescript";
  }
  if (language === "javascript") {
    return extension === ".jsx" ? "tsx" : "javascript";
  }
  if (
    language === "python" ||
    language === "rust" ||
    language === "csharp"
  ) {
    return language;
  }
  return undefined;
}

function normalizePythonRelativeSpecifier(specifier: string): string {
  const dots = specifier.match(/^\.+/)?.[0] ?? "";
  const rest = specifier.slice(dots.length).replace(/\./g, "/");
  if (dots.length <= 1) {
    return `./${rest}`;
  }
  return `${"../".repeat(dots.length - 1)}${rest}`;
}

function normalizeRustCrateSpecifier(relativePath: string, modulePath: string): string {
  const targetPath = path.posix.join("src", modulePath.replace(/::/g, "/"));
  const relativeTarget = path.posix.relative(path.posix.dirname(relativePath), targetPath);
  return relativeTarget.startsWith(".") ? relativeTarget : `./${relativeTarget}`;
}

function cleanCodeSymbolName(name: string): string {
  return name.trim();
}

function cleanMarkdownSymbolName(name: string): string {
  return name.replace(/[`*_]/g, "").trim();
}

function createLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineForOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid] ?? 0;
    if (lineStart <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return high + 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const IGNORED_CALLEES = new Set(["import", "require", "console", "setTimeout", "setInterval"]);
