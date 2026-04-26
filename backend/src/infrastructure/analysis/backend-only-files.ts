import type { RepositoryFile } from "../../application/analysis/contracts/repository-code.provider";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function isNoisePath(path: string): boolean {
  return (
    path.includes("/node_modules/") ||
    path.includes("/dist/") ||
    path.includes("/build/") ||
    path.includes("/coverage/") ||
    path.endsWith(".min.js") ||
    path.endsWith(".min.css")
  );
}

function hasFolder(files: RepositoryFile[], folder: string): boolean {
  const token = `/${folder.toLowerCase()}/`;
  return files.some((f) => normalizePath(f.path).includes(token) || normalizePath(f.path).startsWith(`${folder.toLowerCase()}/`));
}

/**
 * Restrict analysis input to backend-only source files.
 *
 * Heuristic:
 * - If a `backend/` folder exists, only include `backend/**`
 * - Else if `server/` or `api/` exists, only include those
 * - Else exclude typical frontend folders (`frontend/`, `client/`, `web/`, `ui/`, `apps/web/`)
 *
 * This is intentionally conservative: it biases toward backend code so that
 * "Spec Detail" metrics represent backend-only signals.
 */
export function filterBackendOnlyFiles(files: RepositoryFile[]): RepositoryFile[] {
  const cleaned = files.filter((f) => !isNoisePath(normalizePath(f.path)));

  if (hasFolder(cleaned, "backend")) {
    return cleaned.filter((f) => {
      const p = normalizePath(f.path);
      return p.startsWith("backend/") || p.includes("/backend/");
    });
  }

  const hasServer = hasFolder(cleaned, "server");
  const hasApi = hasFolder(cleaned, "api");
  if (hasServer || hasApi) {
    return cleaned.filter((f) => {
      const p = normalizePath(f.path);
      return (
        (hasServer && (p.startsWith("server/") || p.includes("/server/"))) ||
        (hasApi && (p.startsWith("api/") || p.includes("/api/")))
      );
    });
  }

  return cleaned.filter((f) => {
    const p = normalizePath(f.path);
    if (
      p.startsWith("frontend/") ||
      p.includes("/frontend/") ||
      p.startsWith("client/") ||
      p.includes("/client/") ||
      p.startsWith("web/") ||
      p.includes("/web/") ||
      p.startsWith("ui/") ||
      p.includes("/ui/") ||
      p.includes("/apps/web/") ||
      p.includes("/packages/ui/")
    ) {
      return false;
    }
    return true;
  });
}

