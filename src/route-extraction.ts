import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ExtractedRouteEndpoint = {
  method: string;
  pathTemplate: string;
  sourcePath: string;
  authRequired: boolean;
};

export type ExtractRouteEndpointsInput = {
  repoRoot: string;
  files: string[];
};

type RoutePrefixRelation = {
  parentPath: string;
  targetPath: string;
  prefix: string;
  authRequired: boolean;
};

const ROUTE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"];

export function extractRouteEndpoints(input: ExtractRouteEndpointsInput): ExtractedRouteEndpoint[] {
  const repoRoot = path.resolve(input.repoRoot);
  const files = uniqueSorted(input.files.map(toRepoPath).filter(isRouteCandidatePath));
  const fileSet = new Set(files);
  const directByFile = new Map<string, ExtractedRouteEndpoint[]>();
  const prefixRelations: RoutePrefixRelation[] = [];

  for (const repoPath of files) {
    const content = safeRead(path.join(repoRoot, repoPath));
    if (!content) {
      continue;
    }
    const authRequired = isAuthRelated(content);
    directByFile.set(repoPath, extractDirectRoutes(repoPath, content, authRequired));
    const imports = collectLocalImports(repoPath, content, fileSet);
    prefixRelations.push(...collectPrefixRelations(repoPath, content, imports, authRequired));
  }

  const targetFiles = new Set(prefixRelations.map((relation) => relation.targetPath));
  const endpoints: ExtractedRouteEndpoint[] = [];
  for (const [repoPath, direct] of directByFile.entries()) {
    if (!targetFiles.has(repoPath)) {
      endpoints.push(...direct);
    }
  }

  for (const relation of prefixRelations) {
    const childRoutes = directByFile.get(relation.targetPath) ?? [];
    for (const route of childRoutes) {
      endpoints.push({
        ...route,
        pathTemplate: joinRoutePath(relation.prefix, route.pathTemplate),
        authRequired: relation.authRequired || route.authRequired,
      });
    }
  }

  return uniqueRoutes(endpoints);
}

function extractDirectRoutes(
  repoPath: string,
  content: string,
  authRequired: boolean,
): ExtractedRouteEndpoint[] {
  const endpoints: ExtractedRouteEndpoint[] = [];
  for (const match of content.matchAll(/\b(?:app|router|fastify|server)\.(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/gi)) {
    const method = match[1]?.toUpperCase();
    const pathTemplate = match[2];
    if (method && pathTemplate) {
      endpoints.push({ method, pathTemplate, sourcePath: repoPath, authRequired });
    }
  }

  for (const match of content.matchAll(/\b(?:app|fastify|server)\.route\s*\(\s*\{([\s\S]*?)\}\s*\)/gi)) {
    const body = match[1] ?? "";
    const pathTemplate =
      body.match(/\b(?:url|path)\s*:\s*["'`]([^"'`]+)["'`]/i)?.[1] ??
      body.match(/\b(?:url|path)\s*:\s*`([^`$]+)`/i)?.[1];
    if (!pathTemplate) {
      continue;
    }
    for (const method of routeMethodsFromObject(body)) {
      endpoints.push({ method, pathTemplate, sourcePath: repoPath, authRequired });
    }
  }

  return uniqueRoutes(endpoints);
}

function routeMethodsFromObject(body: string): string[] {
  const literal = body.match(/\bmethod\s*:\s*["'`]([A-Za-z]+)["'`]/i)?.[1];
  if (literal) {
    return [literal.toUpperCase()];
  }
  const array = body.match(/\bmethod\s*:\s*\[([^\]]+)\]/i)?.[1];
  if (!array) {
    return [];
  }
  return uniqueSorted(
    [...array.matchAll(/["'`]([A-Za-z]+)["'`]/g)]
      .map((match) => match[1]?.toUpperCase() ?? "")
      .filter(Boolean),
  );
}

function collectPrefixRelations(
  repoPath: string,
  content: string,
  imports: Map<string, string>,
  authRequired: boolean,
): RoutePrefixRelation[] {
  const relations: RoutePrefixRelation[] = [];
  for (const match of content.matchAll(/\b(?:fastify|app|server)\.register\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*\{[\s\S]*?\bprefix\s*:\s*["'`]([^"'`]+)["'`]/gi)) {
    const identifier = match[1];
    const prefix = match[2];
    const targetPath = identifier ? imports.get(identifier) : undefined;
    if (targetPath && prefix) {
      relations.push({ parentPath: repoPath, targetPath, prefix, authRequired });
    }
  }

  for (const match of content.matchAll(/\b(?:app|router)\.use\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z_$][\w$]*)/gi)) {
    const prefix = match[1];
    const identifier = match[2];
    const targetPath = identifier ? imports.get(identifier) : undefined;
    if (targetPath && prefix) {
      relations.push({ parentPath: repoPath, targetPath, prefix, authRequired });
    }
  }

  return relations;
}

function collectLocalImports(
  repoPath: string,
  content: string,
  fileSet: Set<string>,
): Map<string, string> {
  const imports = new Map<string, string>();
  function addBinding(identifier: string | undefined, specifier: string | undefined): void {
    if (!identifier || !specifier || !specifier.startsWith(".")) {
      return;
    }
    const target = resolveRelativeSpecifier(repoPath, specifier, fileSet);
    if (target) {
      imports.set(identifier, target);
    }
  }

  for (const match of content.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/g)) {
    addBinding(match[1], match[2]);
  }
  for (const match of content.matchAll(/\bimport\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)) {
    const specifier = match[2];
    for (const binding of parseNamedBindings(match[1] ?? "")) {
      addBinding(binding, specifier);
    }
  }
  for (const match of content.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g)) {
    addBinding(match[1], match[2]);
  }
  for (const match of content.matchAll(/\bconst\s+\{([^}]+)\}\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[2];
    for (const binding of parseNamedBindings(match[1] ?? "")) {
      addBinding(binding, specifier);
    }
  }

  return imports;
}

function parseNamedBindings(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .map((part) => part.match(/\bas\s+([A-Za-z_$][\w$]*)$/)?.[1] ?? part.split(/\s*:\s*/).pop() ?? part)
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z_$][\w$]*$/.test(part));
}

function resolveRelativeSpecifier(
  fromPath: string,
  specifier: string,
  fileSet: Set<string>,
): string | undefined {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  const candidates = [
    base,
    ...ROUTE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...ROUTE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => fileSet.has(candidate));
}

function joinRoutePath(prefix: string, child: string): string {
  const normalizedPrefix = prefix.startsWith("/") ? prefix : `/${prefix}`;
  if (child === "/" || child.length === 0) {
    return normalizedPrefix;
  }
  const normalizedChild = child.startsWith("/") ? child : `/${child}`;
  return `${normalizedPrefix.replace(/\/+$/, "")}${normalizedChild}`;
}

function isRouteCandidatePath(repoPath: string): boolean {
  return ROUTE_EXTENSIONS.includes(path.extname(repoPath).toLowerCase());
}

function isAuthRelated(content: string): boolean {
  return /\b(authenticate|authorization|requirePermission|permission|preHandler|security|jwt|session)\b/i.test(content);
}

function safeRead(filePath: string): string {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  } catch {
    return "";
  }
}

function uniqueRoutes(values: ExtractedRouteEndpoint[]): ExtractedRouteEndpoint[] {
  const byKey = new Map<string, ExtractedRouteEndpoint>();
  for (const value of values) {
    byKey.set(`${value.method} ${value.pathTemplate} ${value.sourcePath}`, value);
  }
  return [...byKey.values()].sort((left, right) =>
    left.pathTemplate.localeCompare(right.pathTemplate) ||
    left.method.localeCompare(right.method) ||
    left.sourcePath.localeCompare(right.sourcePath),
  );
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
