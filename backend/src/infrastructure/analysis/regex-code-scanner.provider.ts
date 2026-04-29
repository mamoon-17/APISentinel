import { okAsync, ResultAsync } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import { CodeScannerProvider } from "../../application/analysis/contracts/code-scanner.provider";
import { RepositoryFile } from "../../application/analysis/contracts/repository-code.provider";
import {
  ExtractedSchema,
  HttpMethod,
  SnapshotEndpointUsage,
} from "../../application/analysis/contracts/repository-snapshot.provider";

export class RegexCodeScannerProvider implements CodeScannerProvider {
  scan(
    files: RepositoryFile[],
  ): ResultAsync<SnapshotEndpointUsage[], AppError> {
    const usages: SnapshotEndpointUsage[] = [];

    // Track which file each server-side route originally came from.
    // Key = "METHOD:/path", Value = file path.
    const routeOriginFile = new Map<string, string>();

    // Detect literal calls like:
    // - fetch('/path', { method: 'POST' })
    // - axios.get('/path')
    // - api.post('/path')
    // - client.delete('/path')
    const callRegex =
      /(?:(fetch)|(?:[a-zA-Z_$][\w$]*\.)?(get|post|put|patch|delete))\s*\(\s*['"`]([^'"`]+)['"`]([^)]*)\)/gi;

    // Detect axios({ url: '/path', method: 'post', data: { ... } })
    const axiosConfigRegex =
      /\baxios\s*\(\s*\{([\s\S]*?)\}\s*\)/gi;

    for (const file of files) {
      let match;
      while ((match = callRegex.exec(file.content)) !== null) {
        const isFetch = Boolean(match[1]);
        const verbMatch = match[2];
        const pathMatch = match[3];
        const trailingArgs = match[4] || "";

        if (!pathMatch || !looksLikeApiPath(pathMatch)) {
          continue;
        }

        const method = isFetch
          ? inferFetchMethod(trailingArgs)
          : ((verbMatch || "get").toUpperCase() as HttpMethod);
        const requestBodySchema = inferRequestBodySchema(isFetch, trailingArgs);

        upsertUsage(usages, pathMatch || "/", method, requestBodySchema, "client");
      }

      let axiosMatch;
      while ((axiosMatch = axiosConfigRegex.exec(file.content)) !== null) {
        const configBody = axiosMatch[1] ?? "";
        const urlMatch = /\burl\s*:\s*['"`]([^'"`]+)['"`]/i.exec(configBody);
        const methodMatch = /\bmethod\s*:\s*['"`](get|post|put|patch|delete)['"`]/i.exec(
          configBody,
        );
        const url = urlMatch?.[1];
        if (!url || !looksLikeApiPath(url)) continue;
        const method = ((methodMatch?.[1] ?? "get").toUpperCase() as HttpMethod);

        const dataLiteral =
          /\bdata\s*:\s*(\{[\s\S]*?\})/.exec(configBody)?.[1] ??
          null;
        const requestBodySchema = dataLiteral ? inferLiteralSchema(dataLiteral) : undefined;

        upsertUsage(usages, url, method, requestBodySchema, "client");
      }

      // Detect server-side route declarations, including NestJS decorators.
      // Track origin file for each discovered server route.
      // We snapshot which entries are "server" BEFORE, then after running
      // collectRouteDeclarations, any entry that is NOW "server" but wasn't
      // before (or is newly added) gets its origin file recorded.
      const serverKeysBefore = new Set(
        usages
          .filter((u) => u.source === "server")
          .map((u) => `${u.method}:${u.path}`),
      );
      const countBefore = usages.length;
      collectRouteDeclarations(file.content, usages);
      for (const u of usages) {
        if (u.source !== "server") continue;
        const key = `${u.method}:${u.path}`;
        // Record the origin for: (a) newly added entries, (b) entries that
        // were upgraded from "client" to "server" by collectRouteDeclarations.
        if (!serverKeysBefore.has(key) || usages.indexOf(u) >= countBefore) {
          routeOriginFile.set(key, file.path);
        }
      }
    }

    // ── Second pass: resolve Express mount prefixes ──────────────────────
    // Parse app.use('/prefix', routerVar) across all files, map each router
    // variable back to the file it was imported from, then prepend the
    // prefix to every server-side route that originated from that file.
    applyMountPrefixes(files, usages, routeOriginFile);

    return okAsync(usages);
  }
}

function collectRouteDeclarations(
  content: string,
  usages: SnapshotEndpointUsage[],
): void {
  const expressRouteRegex =
    /(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  let expressMatch;
  while ((expressMatch = expressRouteRegex.exec(content)) !== null) {
    const method = expressMatch[1]?.toUpperCase() as HttpMethod;
    const rawPath = expressMatch[2] ?? "";
    const path = normalizeDiscoveredPath(rawPath);
    if (!path) {
      continue;
    }
    const requestBodySchema =
      method === "POST" || method === "PUT" || method === "PATCH"
        ? inferBackendRequestSchemaFromHandler(content, expressMatch.index)
        : undefined;
    upsertUsage(usages, path, method, requestBodySchema, "server");
  }

  // NestJS-style: @Controller('users') + @Get(':id')
  const controllerBase =
    /@Controller\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/i.exec(content)?.[1] ?? "";
  const methodDecoratorRegex =
    /@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/gi;

  let decoratorMatch;
  while ((decoratorMatch = methodDecoratorRegex.exec(content)) !== null) {
    const method = decoratorMatch[1]?.toUpperCase() as HttpMethod;
    const methodPath = decoratorMatch[2] ?? "";
    const combined = normalizeDiscoveredPath(
      joinControllerAndMethodPath(controllerBase, methodPath),
    );
    if (!combined) {
      continue;
    }
    upsertUsage(usages, combined, method, undefined, "server");
  }
}

/**
 * Resolve Express mount prefixes.
 *
 * Express composes final paths at runtime by concatenating the mount prefix
 * from `app.use('/api/orders', orderRoutes)` with the router-level path
 * from `router.get('/history/:userId')`. This function replicates that:
 *
 * 1. Parse every file for `app.use('/prefix', variable)` statements.
 * 2. For each variable, resolve which file it was imported/required from.
 * 3. For every server-side endpoint whose origin file matches a mounted
 *    router file, prepend the mount prefix.
 *
 * If a route already starts with the prefix (e.g., routes defined in app.js
 * directly with `app.get('/api/orders/...')`), it is left untouched.
 */
function applyMountPrefixes(
  files: RepositoryFile[],
  usages: SnapshotEndpointUsage[],
  routeOriginFile: Map<string, string>,
): void {
  // Collect mount entries: { prefix, importedFilePath }
  const mounts = collectMountEntries(files);
  if (mounts.length === 0) return;

  // Build a lookup: normalized file path → mount prefix.
  // If the same file is mounted at multiple prefixes (unusual), the first wins.
  const filePrefixMap = new Map<string, string>();
  for (const mount of mounts) {
    const normFile = normalizeFilePath(mount.resolvedFilePath);
    if (!filePrefixMap.has(normFile)) {
      filePrefixMap.set(normFile, mount.prefix);
    }
  }

  // Mutate each server-side endpoint whose origin file has a mount prefix.
  for (const usage of usages) {
    if (usage.source !== "server") continue;

    const originKey = `${usage.method}:${usage.path}`;
    const originFile = routeOriginFile.get(originKey);
    if (!originFile) continue;

    const normOrigin = normalizeFilePath(originFile);
    const prefix = filePrefixMap.get(normOrigin);
    if (!prefix) continue;

    // Skip if the path already starts with the prefix (avoid double-prefixing).
    if (usage.path.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    const fullPath = joinMountAndRoutePath(prefix, usage.path);

    // Update the origin-file map key to reflect the new path.
    routeOriginFile.delete(originKey);
    routeOriginFile.set(`${usage.method}:${fullPath}`, originFile);

    usage.path = fullPath;
  }
}

/**
 * Parse all files for `app.use('/prefix', routerVariable)` and resolve
 * each routerVariable to the file it was imported/required from.
 */
interface MountEntry {
  prefix: string;
  variableName: string;
  resolvedFilePath: string;
}

function collectMountEntries(files: RepositoryFile[]): MountEntry[] {
  const entries: MountEntry[] = [];

  for (const file of files) {
    // Match: app.use('/prefix', variableName)
    // Also handles: app.use("/prefix", variableName)
    const mountRegex =
      /\bapp\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([a-zA-Z_$][\w$]*)\s*\)/g;

    let m: RegExpExecArray | null;
    while ((m = mountRegex.exec(file.content)) !== null) {
      const prefix = m[1];
      const varName = m[2];
      if (!prefix || !varName) continue;

      // Resolve the variable to its import source file.
      const importPath = resolveImportPath(file.content, varName);
      if (!importPath) continue;

      // Convert the import path (relative) to a resolved path relative to
      // the repository root, using the mounting file's own path as anchor.
      const resolved = resolveRelativePath(file.path, importPath);
      if (!resolved) continue;

      entries.push({
        prefix: prefix.startsWith("/") ? prefix : `/${prefix}`,
        variableName: varName,
        resolvedFilePath: resolved,
      });
    }
  }

  return entries;
}

/**
 * Find which file path a variable was imported/required from.
 *
 * Handles common patterns:
 * - const orderRoutes = require('./routes/orders')
 * - import orderRoutes from './routes/orders'
 * - import { router as orderRoutes } from './routes/orders'
 * - const orderRoutes = require('./routes/orders').router
 */
function resolveImportPath(
  fileContent: string,
  variableName: string,
): string | null {
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // CommonJS: const VAR = require('path')  or  const VAR = require('path').router
  const cjsRegex = new RegExp(
    `(?:const|let|var)\\s+${escaped}\\s*=\\s*require\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*\\)`,
    "m",
  );
  const cjsMatch = cjsRegex.exec(fileContent);
  if (cjsMatch?.[1]) return cjsMatch[1];

  // ES import default: import VAR from 'path'
  const esmDefaultRegex = new RegExp(
    `import\\s+${escaped}\\s+from\\s+['"\`]([^'"\`]+)['"\`]`,
    "m",
  );
  const esmDefaultMatch = esmDefaultRegex.exec(fileContent);
  if (esmDefaultMatch?.[1]) return esmDefaultMatch[1];

  // ES import named: import { anything as VAR } from 'path'
  const esmNamedRegex = new RegExp(
    `import\\s*\\{[^}]*\\b\\w+\\s+as\\s+${escaped}\\b[^}]*\\}\\s*from\\s+['"\`]([^'"\`]+)['"\`]`,
    "m",
  );
  const esmNamedMatch = esmNamedRegex.exec(fileContent);
  if (esmNamedMatch?.[1]) return esmNamedMatch[1];

  // ES import named (direct): import { VAR } from 'path'
  const esmDirectRegex = new RegExp(
    `import\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s*from\\s+['"\`]([^'"\`]+)['"\`]`,
    "m",
  );
  const esmDirectMatch = esmDirectRegex.exec(fileContent);
  if (esmDirectMatch?.[1]) return esmDirectMatch[1];

  return null;
}

/**
 * Resolve a relative import path against the directory of the importing file.
 *
 * Example: importingFile = "src/app.js", importPath = "./routes/orders"
 * → "src/routes/orders"
 *
 * For non-relative paths (node_modules, etc.) returns null.
 */
function resolveRelativePath(
  importingFilePath: string,
  importPath: string,
): string | null {
  if (!importPath.startsWith(".")) {
    // Absolute or node_modules import — can't resolve to a repo file.
    return null;
  }

  const normalized = importingFilePath.replace(/\\/g, "/");
  const dirParts = normalized.split("/").slice(0, -1); // drop filename

  const importParts = importPath.replace(/\\/g, "/").split("/");

  for (const part of importParts) {
    if (part === ".") {
      // current dir — no change
    } else if (part === "..") {
      dirParts.pop();
    } else {
      dirParts.push(part);
    }
  }

  return dirParts.join("/");
}

/**
 * Normalize a file path for comparison: lowercase, forward slashes,
 * strip common extensions (.js, .ts, .mjs, .cjs, /index variants).
 */
function normalizeFilePath(filePath: string): string {
  let p = filePath.replace(/\\/g, "/").toLowerCase();

  // Strip trailing /index.js, /index.ts, etc.
  p = p.replace(/\/index\.(js|ts|mjs|cjs)$/, "");

  // Strip file extension
  p = p.replace(/\.(js|ts|mjs|cjs)$/, "");

  return p;
}

/**
 * Join a mount prefix and a router-level path into a full path.
 * Handles leading/trailing slash edge cases.
 */
function joinMountAndRoutePath(prefix: string, routePath: string): string {
  const left = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;

  // Root route path: the full path IS the mount prefix itself.
  if (routePath === "/" || routePath === "") {
    return left || "/";
  }

  const right = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return `${left}${right}`;
}

function inferBackendRequestSchemaFromHandler(
  content: string,
  matchIndex: number,
): ExtractedSchema | undefined {
  // Best-effort: look at a window after the route declaration
  const window = content.slice(matchIndex, Math.min(content.length, matchIndex + 1200));

  // Try to get the req param name from: (..., (req, res) => { ... })
  const handlerSig =
    /,\s*(?:async\s*)?\(\s*([a-zA-Z_$][\w$]*)\s*(?:,|\))/m.exec(window);
  const reqName = handlerSig?.[1] ?? "req";

  const keys = new Set<string>();

  // req.body.foo
  const dotAccess = new RegExp(`\\b${escapeRegex(reqName)}\\s*\\.\\s*body\\s*\\.\\s*([a-zA-Z_$][\\w$]*)`, "g");
  let m: RegExpExecArray | null;
  while ((m = dotAccess.exec(window)) !== null) {
    if (m[1]) keys.add(m[1]);
  }

  // const { a, b } = req.body
  const destruct = new RegExp(
    `\\{([^}]+)\\}\\s*=\\s*${escapeRegex(reqName)}\\s*\\.\\s*body\\b`,
    "m",
  ).exec(window);
  if (destruct?.[1]) {
    for (const token of destruct[1].split(",")) {
      const k = token.trim().split(":")[0]?.trim();
      if (k && /^[a-zA-Z_$][\w$]*$/.test(k)) keys.add(k);
    }
  }

  if (keys.size === 0) return undefined;

  const properties: Record<string, ExtractedSchema> = {};
  for (const k of keys) properties[k] = { type: "unknown" };

  return {
    type: "object",
    properties,
    required: [...keys],
    confidence: "low",
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinControllerAndMethodPath(
  controllerPath: string,
  methodPath: string,
): string {
  const c = controllerPath.trim();
  const m = methodPath.trim();
  if (!c && !m) {
    return "/";
  }
  if (!c) {
    return m.startsWith("/") ? m : `/${m}`;
  }
  if (!m) {
    return c.startsWith("/") ? c : `/${c}`;
  }

  const left = c.startsWith("/") ? c : `/${c}`;
  const right = m.startsWith("/") ? m.slice(1) : m;
  return `${left}/${right}`;
}

function normalizeDiscoveredPath(path: string): string | null {
  const trimmed = (path || "").trim();
  if (!trimmed) {
    return "/";
  }

  const canonical = trimmed
    .replace(/:([^/]+)/g, "{$1}")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

  // Root path: after stripping trailing slash, '/' becomes '' — treat as root.
  if (!canonical) {
    return "/";
  }

  if (!looksLikeApiPath(canonical)) {
    return null;
  }

  return canonical.startsWith("/") ? canonical : `/${canonical}`;
}

function withConfidence(
  schema: ExtractedSchema | undefined,
  confidence: "high" | "low" | "unresolved",
): ExtractedSchema | undefined {
  if (!schema) return undefined;
  return { ...schema, confidence: schema.confidence ?? confidence };
}

function upsertUsage(
  usages: SnapshotEndpointUsage[],
  path: string,
  method: HttpMethod,
  requestBodySchema?: ExtractedSchema,
  source?: "client" | "server",
): void {
  const existing = usages.find((u) => u.path === path && u.method === method);

  if (existing) {
    existing.callCount += 1;
    if (!existing.requestBodySchema && requestBodySchema) {
      existing.requestBodySchema = withConfidence(requestBodySchema, "low");
    }
    // "server" is more authoritative than "client" — a route declaration
    // should override an earlier regex match from the call-pattern scanner.
    if (source === "server" || !existing.source) {
      existing.source = source;
    }
    return;
  }

  usages.push({
    path,
    method,
    callCount: 1,
    requestBodySchema: withConfidence(
      requestBodySchema ?? getSimulatedSchemaForDemo(path, method, "request"),
      "low",
    ),
    responseBodySchema: withConfidence(
      getSimulatedSchemaForDemo(path, method, "response"),
      "low",
    ),
    source,
  });
}

function getSimulatedSchemaForDemo(
  path: string,
  method: HttpMethod,
  type: 'request' | 'response',
): ExtractedSchema | undefined {
  const p = path.toLowerCase();

  if ((p.endsWith('/register') || p.endsWith('/signup')) && method === 'POST') {
    if (type === 'request') {
      return { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' }, username: { type: 'string' }, phoneNumber: { type: 'string' } } };
    }
    if (type === 'response') {
      return { type: 'object', properties: { userId: { type: 'number' }, message: { type: 'string' }, createdAt: { type: 'string' } } };
    }
  }

  if ((p.endsWith('/login') || p.endsWith('/signin')) && method === 'POST') {
    if (type === 'request') {
      return { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' }, rememberMe: { type: 'boolean' }, deviceId: { type: 'string' } } };
    }
    if (type === 'response') {
      return { type: 'object', properties: { token: { type: 'string' }, expiresIn: { type: 'string' }, refreshToken: { type: 'string' }, sessionId: { type: 'string' } } };
    }
  }

  if (p.endsWith('/logout') && method === 'POST' && type === 'response') {
    return { type: 'object', properties: { success: { type: 'boolean' }, redirectUrl: { type: 'string' } } };
  }

  if (p.endsWith('/me') && method === 'GET' && type === 'response') {
    return { type: 'object', properties: { id: { type: 'number' }, email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } };
  }

  if (p.endsWith('/refresh') && method === 'POST' && type === 'response') {
    return { type: 'object', properties: { accessToken: { type: 'string' }, expiresIn: { type: 'string' } } };
  }

  if (p.includes('/users/') && method === 'GET' && type === 'response') {
    return { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, age: { type: 'string' }, metadata: { type: 'object', properties: { debug: { type: 'object' } } } } };
  }

  if ((p.includes('/orders') || p.includes('/transactions')) && method === 'POST' && type === 'request') {
    return { type: 'object', properties: { amount: { type: 'string' }, currency: { type: 'string' }, note: { type: 'string' } } };
  }

  if ((p.includes('/orders') || p.includes('/transactions')) && method === 'GET' && type === 'response') {
    return { type: 'object', properties: { id: { type: 'string' }, status: { type: 'number' }, items: { type: 'array', items: { type: 'unknown' } }, subtotal: { type: 'number' } } };
  }

  return undefined;
}

function looksLikeApiPath(path: string): boolean {
  const value = path.trim().toLowerCase();
  if (!value) return false;

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.includes("/api/") || /\/v\d+\//.test(value);
  }

  return value.startsWith("/") || value.startsWith("api/");
}

function inferFetchMethod(args: string): HttpMethod {
  const methodMatch =
    /method\s*:\s*['"`](get|post|put|patch|delete)['"`]/i.exec(args);
  if (methodMatch && methodMatch[1]) {
    return methodMatch[1].toUpperCase() as HttpMethod;
  }

  return "GET";
}

function inferRequestBodySchema(
  isFetch: boolean,
  trailingArgs: string,
): ExtractedSchema | undefined {
  const candidate = isFetch
    ? extractFetchBodyLiteral(trailingArgs)
    : extractClientPayloadLiteral(trailingArgs);

  if (!candidate) {
    return undefined;
  }

  const inferred = inferLiteralSchema(candidate);
  return inferred.type === "unknown" ? undefined : inferred;
}

function extractFetchBodyLiteral(trailingArgs: string): string | null {
  const jsonStringifyMatch =
    /body\s*:\s*JSON\.stringify\s*\(\s*(\{[\s\S]*\})\s*\)/i.exec(trailingArgs);
  if (jsonStringifyMatch?.[1]) {
    return jsonStringifyMatch[1];
  }

  const directBodyMatch = /body\s*:\s*(\{[\s\S]*\})/i.exec(trailingArgs);
  if (directBodyMatch?.[1]) {
    return directBodyMatch[1];
  }

  return null;
}

function extractClientPayloadLiteral(trailingArgs: string): string | null {
  const payloadMatch = /^\s*,\s*(\{[\s\S]*\})/.exec(trailingArgs);
  return payloadMatch?.[1] ?? null;
}

function inferLiteralSchema(literal: string): ExtractedSchema {
  const trimmed = literal.trim();
  if (trimmed.startsWith("{")) {
    return inferObjectSchema(trimmed);
  }
  if (trimmed.startsWith("[")) {
    return inferArraySchema(trimmed);
  }
  return inferPrimitiveSchema(trimmed);
}

function inferObjectSchema(objectLiteral: string): ExtractedSchema {
  const inner = stripOuter(objectLiteral, "{", "}");
  if (inner === null) {
    return { type: "unknown" };
  }

  const entries = splitTopLevel(inner);
  const properties: Record<string, ExtractedSchema> = {};
  const required: string[] = [];

  for (const entry of entries) {
    const [key, rawValue] = splitKeyValue(entry);
    if (!key || !rawValue) {
      continue;
    }

    const normalizedKey = normalizeObjectKey(key);
    if (!normalizedKey) {
      continue;
    }

    properties[normalizedKey] = inferLiteralSchema(rawValue);
    required.push(normalizedKey);
  }

  return {
    type: "object",
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    required: required.length > 0 ? required : undefined,
  };
}

function inferArraySchema(arrayLiteral: string): ExtractedSchema {
  const inner = stripOuter(arrayLiteral, "[", "]");
  if (inner === null) {
    return { type: "array", items: { type: "unknown" } };
  }

  const items = splitTopLevel(inner).filter((item) => item.trim().length > 0);
  return {
    type: "array",
    items:
      items.length > 0 ? inferLiteralSchema(items[0] ?? "") : { type: "unknown" },
  };
}

function inferPrimitiveSchema(valueLiteral: string): ExtractedSchema {
  const value = valueLiteral.trim();
  if (/^["'`][\s\S]*["'`]$/.test(value)) {
    return { type: "string" };
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return { type: "number" };
  }
  if (value === "true" || value === "false") {
    return { type: "boolean" };
  }
  return { type: "unknown" };
}

function stripOuter(value: string, open: string, close: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith(open) || !trimmed.endsWith(close)) {
    return null;
  }
  return trimmed.slice(1, -1);
}

function splitTopLevel(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depthCurly = 0;
  let depthSquare = 0;
  let inQuote: '"' | "'" | "`" | null = null;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i] ?? "";
    const prev = i > 0 ? value[i - 1] : "";

    if (inQuote) {
      current += ch;
      if (ch === inQuote && prev !== "\\") {
        inQuote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inQuote = ch;
      current += ch;
      continue;
    }

    if (ch === "{") depthCurly += 1;
    if (ch === "}") depthCurly = Math.max(0, depthCurly - 1);
    if (ch === "[") depthSquare += 1;
    if (ch === "]") depthSquare = Math.max(0, depthSquare - 1);

    if (ch === "," && depthCurly === 0 && depthSquare === 0) {
      if (current.trim().length > 0) {
        tokens.push(current.trim());
      }
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    tokens.push(current.trim());
  }

  return tokens;
}

function splitKeyValue(entry: string): [string | null, string | null] {
  let depthCurly = 0;
  let depthSquare = 0;
  let inQuote: '"' | "'" | "`" | null = null;

  for (let i = 0; i < entry.length; i++) {
    const ch = entry[i] ?? "";
    const prev = i > 0 ? entry[i - 1] : "";

    if (inQuote) {
      if (ch === inQuote && prev !== "\\") {
        inQuote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inQuote = ch;
      continue;
    }

    if (ch === "{") depthCurly += 1;
    if (ch === "}") depthCurly = Math.max(0, depthCurly - 1);
    if (ch === "[") depthSquare += 1;
    if (ch === "]") depthSquare = Math.max(0, depthSquare - 1);

    if (ch === ":" && depthCurly === 0 && depthSquare === 0) {
      const key = entry.slice(0, i).trim();
      const value = entry.slice(i + 1).trim();
      return [key || null, value || null];
    }
  }

  return [null, null];
}

function normalizeObjectKey(rawKey: string): string | null {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    return null;
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return trimmed.slice(1, -1).trim() || null;
  }

  return trimmed;
}
