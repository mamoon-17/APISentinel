import { okAsync, ResultAsync } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import { CodeScannerProvider } from "../../application/analysis/contracts/code-scanner.provider";
import { RepositoryFile } from "../../application/analysis/contracts/repository-code.provider";
import {
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

        const existing = usages.find(
          (u) => u.path === pathMatch && u.method === method,
        );

        if (existing) {
          existing.callCount += 1;
        } else {
          usages.push({
            path: pathMatch || "/",
            method,
            callCount: 1,
            // requestBodySchema and responseBodySchema would require AST parsing
            // or deeper regex analysis, which can be expanded later!
          });
        }
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

function upsertUsage(
  usages: SnapshotEndpointUsage[],
  path: string,
  method: HttpMethod,
): void {
  const existing = usages.find((u) => u.path === path && u.method === method);

  if (existing) {
    existing.callCount += 1;
    return;
  }

  usages.push({
    path,
    method,
    callCount: 1,
  });
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
