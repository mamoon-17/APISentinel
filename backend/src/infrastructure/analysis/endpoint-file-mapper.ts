import type { RepositoryFile } from "../../application/analysis/contracts/repository-code.provider";

export interface EndpointFileMatch {
  /** Spec endpoint path e.g. /users/{id} */
  specPath: string;
  method: string;
  /** Files most likely to contain the route handler and its dependencies */
  routeFiles: RepositoryFile[];
  /** Model / entity / schema files that are referenced from route files */
  modelFiles: RepositoryFile[];
  /** Type definition files */
  typeFiles: RepositoryFile[];
}

/**
 * Maps a spec endpoint to the subset of repository files most likely to
 * contain its handler and related model/type definitions.
 *
 * Strategy:
 * 1. Convert spec path params ({id}) to both Express (:id) and regex patterns
 * 2. Scan all route/service files for that path string
 * 3. Return matching files + all model/type files from the repo (small in count)
 */
export function mapEndpointsToFiles(
  specPath: string,
  method: string,
  files: RepositoryFile[],
): EndpointFileMatch {
  const patterns = buildSearchPatterns(specPath, method);

  const routeFiles: RepositoryFile[] = [];
  const modelFiles: RepositoryFile[] = [];
  const typeFiles: RepositoryFile[] = [];

  for (const file of files) {
    if (file.role === "model") {
      modelFiles.push(file);
      continue;
    }
    if (file.role === "type") {
      typeFiles.push(file);
      continue;
    }
    if (file.role === "route" || file.role === "service" || file.role === "other") {
      if (fileContainsEndpoint(file.content, patterns)) {
        routeFiles.push(file);
      }
    }
  }

  // If no route file matched via path string, fall back to files that contain
  // both the method keyword and a path segment from the spec path
  if (routeFiles.length === 0) {
    const pathSegments = specPath
      .split("/")
      .filter((s) => s && !s.startsWith("{"))
      .map((s) => s.toLowerCase());

    for (const file of files) {
      if (file.role === "route" || file.role === "service") {
        const lower = file.content.toLowerCase();
        const hasMethod = lower.includes(method.toLowerCase());
        const hasSegment = pathSegments.some((seg) => lower.includes(`'/${seg}`) || lower.includes(`"/${seg}`) || lower.includes(`\`/${seg}`));
        if (hasMethod && hasSegment) {
          routeFiles.push(file);
        }
      }
    }
  }

  return { specPath, method, routeFiles, modelFiles, typeFiles };
}

/**
 * Build search patterns from a spec path.
 * /users/{id}  →  ['/users/:id', '/users/{id}', "'users'", router.get('/users/']
 */
function buildSearchPatterns(specPath: string, method: string): string[] {
  // Convert {param} → :param (Express style)
  const expressPath = specPath.replace(/\{([^}]+)\}/g, ':$1');
  // Convert {param} → * (wildcard)
  const wildcardPath = specPath.replace(/\{[^}]+\}/g, '*');

  const patterns: string[] = [
    specPath,
    expressPath,
    wildcardPath,
  ];

  // Add method-specific patterns
  const methodLower = method.toLowerCase();
  patterns.push(`router.${methodLower}('${expressPath}'`);
  patterns.push(`router.${methodLower}("${expressPath}"`);
  patterns.push(`app.${methodLower}('${expressPath}'`);
  patterns.push(`app.${methodLower}("${expressPath}"`);

  return patterns;
}

function fileContainsEndpoint(content: string, patterns: string[]): boolean {
  return patterns.some((pattern) => content.includes(pattern));
}
