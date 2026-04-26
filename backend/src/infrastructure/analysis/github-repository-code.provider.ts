import { ResultAsync } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import {
  RepositoryCodeProvider,
  RepositoryFile,
  RepositoryFileRole,
} from "../../application/analysis/contracts/repository-code.provider";

export class GithubRepositoryCodeProvider implements RepositoryCodeProvider {
  fetchFiles(
    repositoryId: string,
    githubAccessToken?: string,
  ): ResultAsync<RepositoryFile[], AppError> {
    console.log(
      `[GithubRepositoryCodeProvider] Fetching from GitHub API for repo ID: ${repositoryId}`,
    );

    return ResultAsync.fromPromise(
      this.doFetch(repositoryId, githubAccessToken),
      (e) =>
        e instanceof AppError
          ? e
          : new AppError("GITHUB_FETCH_FAILED", String(e)),
    );
  }

  fetchFileTree(
    repositoryId: string,
    githubAccessToken?: string,
  ): ResultAsync<string[], AppError> {
    return ResultAsync.fromPromise(
      this.doFetchTree(repositoryId, githubAccessToken),
      (e) =>
        e instanceof AppError
          ? e
          : new AppError("GITHUB_FETCH_FAILED", String(e)),
    );
  }

  private async doFetchTree(
    repositoryId: string,
    githubAccessToken?: string,
  ): Promise<string[]> {
    const headers = buildGithubHeaders(githubAccessToken);

    const repoRes = await fetch(
      `https://api.github.com/repositories/${repositoryId}`,
      { headers },
    );
    if (!repoRes.ok) {
      throw mapGithubResponseError(repoRes, "repo metadata");
    }
    const repoData = (await repoRes.json()) as any;
    const fullName = repoData.full_name;
    const defaultBranch = repoData.default_branch;

    const treeRes = await fetch(
      `https://api.github.com/repos/${fullName}/git/trees/${defaultBranch}?recursive=1`,
      { headers },
    );
    if (!treeRes.ok) {
      throw mapGithubResponseError(treeRes, "repo tree");
    }
    const treeData = (await treeRes.json()) as any;

    const excluded = ["node_modules/", "dist/", "build/", "coverage/", ".git/", "__pycache__/", ".next/", "vendor/"];

    return (treeData.tree as any[])
      .filter((item) => item.type === "blob")
      .map((item) => String(item.path || ""))
      .filter((p) => !excluded.some((ex) => p.includes(ex) || p.startsWith(ex)));
  }

  private async doFetch(
    repositoryId: string,
    githubAccessToken?: string,
  ): Promise<RepositoryFile[]> {
    const headers = buildGithubHeaders(githubAccessToken);

    // 1. Get repository metadata to find the full name and default branch
    const repoRes = await fetch(
      `https://api.github.com/repositories/${repositoryId}`,
      { headers },
    );
    if (!repoRes.ok) {
      throw mapGithubResponseError(repoRes, "repo metadata");
    }
    const repoData = (await repoRes.json()) as any;
    const fullName = repoData.full_name;
    const defaultBranch = repoData.default_branch;

    console.log(
      `[GithubRepositoryCodeProvider] Identified as ${fullName} on branch ${defaultBranch}`,
    );

    // 2. Get the full file tree recursively
    const treeRes = await fetch(
      `https://api.github.com/repos/${fullName}/git/trees/${defaultBranch}?recursive=1`,
      { headers },
    );
    if (!treeRes.ok) {
      throw mapGithubResponseError(treeRes, "repo tree");
    }
    const treeData = (await treeRes.json()) as any;

    // 3. Filter for source files (js, ts, jsx, tsx, prisma) and skip generated/vendor folders
    const sourceFiles = treeData.tree.filter((item: any) => {
      if (item.type !== "blob") {
        return false;
      }

      const path = String(item.path || "");
      if (
        path.includes("/node_modules/") ||
        path.includes("/dist/") ||
        path.includes("/build/") ||
        path.includes("/coverage/") ||
        path.startsWith("node_modules/") ||
        path.startsWith("dist/") ||
        path.startsWith("build/") ||
        path.startsWith("coverage/")
      ) {
        return false;
      }

      return (
        path.endsWith(".ts") ||
        path.endsWith(".tsx") ||
        path.endsWith(".js") ||
        path.endsWith(".jsx") ||
        path.endsWith(".prisma")
      );
    });

    console.log(
      `[GithubRepositoryCodeProvider] Found ${sourceFiles.length} source files. Fetching contents...`,
    );

    // 4. Fetch raw source contents.
    // Prioritize likely networking files so endpoint extraction is less likely to miss usage.
    const files: RepositoryFile[] = [];
    const prioritized = [...sourceFiles].sort((a: any, b: any) => {
      const pa = scorePath(String(a.path || ""));
      const pb = scorePath(String(b.path || ""));
      return pb - pa;
    });
    const limit = Math.min(prioritized.length, 200);

    for (let i = 0; i < limit; i++) {
      const fileNode = prioritized[i];
      const rawRes = await fetch(
        `https://raw.githubusercontent.com/${fullName}/${defaultBranch}/${fileNode.path}`,
        { headers },
      );
      if (rawRes.ok) {
        files.push({
          path: fileNode.path,
          content: await rawRes.text(),
          role: classifyFileRole(String(fileNode.path || "")),
        });
      }
    }

    console.log(
      `[GithubRepositoryCodeProvider] Successfully fetched ${files.length} file contents.`,
    );
    return files;
  }
}

function buildGithubHeaders(
  githubAccessToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "APISentinel",
  };

  if (githubAccessToken && githubAccessToken.trim().length > 0) {
    headers.Authorization = `Bearer ${githubAccessToken}`;
  }

  return headers;
}

function mapGithubResponseError(response: Response, context: string): AppError {
  if (response.status === 401 || response.status === 403) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      return new AppError(
        "GITHUB_RATE_LIMITED",
        `GitHub rate limit exceeded while fetching ${context}.`,
      );
    }

    return new AppError(
      "GITHUB_AUTH_REQUIRED",
      `GitHub authorization failed while fetching ${context}. Reconnect GitHub and try again.`,
    );
  }

  return new AppError(
    "GITHUB_FETCH_FAILED",
    `Failed to fetch ${context}: ${response.status} ${response.statusText}`,
  );
}

function scorePath(path: string): number {
  const normalized = path.toLowerCase();
  let score = 0;

  // Route / API files — top priority for endpoint detection
  if (normalized.includes("route")) score += 12;
  if (normalized.includes("controller")) score += 11;
  if (normalized.includes("api")) score += 10;
  if (normalized.includes("handler")) score += 10;

  // Model / entity / schema files — critical for LLM context
  if (normalized.includes("model")) score += 11;
  if (normalized.includes("entity")) score += 11;
  if (normalized.includes("schema")) score += 10;
  if (normalized.includes("prisma")) score += 10;

  // Type definitions
  if (normalized.includes("types")) score += 9;
  if (normalized.includes("interface")) score += 9;
  if (normalized.includes("dto")) score += 9;

  // Services
  if (normalized.includes("service")) score += 8;
  if (normalized.includes("http")) score += 7;
  if (normalized.includes("request")) score += 7;
  if (normalized.includes("fetch")) score += 6;
  if (normalized.includes("axios")) score += 6;
  if (normalized.includes("hook")) score += 3;
  if (normalized.includes("component")) score += 1;

  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx")) score += 2;
  if (normalized.endsWith(".prisma")) score += 5;

  return score;
}

/**
 * Classify a file by its likely role in the codebase.
 * This helps the LLM receive targeted context rather than random files.
 */
function classifyFileRole(path: string): RepositoryFileRole {
  const p = path.toLowerCase();

  if (
    p.includes("route") ||
    p.includes("controller") ||
    p.includes("handler") ||
    p.includes(".router.")
  ) return "route";

  if (
    p.includes("model") ||
    p.includes("entity") ||
    p.endsWith(".prisma") ||
    p.includes("schema") && (p.includes("db") || p.includes("mongoose") || p.includes("typeorm"))
  ) return "model";

  if (
    p.includes("types") ||
    p.includes("interface") ||
    p.includes("dto") ||
    p.endsWith(".d.ts")
  ) return "type";

  if (p.includes("service")) return "service";

  if (
    p.includes("schema") ||
    p.includes("validation") ||
    p.includes("zod") ||
    p.includes("joi")
  ) return "schema";

  return "other";
}
