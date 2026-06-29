import { createRequire } from "node:module";

export type TreeSitterLanguageId =
  | "csharp"
  | "javascript"
  | "python"
  | "rust"
  | "tsx"
  | "typescript";

export type LoadedTreeSitterLanguage =
  | {
      available: true;
      language: TreeSitterLanguageId;
      parser: unknown;
    }
  | {
      available: false;
      language: TreeSitterLanguageId;
      reason: string;
    };

const require = createRequire(import.meta.url);
const cachedLanguages = new Map<TreeSitterLanguageId, LoadedTreeSitterLanguage>();

export function supportedTreeSitterLanguages(): TreeSitterLanguageId[] {
  return ["csharp", "javascript", "python", "rust", "tsx", "typescript"];
}

export function loadTreeSitterLanguage(language: TreeSitterLanguageId): LoadedTreeSitterLanguage {
  const cached = cachedLanguages.get(language);
  if (cached) {
    return cached;
  }

  try {
    const Parser = moduleDefault(require("tree-sitter")) as new () => {
      setLanguage: (grammar: unknown) => void;
    };
    const grammar = grammarFor(language);
    const parser = new Parser();
    parser.setLanguage(grammar);
    const loaded: LoadedTreeSitterLanguage = { available: true, language, parser };
    cachedLanguages.set(language, loaded);
    return loaded;
  } catch (error) {
    const loaded: LoadedTreeSitterLanguage = {
      available: false,
      language,
      reason: error instanceof Error ? error.message : String(error),
    };
    cachedLanguages.set(language, loaded);
    return loaded;
  }
}

function grammarFor(language: TreeSitterLanguageId): unknown {
  if (language === "typescript" || language === "tsx") {
    const mod = moduleDefault(require("tree-sitter-typescript")) as Record<string, unknown>;
    return language === "tsx" ? mod["tsx"] : mod["typescript"];
  }

  const packageName =
    language === "csharp" ? "tree-sitter-c-sharp" : `tree-sitter-${language}`;
  const mod = moduleDefault(require(packageName)) as Record<string, unknown>;
  return mod["language"] ?? mod;
}

function moduleDefault(value: unknown): unknown {
  if (value && typeof value === "object" && "default" in value) {
    return (value as { default: unknown }).default;
  }
  return value;
}
