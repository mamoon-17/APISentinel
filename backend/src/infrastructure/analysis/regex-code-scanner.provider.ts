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
    const debug = process.env.ANALYSIS_DEBUG?.toLowerCase() === "true";
    if (debug) {
      console.log(`[RegexCodeScanner] Starting scan of ${files.length} files`);
    }
    const filesByPath = new Map(
      files.map(
        (file) => [normalizeRepositoryFilePath(file.path), file] as const,
      ),
    );

    // Track which file each server-side route originally came from.
    // Key = "METHOD:/path", Value = file path.
    const routeOriginFile = new Map<string, string>();

    // Detect literal calls like:
    // - fetch('/path', { method: 'POST' })
    // - axios.get('/path')
    // - api.post('/path')
    // - client.delete('/path')
    // - this.http.get('/path')           ← Angular HttpClient pattern
    // - this.apiService.post('/path')    ← multi-level access
    const callRegex =
      /(?:(fetch)|(?:(?:this|[a-zA-Z_$][\w$]*)(?:\.[\w$]+)*\.)?(get|post|put|patch|delete))\s*\(\s*['"`]([^'"`]+)['"`]([^)]*)\)/gi;
    const symbolicCallRegex =
      /(?:(fetch)|(?:(?:this|[a-zA-Z_$][\w$]*)(?:\.[\w$]+)*\.)?(get|post|put|patch|delete))\s*\(\s*((?:new\s+)?[a-zA-Z_$][\w$.]*(?:\([^)]*\))?)\s*([^)]*)\)/gi;

    // Detect axios({ url: '/path', method: 'post', data: { ... } })
    const axiosConfigRegex = /\baxios\s*\(\s*\{([\s\S]*?)\}\s*\)/gi;
    // Detect client.request({ url: '/path', method: 'post', data: { ... } })
    const requestConfigRegex =
      /\b[a-zA-Z_$][\w$]*\.request\s*\(\s*\{([\s\S]*?)\}\s*\)/gi;

    for (const file of files) {
      const beforeCount = usages.length;
      // Only scan for client-side HTTP calls in files that are plausibly frontend code.
      // Backend route/controller/service files contain router.get('/path') patterns
      // that the callRegex also matches, creating phantom "frontend" entries.
      const isLikelyBackendFile = isBackendSourceFile(file.path, file.content);

      // Reset regex state per file to avoid skipping matches across files.
      callRegex.lastIndex = 0;
      symbolicCallRegex.lastIndex = 0;
      axiosConfigRegex.lastIndex = 0;
      requestConfigRegex.lastIndex = 0;

      if (debug) {
        console.log(`[RegexCodeScanner] Scanning file=${file.path}`);
      }
      let match;
      while (
        !isLikelyBackendFile &&
        (match = callRegex.exec(file.content)) !== null
      ) {
        const isFetch = Boolean(match[1]);
        const verbMatch = match[2];
        const pathMatch = match[3];
        const trailingArgs = match[4] || "";

        const resolvedLiteralPath = pathMatch?.includes("${")
          ? resolveApiPathReference(`\`${pathMatch}\``, file, filesByPath)
          : pathMatch && looksLikeApiPath(pathMatch)
            ? pathMatch
            : null;
        const normalizedPath = resolvedLiteralPath
          ? normalizeClientPath(resolvedLiteralPath)
          : null;

        if (!normalizedPath) {
          continue;
        }

        const method = isFetch
          ? inferFetchMethod(trailingArgs)
          : ((verbMatch || "get").toUpperCase() as HttpMethod);
        const requestBodySchema = inferRequestBodySchema(isFetch, trailingArgs);
        const responseSchema = inferClientResponseUsageSchema(
          file.content,
          match.index,
          match[0].length,
        );

        upsertUsage(
          usages,
          normalizedPath,
          method,
          requestBodySchema,
          "client",
          responseSchema,
        );
      }

      let symbolicMatch;
      while (
        !isLikelyBackendFile &&
        (symbolicMatch = symbolicCallRegex.exec(file.content)) !== null
      ) {
        const isFetch = Boolean(symbolicMatch[1]);
        const verbMatch = symbolicMatch[2];
        const rawExpression = symbolicMatch[3]?.trim() ?? "";
        const trailingArgs = symbolicMatch[4] || "";

        if (
          !rawExpression ||
          rawExpression.startsWith("'") ||
          rawExpression.startsWith('"') ||
          rawExpression.startsWith("`")
        ) {
          continue;
        }

        const resolvedPath = resolveApiPathReference(
          rawExpression,
          file,
          filesByPath,
        );
        const normalizedPath = resolvedPath
          ? normalizeClientPath(resolvedPath)
          : null;
        if (!normalizedPath) {
          continue;
        }

        const method = isFetch
          ? inferFetchMethod(trailingArgs)
          : ((verbMatch || "get").toUpperCase() as HttpMethod);
        const requestBodySchema = inferRequestBodySchema(isFetch, trailingArgs);
        const responseSchema = inferClientResponseUsageSchema(
          file.content,
          symbolicMatch.index,
          symbolicMatch[0].length,
        );

        upsertUsage(
          usages,
          normalizedPath,
          method,
          requestBodySchema,
          "client",
          responseSchema,
        );
      }

      let axiosMatch;
      while (
        !isLikelyBackendFile &&
        (axiosMatch = axiosConfigRegex.exec(file.content)) !== null
      ) {
        const configBody = axiosMatch[1] ?? "";
        const urlMatch = /\burl\s*:\s*['"`]([^'"`]+)['"`]/i.exec(configBody);
        const urlRefMatch =
          /\burl\s*:\s*([a-zA-Z_$][\w$.]*(?:\([^)]*\))?)/i.exec(configBody);
        const methodMatch =
          /\bmethod\s*:\s*['"`](get|post|put|patch|delete)['"`]/i.exec(
            configBody,
          );
        const url =
          urlMatch?.[1] ??
          (urlRefMatch?.[1]
            ? resolveApiPathReference(urlRefMatch[1], file, filesByPath)
            : null);
        const normalizedPath = url ? normalizeClientPath(url) : null;
        if (!normalizedPath) continue;
        const method = (methodMatch?.[1] ?? "get").toUpperCase() as HttpMethod;

        const dataLiteral =
          /\bdata\s*:\s*(\{[\s\S]*?\})/.exec(configBody)?.[1] ?? null;
        const requestBodySchema = dataLiteral
          ? inferLiteralSchema(dataLiteral)
          : undefined;
        const responseSchema = inferClientResponseUsageSchema(
          file.content,
          axiosMatch.index,
          axiosMatch[0].length,
        );

        upsertUsage(
          usages,
          normalizedPath,
          method,
          requestBodySchema,
          "client",
          responseSchema,
        );
      }

      let requestMatch;
      while (
        !isLikelyBackendFile &&
        (requestMatch = requestConfigRegex.exec(file.content)) !== null
      ) {
        const configBody = requestMatch[1] ?? "";
        const urlMatch = /\burl\s*:\s*['"`]([^'"`]+)['"`]/i.exec(configBody);
        const urlRefMatch =
          /\burl\s*:\s*([a-zA-Z_$][\w$.]*(?:\([^)]*\))?)/i.exec(configBody);
        const methodMatch =
          /\bmethod\s*:\s*['"`](get|post|put|patch|delete)['"`]/i.exec(
            configBody,
          );
        const url =
          urlMatch?.[1] ??
          (urlRefMatch?.[1]
            ? resolveApiPathReference(urlRefMatch[1], file, filesByPath)
            : null);
        const normalizedPath = url ? normalizeClientPath(url) : null;
        if (!normalizedPath) continue;
        const method = (methodMatch?.[1] ?? "get").toUpperCase() as HttpMethod;

        const dataLiteral =
          /\bdata\s*:\s*(\{[\s\S]*?\})/.exec(configBody)?.[1] ?? null;
        const requestBodySchema = dataLiteral
          ? inferLiteralSchema(dataLiteral)
          : undefined;
        const responseSchema = inferClientResponseUsageSchema(
          file.content,
          requestMatch.index,
          requestMatch[0].length,
        );

        upsertUsage(
          usages,
          normalizedPath,
          method,
          requestBodySchema,
          "client",
          responseSchema,
        );
      }

      // Detect SWR hooks: useSWR('/path', fetcher) and useSWRInfinite
      // Key: first arg is the cache key/path string or template literal.
      const swrRegex =
        /\buseSWR(?:Infinite|Mutation)?\s*(?:<[^>]*>)?\s*\(\s*(?:(?:['"`]([^'"`]+)['"`])|(`[^`]+`))\s*[,)]/gi;
      swrRegex.lastIndex = 0;
      let swrMatch;
      while (!isLikelyBackendFile && (swrMatch = swrRegex.exec(file.content)) !== null) {
        const literalPath = swrMatch[1];
        const templatePath = swrMatch[2];
        const rawPath = literalPath ?? templatePath ?? null;
        if (!rawPath) continue;

        const resolvedPath = templatePath
          ? resolveApiPathReference(templatePath, file, filesByPath)
          : rawPath && looksLikeApiPath(rawPath)
            ? rawPath
            : null;
        const normalizedPath = resolvedPath ? normalizeClientPath(resolvedPath) : null;
        if (!normalizedPath) continue;

        upsertUsage(usages, normalizedPath, "GET", undefined, "client", undefined);
      }

      // Detect React Query / TanStack Query:
      // useQuery(['/path', ...], ...)
      // useQuery({ queryKey: ['/path'], queryFn: ... })
      // useQuery('/path', fetcher)    ← v3 style
      // useMutation({ mutationFn: () => fetch('/path') })
      const reactQueryArrayRegex =
        /\buse(?:Query|InfiniteQuery|Queries)\s*(?:<[^>]*>)?\s*\(\s*\[\s*['"`]([^'"`]+)['"`]/gi;
      reactQueryArrayRegex.lastIndex = 0;
      let rqArrayMatch;
      while (!isLikelyBackendFile && (rqArrayMatch = reactQueryArrayRegex.exec(file.content)) !== null) {
        const rawPath = rqArrayMatch[1] ?? null;
        if (!rawPath || !looksLikeApiPath(rawPath)) continue;
        const normalizedPath = normalizeClientPath(rawPath);
        if (!normalizedPath) continue;
        upsertUsage(usages, normalizedPath, "GET", undefined, "client", undefined);
      }

      // useQuery('/path', fetcher) — v3 string-key style
      const reactQueryStringRegex =
        /\buse(?:Query|InfiniteQuery)\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]\s*[,)]/gi;
      reactQueryStringRegex.lastIndex = 0;
      let rqStrMatch;
      while (!isLikelyBackendFile && (rqStrMatch = reactQueryStringRegex.exec(file.content)) !== null) {
        const rawPath = rqStrMatch[1] ?? null;
        if (!rawPath || !looksLikeApiPath(rawPath)) continue;
        const normalizedPath = normalizeClientPath(rawPath);
        if (!normalizedPath) continue;
        upsertUsage(usages, normalizedPath, "GET", undefined, "client", undefined);
      }

      // RTK Query: builder.query({ query: () => '/path' }) and
      // builder.mutation({ query: (arg) => ({ url: '/path', method: 'POST' }) })
      const rtkQueryFnStringRegex =
        /\bbuilder\s*\.\s*(query|mutation)\s*\(\s*\{[\s\S]*?\bquery\s*:\s*(?:\([^)]*\)\s*=>|function[^(]*\([^)]*\)\s*)\s*(?:\(\s*)?['"`]([^'"`]+)['"`]/gi;
      rtkQueryFnStringRegex.lastIndex = 0;
      let rtkMatch;
      while (!isLikelyBackendFile && (rtkMatch = rtkQueryFnStringRegex.exec(file.content)) !== null) {
        const isQuery = (rtkMatch[1] ?? "query").toLowerCase() === "query";
        const rawPath = rtkMatch[2] ?? null;
        if (!rawPath || !looksLikeApiPath(rawPath)) continue;
        const normalizedPath = normalizeClientPath(rawPath);
        if (!normalizedPath) continue;
        upsertUsage(usages, normalizedPath, isQuery ? "GET" : "POST", undefined, "client", undefined);
      }

      // RTK Query object form: builder.mutation({ query: (arg) => ({ url: '/path', method: 'PUT' }) })
      const rtkQueryUrlRegex =
        /\bbuilder\s*\.\s*(query|mutation)\s*\(\s*\{[\s\S]*?\bquery\s*:[^}]*?\burl\s*:\s*['"`]([^'"`]+)['"`][\s\S]*?\bmethod\s*:\s*['"`](get|post|put|patch|delete)['"`]/gi;
      rtkQueryUrlRegex.lastIndex = 0;
      let rtkUrlMatch;
      while (!isLikelyBackendFile && (rtkUrlMatch = rtkQueryUrlRegex.exec(file.content)) !== null) {
        const rawPath = rtkUrlMatch[2] ?? null;
        const methodStr = rtkUrlMatch[3] ?? "get";
        if (!rawPath || !looksLikeApiPath(rawPath)) continue;
        const normalizedPath = normalizeClientPath(rawPath);
        if (!normalizedPath) continue;
        upsertUsage(usages, normalizedPath, methodStr.toUpperCase() as HttpMethod, undefined, "client", undefined);
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
      const added = usages.length - beforeCount;
      if (debug && added > 0) {
        console.log(`[RegexCodeScanner] file=${file.path} → added ${added} usages (total ${usages.length})`);
      }
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

    const clientCount = usages.filter((u) => u.source === "client").length;
    const serverCount = usages.filter((u) => u.source === "server").length;
    if (debug) {
      console.log(`[RegexCodeScanner] Completed scan — usages=${usages.length} client=${clientCount} server=${serverCount}`);
    }
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

  collectPythonRouteDeclarations(content, usages);
}

function collectPythonRouteDeclarations(
  content: string,
  usages: SnapshotEndpointUsage[],
): void {
  const routerPrefixes = collectPythonRouterPrefixes(content);

  // FastAPI/APIRouter style: @app.get("/users/{id}") or @router.post("/users")
  const fastApiDecoratorRegex =
    /@([\w.]+)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi;

  let fastApiMatch: RegExpExecArray | null;
  while ((fastApiMatch = fastApiDecoratorRegex.exec(content)) !== null) {
    const routerName = fastApiMatch[1]?.split(".").pop() ?? "";
    const method = fastApiMatch[2]?.toUpperCase() as HttpMethod;
    const rawPath = joinControllerAndMethodPath(
      routerPrefixes.get(routerName) ?? "",
      fastApiMatch[3] ?? "",
    );
    const path = normalizeDiscoveredPath(rawPath);
    if (!path) continue;
    upsertUsage(usages, path, method, undefined, "server");
  }

  // Flask style: @app.route("/users", methods=["GET", "POST"])
  const flaskRouteRegex =
    /@[\w.]+\.route\s*\(\s*['"]([^'"]+)['"]([\s\S]*?)\)/gi;

  let flaskMatch: RegExpExecArray | null;
  while ((flaskMatch = flaskRouteRegex.exec(content)) !== null) {
    const path = normalizeDiscoveredPath(flaskMatch[1] ?? "");
    if (!path) continue;

    const methods = parsePythonRouteMethods(flaskMatch[2] ?? "");
    for (const method of methods) {
      upsertUsage(usages, path, method, undefined, "server");
    }
  }

  // Django URLConf style. Method-specific dispatch usually lives in the view,
  // so record GET as the conservative route presence signal.
  const djangoPathRegex =
    /\b(?:path|re_path)\s*\(\s*['"]([^'"]+)['"]\s*,/gi;

  let djangoMatch: RegExpExecArray | null;
  while ((djangoMatch = djangoPathRegex.exec(content)) !== null) {
    const path = normalizeDiscoveredPath(djangoPathToApiPath(djangoMatch[1] ?? ""));
    if (!path) continue;
    upsertUsage(usages, path, "GET", undefined, "server");
  }
}

function collectPythonRouterPrefixes(content: string): Map<string, string> {
  const prefixes = new Map<string, string>();
  const routerPrefixRegex =
    /\b([a-zA-Z_]\w*)\s*=\s*APIRouter\s*\(([\s\S]*?)\)/gi;

  let match: RegExpExecArray | null;
  while ((match = routerPrefixRegex.exec(content)) !== null) {
    const name = match[1];
    const args = match[2] ?? "";
    if (!name) continue;

    const prefix = /prefix\s*=\s*['"]([^'"]+)['"]/i.exec(args)?.[1];
    if (prefix) {
      prefixes.set(name, prefix);
    }
  }

  return prefixes;
}

function parsePythonRouteMethods(rawArgs: string): HttpMethod[] {
  const methodsMatch = /methods\s*=\s*\[([^\]]+)\]/i.exec(rawArgs);
  if (!methodsMatch?.[1]) return ["GET"];

  const methods = [...methodsMatch[1].matchAll(/['"](GET|POST|PUT|PATCH|DELETE)['"]/gi)]
    .map((match) => match[1]?.toUpperCase() as HttpMethod)
    .filter(Boolean);

  return methods.length > 0 ? methods : ["GET"];
}

function djangoPathToApiPath(path: string): string {
  return path
    .replace(/<[^:>]+:([^>]+)>/g, "{$1}")
    .replace(/<([^>]+)>/g, "{$1}");
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
function getFullPrefixForFile(
  normFile: string,
  fileMountMap: Map<string, { prefix: string; mountingFile: string }>,
  visited = new Set<string>(),
): string {
  if (visited.has(normFile)) return ""; // avoid infinite loop
  visited.add(normFile);

  const mountInfo = fileMountMap.get(normFile);
  if (!mountInfo) return "";

  const parentPrefix = getFullPrefixForFile(
    normalizeFilePath(mountInfo.mountingFile),
    fileMountMap,
    visited,
  );
  return joinMountAndRoutePath(parentPrefix, mountInfo.prefix);
}

function applyMountPrefixes(
  files: RepositoryFile[],
  usages: SnapshotEndpointUsage[],
  routeOriginFile: Map<string, string>,
): void {
  // Collect mount entries: { prefix, importedFilePath, mountingFilePath }
  const mounts = collectMountEntries(files);
  if (mounts.length === 0) return;

  // Build a lookup: normalized file path → mount prefix info.
  // If the same file is mounted at multiple prefixes (unusual), the first wins.
  const fileMountMap = new Map<
    string,
    { prefix: string; mountingFile: string }
  >();
  for (const mount of mounts) {
    const normFile = normalizeFilePath(mount.resolvedFilePath);
    if (!fileMountMap.has(normFile)) {
      fileMountMap.set(normFile, {
        prefix: mount.prefix,
        mountingFile: mount.mountingFilePath,
      });
    }
  }

  // Replace each server-side endpoint that has a mount prefix:
  // keep the original router-only path AND add the prefixed path.
  const newUsages: SnapshotEndpointUsage[] = [];
  const existingKeys = new Set(
    usages
      .filter((u) => u.source === "server")
      .map((u) => `${u.method}:${u.path}`),
  );

  for (let i = 0; i < usages.length; i++) {
    const usage = usages[i]!;
    if (usage.source !== "server") continue;

    const originKey = `${usage.method}:${usage.path}`;
    const originFile = routeOriginFile.get(originKey);
    if (!originFile) continue;

    const normOrigin = normalizeFilePath(originFile);
    const prefix = getFullPrefixForFile(normOrigin, fileMountMap);
    if (!prefix || prefix === "/") continue;

    // Skip if the path already starts with the prefix (avoid double-prefixing).
    if (usage.path.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    const fullPath = joinMountAndRoutePath(prefix, usage.path);

    const prefixedKey = `${usage.method}:${fullPath}`;
    if (existingKeys.has(prefixedKey)) continue;
    existingKeys.add(prefixedKey);
    newUsages.push({ ...usage, path: fullPath });
  }

  usages.push(...newUsages);
}

/**
 * Parse all files for `.use('/prefix', routerVariable)` and resolve
 * each routerVariable to the file it was imported/required from.
 */
interface MountEntry {
  prefix: string;
  variableName: string;
  resolvedFilePath: string;
  mountingFilePath: string;
}

function collectMountEntries(files: RepositoryFile[]): MountEntry[] {
  const entries: MountEntry[] = [];

  for (const file of files) {
    // Match: object.use('/prefix', variableName)
    // Handles app.use, router.use, api.use, etc.
    const mountRegex =
      /\b[a-zA-Z_$][\w$]*\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([a-zA-Z_$][\w$]*)\s*\)/g;

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
        mountingFilePath: file.path,
      });
    }

    // Match: object.use('/prefix', require('./routes/path'))
    // Doesn't strictly require closing parenthesis for .use to support require(...).router
    const inlineRequireRegex =
      /\b[a-zA-Z_$][\w$]*\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    let mInline: RegExpExecArray | null;
    while ((mInline = inlineRequireRegex.exec(file.content)) !== null) {
      const prefix = mInline[1];
      const importPath = mInline[2];
      if (!prefix || !importPath) continue;

      const resolved = resolveRelativePath(file.path, importPath);
      if (!resolved) continue;

      entries.push({
        prefix: prefix.startsWith("/") ? prefix : `/${prefix}`,
        variableName: "",
        resolvedFilePath: resolved,
        mountingFilePath: file.path,
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

  // Strip any file extension
  p = p.replace(/\.(js|ts|mjs|cjs)$/, "");

  // Strip trailing /index
  p = p.replace(/\/index$/, "");

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
  const window = content.slice(
    matchIndex,
    Math.min(content.length, matchIndex + 1200),
  );

  // Try to get the req param name from: (..., (req, res) => { ... })
  const handlerSig =
    /,\s*(?:async\s*)?\(\s*([a-zA-Z_$][\w$]*)\s*(?:,|\))/m.exec(window);
  const reqName = handlerSig?.[1] ?? "req";

  const keys = new Set<string>();

  // req.body.foo
  const dotAccess = new RegExp(
    `\\b${escapeRegex(reqName)}\\s*\\.\\s*body\\s*\\.\\s*([a-zA-Z_$][\\w$]*)`,
    "g",
  );
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
    .replace(/<[^:>]+:([^>]+)>/g, "{$1}")
    .replace(/<([^>]+)>/g, "{$1}")
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

/**
 * Best-effort: after an outbound HTTP call, find `.json()` and infer an object
 * shape from `const { a, b } = await …json()` or `.then(({ a, b }) => …)`.
 */
function inferClientResponseUsageSchema(
  fileContent: string,
  callStartIndex: number,
  callMatchLength: number,
): ExtractedSchema | undefined {
  const span = fileContent.slice(
    callStartIndex,
    callStartIndex + Math.max(callMatchLength, 0) + 1600,
  );
  const jsonRe = /\.json\s*\(\s*\)/g;
  let jsonEnd = -1;
  let jm: RegExpExecArray | null;
  while ((jm = jsonRe.exec(span)) !== null) {
    jsonEnd = jm.index + jm[0].length;
  }
  if (jsonEnd < 0) {
    return undefined;
  }

  const afterJson = span.slice(jsonEnd, jsonEnd + 900);

  const constDestr =
    /(?:const|let)\s*\{\s*([^}]{1,1200})\}\s*=\s*await\s+[\s\S]{0,400}?\.json\s*\(\s*\)/.exec(
      afterJson,
    );
  const thenDestr =
    /\.then\s*\(\s*(?:async\s*)?\(?\s*\{\s*([^}]{1,1200})\}\s*\)/.exec(
      afterJson,
    );

  const rawList = constDestr?.[1] ?? thenDestr?.[1];
  if (!rawList) {
    return undefined;
  }

  const properties: Record<string, ExtractedSchema> = {};
  for (const part of rawList.split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    const keyPart = seg.split(/\s*:\s*/)[0]?.trim() ?? "";
    const name = keyPart.replace(/\s+as\s+[\w$]+$/i, "").trim();
    if (/^[a-zA-Z_$][\w$]*$/.test(name)) {
      properties[name] = { type: "unknown", confidence: "high" };
    }
  }

  if (Object.keys(properties).length === 0) {
    return undefined;
  }

  return { type: "object", properties, confidence: "high" };
}

function upsertUsage(
  usages: SnapshotEndpointUsage[],
  path: string,
  method: HttpMethod,
  requestBodySchema?: ExtractedSchema,
  source?: "client" | "server",
  clientInferredResponseSchema?: ExtractedSchema,
): void {
  const existing = usages.find((u) => u.path === path && u.method === method);

  if (existing) {
    existing.callCount += 1;
    if (!existing.requestBodySchema && requestBodySchema) {
      existing.requestBodySchema = withConfidence(requestBodySchema, "low");
    }
    if (source === "client" && clientInferredResponseSchema) {
      if (!existing.responseBodySchema) {
        existing.responseBodySchema = withConfidence(
          clientInferredResponseSchema,
          "high",
        );
      }
    }
    // "server" is more authoritative than "client" — a route declaration
    // should override an earlier regex match from the call-pattern scanner.
    if (source === "server" || !existing.source) {
      existing.source = source;
    }
    return;
  }

  const isClient = source === "client";
  usages.push({
    path,
    method,
    callCount: 1,
    requestBodySchema: withConfidence(requestBodySchema, "low"),
    responseBodySchema: withConfidence(
      isClient ? clientInferredResponseSchema : undefined,
      "low",
    ),
    source,
  });
}

/**
 * Returns true if the file is clearly a backend source file (routes, controllers,
 * services, middleware, etc.) and should NOT be scanned for client-side HTTP calls.
 *
 * The client-side regex (fetch/axios) matches `router.get('/path')` inside these
 * files, creating phantom "frontend" call entries.
 */
function isBackendSourceFile(filePath: string, content?: string): boolean {
  const p = filePath.replace(/\\/g, "/").toLowerCase();

  // Frontend path signals take highest priority — a .service.ts inside frontend/
  // or client/ is a frontend API service, not a backend service.
  if (isLikelyFrontendSourceFile(p)) return false;

  // Content-based frontend detection: files that import UI frameworks or use
  // frontend-only env vars are client code even if named *.service.ts etc.
  if (content) {
    if (/@angular\/common\/http/.test(content)) return false;
    if (/from\s+['"]react['"]/.test(content)) return false;
    if (/from\s+['"]vue['"]/.test(content)) return false;
    if (/from\s+['"]svelte/.test(content)) return false;
    if (/from\s+['"]swr['"]/.test(content)) return false;
    if (/from\s+['"]@tanstack\//.test(content)) return false;
    if (/from\s+['"]react-query['"]/.test(content)) return false;
    if (/import\.meta\.env/.test(content)) return false;
    if (/process\.env\.(?:REACT_APP|VITE_|NEXT_PUBLIC_)/.test(content)) return false;
  }

  // Suffixes — check after frontend signals so that Angular/React service files
  // inside known frontend roots are already excluded above.
  const backendSuffixes = [
    ".route.ts",
    ".route.js",
    ".routes.ts",
    ".routes.js",
    ".controller.ts",
    ".controller.js",
    ".service.ts",
    ".service.js",
    ".handler.ts",
    ".handler.js",
    ".middleware.ts",
    ".middleware.js",
    ".resolver.ts",
    ".resolver.js",
  ];
  if (backendSuffixes.some((suffix) => p.endsWith(suffix))) return true;

  // Common backend folder names — only reached when no backend suffix matched.
  const backendFolders = [
    "/routes/",
    "/route/",
    "/controllers/",
    "/controller/",
    "/handlers/",
    "/handler/",
    "/middleware/",
    "/resolvers/",
    "/resolver/",
    "/server/",
    "/backend/",
  ];
  if (backendFolders.some((folder) => p.includes(folder))) return true;

  // Common backend entrypoint filenames
  const backendFiles = [
    "app.ts",
    "app.js",
    "server.ts",
    "server.js",
    "index.ts",
    "index.js",
    "main.ts",
    "main.js",
  ];
  const basename = p.split("/").pop() ?? "";
  if (backendFiles.includes(basename)) return true;

  return false;
}

function isLikelyFrontendSourceFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, "/").toLowerCase();

  if (
    p.endsWith(".tsx") ||
    p.endsWith(".jsx") ||
    p.endsWith(".vue") ||
    p.endsWith(".svelte") ||
    p.endsWith(".astro")
  ) {
    return true;
  }

  const frontendRoots = [
    "frontend/",
    "client/",
    "web/",
    "ui/",
    "apps/web/",
    "packages/web/",
    // Angular CLI default app root
    "src/app/",
  ];
  if (frontendRoots.some((root) => p.startsWith(root) || p.includes(`/${root}`))) {
    return true;
  }

  const frontendSignals = [
    "/components/",
    "/pages/",
    "/views/",
    "/hooks/",
    "/features/",
    "/ui/",
    "/styles/",
    "/assets/",
  ];
  if (frontendSignals.some((signal) => p.includes(signal))) return true;

  return false;
}

function resolveUrlValue(
  rawUrl: string | null,
  baseUrl: string | null,
): string | null {
  if (!rawUrl) return null;

  try {
    return baseUrl
      ? new URL(rawUrl, baseUrl).toString()
      : new URL(rawUrl).toString();
  } catch {
    return rawUrl;
  }
}

function extractPathFromUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed);
    return parsed.pathname || "/";
  } catch {
    const match = /^https?:\/\/[^/]+(\/[^?#]*)/i.exec(trimmed);
    return match?.[1] ?? null;
  }
}

function normalizeClientPath(value: string): string | null {
  const path = extractPathFromUrl(value) ?? value;
  return normalizeDiscoveredPath(path);
}

function looksLikeStaticAsset(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  const staticExts = [
    ".js",
    ".mjs",
    ".cjs",
    ".css",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".map",
  ];

  return staticExts.some((ext) => lower.endsWith(ext));
}

function isKnownExternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const knownExternalHosts = [
    "googleapis.com",
    "accounts.google.com",
    "github.com",
    "facebook.com",
    "twitter.com",
    "linkedin.com",
    "amazonaws.com",
    "cloudfront.net",
    "stripe.com",
    "twilio.com",
    "sendgrid.com",
    "auth0.com",
    "openai.com",
    "sentry.io",
  ];

  return knownExternalHosts.some(
    (known) => host === known || host.endsWith(`.${known}`),
  );
}

function looksLikeApiPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return false;

  const value = trimmed.toLowerCase();
  if (!value) return false;

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      if (isKnownExternalHost(parsed.hostname)) return false;
      if (looksLikeStaticAsset(parsed.pathname)) return false;

      return parsed.pathname.startsWith("/") && parsed.pathname !== "/";
    } catch {
      const fallbackPath = extractPathFromUrl(trimmed);
      return Boolean(fallbackPath) && !looksLikeStaticAsset(fallbackPath!);
    }
  }

  if (value.startsWith("/") || value.startsWith("api/")) return true;

  if (value.includes("/") && !looksLikeStaticAsset(value)) {
    return true;
  }

  return false;
}

function inferFetchMethod(args: string): HttpMethod {
  const methodMatch =
    /method\s*:\s*['"`](get|post|put|patch|delete)['"`]/i.exec(args);
  if (methodMatch && methodMatch[1]) {
    return methodMatch[1].toUpperCase() as HttpMethod;
  }

  // fetch(url, { body: ... }) without explicit method is typically POST
  if (/\bbody\s*:/i.test(args)) {
    return "POST";
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

function resolveApiPathReference(
  expression: string,
  file: RepositoryFile,
  filesByPath: Map<string, RepositoryFile>,
  visited = new Set<string>(),
): string | null {
  const cleaned = expression.trim();
  if (!cleaned) return null;

  const visitKey = `${normalizeRepositoryFilePath(file.path)}::${cleaned}`;
  if (visited.has(visitKey)) return null;
  visited.add(visitKey);

  const direct = evaluatePathExpression(
    cleaned,
    file,
    filesByPath,
    {},
    visited,
  );
  if (!direct) return null;

  const pathFromUrl = extractPathFromUrl(direct);
  if (pathFromUrl) {
    return normalizeDiscoveredPath(pathFromUrl);
  }

  return looksLikeApiPath(direct) ? normalizeDiscoveredPath(direct) : direct;
}

function evaluatePathExpression(
  expression: string,
  file: RepositoryFile,
  filesByPath: Map<string, RepositoryFile>,
  bindings: Record<string, string>,
  visited: Set<string>,
): string | null {
  const cleaned = expression
    .trim()
    .replace(/\s+as\s+[\w$.<>\[\]|]+$/g, "")
    .replace(/[!?]+$/g, "");
  if (!cleaned) return null;

  if (isQuotedString(cleaned)) {
    return cleaned.slice(1, -1);
  }

  if (cleaned.startsWith("`") && cleaned.endsWith("`")) {
    return renderTemplateLiteral(cleaned, file, filesByPath, bindings, visited);
  }

  const newUrlCall = /^new\s+URL\s*\(([\s\S]*)\)$/.exec(cleaned);
  if (newUrlCall) {
    const args = splitTopLevelArgs(newUrlCall[1] ?? "");
    const rawUrl = args[0]
      ? evaluatePathExpression(args[0], file, filesByPath, bindings, visited)
      : null;
    const baseUrl = args[1]
      ? evaluatePathExpression(args[1], file, filesByPath, bindings, visited)
      : null;
    const resolved = resolveUrlValue(rawUrl, baseUrl);
    if (resolved) return resolved;
  }

  const topLevelConcat = splitByTopLevelPlus(cleaned);
  if (topLevelConcat.length > 1) {
    const parts = topLevelConcat
      .map((part) =>
        evaluatePathExpression(part, file, filesByPath, bindings, visited),
      )
      .filter((part): part is string => Boolean(part));
    return parts.length === topLevelConcat.length ? parts.join("") : null;
  }

  if (bindings[cleaned]) {
    return bindings[cleaned] ?? null;
  }

  const memberCall =
    /^([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\(([\s\S]*)\)$/.exec(cleaned);
  if (memberCall) {
    const namespace = memberCall[1]!;
    const fnName = memberCall[2]!;
    const args = splitTopLevelArgs(memberCall[3] ?? "");
    return resolveImportedMemberCall(
      namespace,
      fnName,
      args,
      file,
      filesByPath,
      visited,
    );
  }

  const plainCall = /^([a-zA-Z_$][\w$]*)\(([\s\S]*)\)$/.exec(cleaned);
  if (plainCall) {
    const fnName = plainCall[1]!;
    const args = splitTopLevelArgs(plainCall[2] ?? "");
    const localCall = resolveLocalFunctionCall(
      file,
      fnName,
      args,
      filesByPath,
      bindings,
      visited,
    );
    if (localCall) return localCall;

    const importedCall = resolveImportedIdentifier(
      file,
      fnName,
      filesByPath,
      (importedFile, importedName) =>
        resolveLocalFunctionCall(
          importedFile,
          importedName,
          args,
          filesByPath,
          bindings,
          visited,
        ),
    );
    if (importedCall) return importedCall;
  }

  const memberAccess = /^([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)$/.exec(cleaned);
  if (memberAccess) {
    const objectName = memberAccess[1]!;
    const propertyName = memberAccess[2]!;
    const localProperty = resolveLocalObjectProperty(
      file,
      objectName,
      propertyName,
      filesByPath,
      bindings,
      visited,
    );
    if (localProperty) return localProperty;

    const importedProperty = resolveImportedMember(
      file,
      objectName,
      propertyName,
      filesByPath,
      bindings,
      visited,
    );
    if (importedProperty) return importedProperty;
  }

  const localValue = resolveLocalValue(
    file,
    cleaned,
    filesByPath,
    bindings,
    visited,
  );
  if (localValue) return localValue;

  return resolveImportedIdentifier(
    file,
    cleaned,
    filesByPath,
    (importedFile, importedName) =>
      resolveLocalValue(
        importedFile,
        importedName,
        filesByPath,
        bindings,
        visited,
      ),
  );
}

function resolveLocalValue(
  file: RepositoryFile,
  symbolName: string,
  filesByPath: Map<string, RepositoryFile>,
  bindings: Record<string, string>,
  visited: Set<string>,
): string | null {
  const directConst =
    findConstExpression(file.content, symbolName) ??
    findExportedConstExpression(file.content, symbolName);
  if (directConst) {
    return evaluatePathExpression(
      directConst,
      file,
      filesByPath,
      bindings,
      visited,
    );
  }

  const objectValue = findObjectPropertyExpression(
    file.content,
    symbolName,
    undefined,
  );
  if (objectValue) {
    return evaluatePathExpression(
      objectValue,
      file,
      filesByPath,
      bindings,
      visited,
    );
  }

  return null;
}

function resolveLocalFunctionCall(
  file: RepositoryFile,
  functionName: string,
  args: string[],
  filesByPath: Map<string, RepositoryFile>,
  parentBindings: Record<string, string>,
  visited: Set<string>,
): string | null {
  const fnDef = findFunctionDefinition(file.content, functionName);
  if (!fnDef) return null;

  const bindings: Record<string, string> = { ...parentBindings };
  fnDef.params.forEach((param, index) => {
    const argExpression = args[index]?.trim();
    if (!param) return;
    bindings[param] =
      (argExpression &&
        evaluatePathExpression(
          argExpression,
          file,
          filesByPath,
          parentBindings,
          visited,
        )) ||
      `{${param}}`;
  });

  return evaluatePathExpression(
    fnDef.body,
    file,
    filesByPath,
    bindings,
    visited,
  );
}

function resolveLocalObjectProperty(
  file: RepositoryFile,
  objectName: string,
  propertyName: string,
  filesByPath: Map<string, RepositoryFile>,
  bindings: Record<string, string>,
  visited: Set<string>,
): string | null {
  const propertyExpression = findObjectPropertyExpression(
    file.content,
    objectName,
    propertyName,
  );
  if (!propertyExpression) return null;
  return evaluatePathExpression(
    propertyExpression,
    file,
    filesByPath,
    bindings,
    visited,
  );
}

function resolveImportedIdentifier(
  file: RepositoryFile,
  localName: string,
  filesByPath: Map<string, RepositoryFile>,
  resolver: (
    importedFile: RepositoryFile,
    importedName: string,
  ) => string | null,
): string | null {
  const importMatch = findImportedIdentifier(file.content, localName);
  if (!importMatch) return null;
  const importedFile = resolveImportedFile(
    file.path,
    importMatch.importPath,
    filesByPath,
  );
  if (!importedFile) return null;
  return resolver(importedFile, importMatch.importedName);
}

function resolveImportedMember(
  file: RepositoryFile,
  namespaceName: string,
  propertyName: string,
  filesByPath: Map<string, RepositoryFile>,
  bindings: Record<string, string>,
  visited: Set<string>,
): string | null {
  const namedImportHit = resolveImportedIdentifier(
    file,
    namespaceName,
    filesByPath,
    (importedFile, importedName) =>
      resolveLocalObjectProperty(
        importedFile,
        importedName,
        propertyName,
        filesByPath,
        bindings,
        visited,
      ),
  );
  if (namedImportHit) return namedImportHit;

  const namespaceImport = findNamespaceImport(file.content, namespaceName);
  if (!namespaceImport) return null;
  const importedFile = resolveImportedFile(
    file.path,
    namespaceImport,
    filesByPath,
  );
  if (!importedFile) return null;
  return resolveLocalValue(
    importedFile,
    propertyName,
    filesByPath,
    bindings,
    visited,
  );
}

function resolveImportedMemberCall(
  namespaceName: string,
  functionName: string,
  args: string[],
  file: RepositoryFile,
  filesByPath: Map<string, RepositoryFile>,
  visited: Set<string>,
): string | null {
  const namedImportHit = resolveImportedIdentifier(
    file,
    namespaceName,
    filesByPath,
    (importedFile, importedName) => {
      const fnBody = findObjectPropertyExpression(
        importedFile.content,
        importedName,
        functionName,
      );
      if (!fnBody) return null;
      return evaluatePathExpression(
        fnBody,
        importedFile,
        filesByPath,
        {},
        visited,
      );
    },
  );
  if (namedImportHit) return namedImportHit;

  const namespaceImport = findNamespaceImport(file.content, namespaceName);
  if (!namespaceImport) return null;
  const importedFile = resolveImportedFile(
    file.path,
    namespaceImport,
    filesByPath,
  );
  if (!importedFile) return null;
  return resolveLocalFunctionCall(
    importedFile,
    functionName,
    args,
    filesByPath,
    {},
    visited,
  );
}

function findImportedIdentifier(
  content: string,
  localName: string,
): { importPath: string; importedName: string } | null {
  const escaped = escapeRegex(localName);
  const namedImportRegex = new RegExp(
    `import\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*['"\`]([^'"\`]+)['"\`]`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = namedImportRegex.exec(content)) !== null) {
    const specifiers = match[1] ?? "";
    const importPath = match[2] ?? "";
    for (const specifier of specifiers.split(",")) {
      const trimmed = specifier.trim();
      if (!trimmed) continue;
      const aliasMatch =
        /^([a-zA-Z_$][\w$]*)(?:\s+as\s+([a-zA-Z_$][\w$]*))?$/.exec(trimmed);
      if (!aliasMatch) continue;
      const importedName = aliasMatch[1]!;
      const alias = aliasMatch[2] ?? importedName;
      if (new RegExp(`^${escaped}$`).test(alias)) {
        return { importPath, importedName };
      }
    }
  }
  return null;
}

function findNamespaceImport(
  content: string,
  namespaceName: string,
): string | null {
  const escaped = escapeRegex(namespaceName);
  const namespaceRegex = new RegExp(
    `import\\s*\\*\\s*as\\s+${escaped}\\s+from\\s+['"\`]([^'"\`]+)['"\`]`,
    "m",
  );
  return namespaceRegex.exec(content)?.[1] ?? null;
}

function resolveImportedFile(
  importingFilePath: string,
  importPath: string,
  filesByPath: Map<string, RepositoryFile>,
): RepositoryFile | null {
  const resolved = resolveRelativePath(importingFilePath, importPath);
  if (!resolved) return null;

  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    `${resolved}/index.ts`,
    `${resolved}/index.tsx`,
    `${resolved}/index.js`,
    `${resolved}/index.jsx`,
  ];

  for (const candidate of candidates) {
    const hit = filesByPath.get(normalizeRepositoryFilePath(candidate));
    if (hit) return hit;
  }

  return null;
}

function findConstExpression(
  content: string,
  symbolName: string,
): string | null {
  const escaped = escapeRegex(symbolName);
  return (
    new RegExp(`(?:export\\s+)?const\\s+${escaped}\\s*=\\s*([\\s\\S]*?);`, "m")
      .exec(content)?.[1]
      ?.trim() ?? null
  );
}

function findExportedConstExpression(
  content: string,
  symbolName: string,
): string | null {
  const escaped = escapeRegex(symbolName);
  return new RegExp(`export\\s+\\{[^}]*\\b${escaped}\\b[^}]*\\}`, "m").test(
    content,
  )
    ? findConstExpression(content, symbolName)
    : null;
}

function findFunctionDefinition(
  content: string,
  functionName: string,
): { params: string[]; body: string } | null {
  const escaped = escapeRegex(functionName);
  const arrowMatch =
    new RegExp(
      `(?:export\\s+)?const\\s+${escaped}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*([\\s\\S]*?);`,
      "m",
    ).exec(content) ??
    new RegExp(
      `(?:export\\s+)?const\\s+${escaped}\\s*=\\s*([a-zA-Z_$][\\w$]*)\\s*=>\\s*([\\s\\S]*?);`,
      "m",
    ).exec(content);
  if (arrowMatch) {
    const rawParams = arrowMatch[1] ?? "";
    const body = normalizeFunctionBody(arrowMatch[2] ?? "");
    return { params: parseFunctionParams(rawParams), body };
  }

  const functionMatch = new RegExp(
    `(?:export\\s+)?function\\s+${escaped}\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\}`,
    "m",
  ).exec(content);
  if (functionMatch) {
    const body = /return\s+([\s\S]*?);/
      .exec(functionMatch[2] ?? "")?.[1]
      ?.trim();
    if (!body) return null;
    return {
      params: parseFunctionParams(functionMatch[1] ?? ""),
      body,
    };
  }

  return null;
}

function normalizeFunctionBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    const returned = /return\s+([\s\S]*?);/.exec(trimmed)?.[1]?.trim();
    return returned ?? trimmed;
  }
  return trimmed;
}

function parseFunctionParams(rawParams: string): string[] {
  return rawParams
    .split(",")
    .map((part) => part.trim().split(":")[0]?.trim() ?? "")
    .filter(Boolean);
}

function findObjectPropertyExpression(
  content: string,
  objectName: string,
  propertyName?: string,
): string | null {
  const escapedObject = escapeRegex(objectName);
  const objectBody = new RegExp(
    `(?:export\\s+)?const\\s+${escapedObject}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*;`,
    "m",
  ).exec(content)?.[1];
  if (!objectBody) return null;
  if (!propertyName) return objectBody.trim();

  const escapedProperty = escapeRegex(propertyName);
  const propertyMatch =
    new RegExp(`${escapedProperty}\\s*:\\s*([\\s\\S]*?)(?:,|$)`, "m").exec(
      objectBody,
    ) ??
    new RegExp(
      `${escapedProperty}\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\}`,
      "m",
    ).exec(objectBody);

  if (!propertyMatch) return null;
  if (
    propertyMatch.length >= 3 &&
    propertyMatch[2] &&
    propertyMatch[0].includes("{")
  ) {
    const body = /return\s+([\s\S]*?);/.exec(propertyMatch[2])?.[1]?.trim();
    return body ?? null;
  }

  return propertyMatch[1]?.trim() ?? null;
}

function renderTemplateLiteral(
  expression: string,
  file: RepositoryFile,
  filesByPath: Map<string, RepositoryFile>,
  bindings: Record<string, string>,
  visited: Set<string>,
): string {
  const inner = expression.slice(1, -1);
  return inner.replace(/\$\{([^}]+)\}/g, (_, rawExpr: string) => {
    const resolved = evaluatePathExpression(
      rawExpr.trim(),
      file,
      filesByPath,
      bindings,
      visited,
    );
    return resolved ?? "{param}";
  });
}

function splitByTopLevelPlus(expression: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depthParen = 0;
  let depthCurly = 0;
  let depthSquare = 0;
  let inQuote: '"' | "'" | "`" | null = null;

  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i] ?? "";
    const prev = i > 0 ? expression[i - 1] : "";

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

    if (ch === "(") depthParen += 1;
    if (ch === ")") depthParen = Math.max(0, depthParen - 1);
    if (ch === "{") depthCurly += 1;
    if (ch === "}") depthCurly = Math.max(0, depthCurly - 1);
    if (ch === "[") depthSquare += 1;
    if (ch === "]") depthSquare = Math.max(0, depthSquare - 1);

    if (
      ch === "+" &&
      depthParen === 0 &&
      depthCurly === 0 &&
      depthSquare === 0
    ) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitTopLevelArgs(args: string): string[] {
  return splitTopLevel(args);
}

function isQuotedString(value: string): boolean {
  return (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  );
}

function normalizeRepositoryFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").toLowerCase();
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
      items.length > 0
        ? inferLiteralSchema(items[0] ?? "")
        : { type: "unknown" },
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
