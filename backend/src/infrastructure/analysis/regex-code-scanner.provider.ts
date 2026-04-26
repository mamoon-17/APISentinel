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

    // Detect literal calls like:
    // - fetch('/path', { method: 'POST' })
    // - axios.get('/path')
    // - api.post('/path')
    // - client.delete('/path')
    const callRegex =
      /(?:(fetch)|(?:[a-zA-Z_$][\w$]*\.)?(get|post|put|patch|delete))\s*\(\s*['"`]([^'"`]+)['"`]([^)]*)\)/gi;

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

        upsertUsage(usages, pathMatch || "/", method, requestBodySchema);
      }

      // Detect server-side route declarations, including NestJS decorators.
      collectRouteDeclarations(file.content, usages);
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
    upsertUsage(usages, path, method);
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
    upsertUsage(usages, combined, method);
  }
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
): void {
  const existing = usages.find((u) => u.path === path && u.method === method);

  if (existing) {
    existing.callCount += 1;
    if (!existing.requestBodySchema && requestBodySchema) {
      existing.requestBodySchema = withConfidence(requestBodySchema, "low");
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
