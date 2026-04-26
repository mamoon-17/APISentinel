import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl, useSession } from "@/hooks/use-session";
import { REPOSITORIES_API_PATH } from "@/lib/api-paths";
import type { GithubRepo } from "@/types/api";

interface ReposResponseBody {
  repos?: GithubRepo[];
  code?: string;
  message?: string;
}

interface GithubPublicRepoApiResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  stargazers_count: number;
  updated_at: string;
}

interface LinkPublicRepoResult {
  ok: boolean;
  message?: string;
}

const MANUAL_PUBLIC_REPOS_KEY = "api_sentinel_manual_public_repos";
const SERVER_ERROR_COOLDOWN_MS = 5000;
let nextServerFetchRetryAt = 0;
let lastServerFetchErrorMessage: string | null = null;

function readManualPublicRepos(): GithubRepo[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(MANUAL_PUBLIC_REPOS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is GithubRepo => {
        if (!item || typeof item !== "object") {
          return false;
        }

        const repo = item as Partial<GithubRepo>;
        return (
          typeof repo.id === "string" &&
          typeof repo.name === "string" &&
          typeof repo.fullName === "string" &&
          typeof repo.url === "string" &&
          typeof repo.isPrivate === "boolean" &&
          typeof repo.isFork === "boolean" &&
          typeof repo.stars === "number" &&
          typeof repo.updatedAt === "string"
        );
      })
      .map((repo) => ({
        ...repo,
        description: repo.description ?? null,
      }));
  } catch {
    return [];
  }
}

function writeManualPublicRepos(repos: GithubRepo[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(MANUAL_PUBLIC_REPOS_KEY, JSON.stringify(repos));
  } catch {
    // ignore write failures
  }
}

function mapGithubApiRepo(repo: GithubPublicRepoApiResponse): GithubRepo {
  return {
    id: String(repo.id),
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description,
    isPrivate: repo.private,
    isFork: repo.fork,
    stars: repo.stargazers_count,
    updatedAt: repo.updated_at,
  };
}

function parseGithubRepoFromUrl(
  input: string,
): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (url.hostname.toLowerCase() !== "github.com") {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    if (!owner || !repo) {
      return null;
    }

    return { owner, repo };
  } catch {
    return null;
  }
}

/**
 * Fetches the signed-in user’s GitHub repositories via the backend
 * (cookie session + stored GitHub token).
 */
export function useGithubRepoList() {
  const {
    session,
    isLoading: sessionLoading,
    refresh: refreshSession,
  } = useSession();
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [manualRepos, setManualRepos] = useState<GithubRepo[]>(() =>
    readManualPublicRepos(),
  );
  const [error, setError] = useState<string | null>(null);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [scopeInsufficient, setScopeInsufficient] = useState(false);
  const [fetching, setFetching] = useState(false);
  const inFlightLoadRef = useRef<Promise<void> | null>(null);

  const githubLinked = session?.githubLinked === true;

  const load = useCallback(
    async (options?: { force?: boolean }) => {
      if (inFlightLoadRef.current) {
        await inFlightLoadRef.current;
        return;
      }

      const executeLoad = async () => {
        if (!githubLinked) {
          setGithubRepos([]);
          setError(null);
          setTokenInvalid(false);
          setScopeInsufficient(false);
          setFetching(false);
          return;
        }

        if (!options?.force && Date.now() < nextServerFetchRetryAt) {
          setError(
            lastServerFetchErrorMessage ??
              "GitHub repositories are temporarily unavailable. Please retry in a moment.",
          );
          setFetching(false);
          return;
        }

        setFetching(true);
        setError(null);
        setTokenInvalid(false);
        setScopeInsufficient(false);

        try {
          const response = await fetch(
            `${getApiBaseUrl()}${REPOSITORIES_API_PATH}`,
            { credentials: "include" },
          );
          const payload = (await response
            .json()
            .catch(() => null)) as ReposResponseBody | null;

          if (
            response.status === 401 &&
            payload?.code === "GITHUB_TOKEN_INVALID"
          ) {
            setTokenInvalid(true);
            setGithubRepos([]);
            nextServerFetchRetryAt = 0;
            lastServerFetchErrorMessage = null;
            return;
          }

          if (
            response.status === 403 &&
            payload?.code === "GITHUB_SCOPE_INSUFFICIENT"
          ) {
            setScopeInsufficient(true);
            setGithubRepos([]);
            nextServerFetchRetryAt = 0;
            lastServerFetchErrorMessage = null;
            return;
          }

          if (!response.ok) {
            const message =
              payload?.message ?? "Failed to load GitHub repositories";
            setGithubRepos([]);
            setError(message);
            if (response.status >= 500) {
              nextServerFetchRetryAt = Date.now() + SERVER_ERROR_COOLDOWN_MS;
              lastServerFetchErrorMessage = message;
            }
            return;
          }

          setGithubRepos(payload?.repos ?? []);
          nextServerFetchRetryAt = 0;
          lastServerFetchErrorMessage = null;
        } catch {
          setGithubRepos([]);
          const message = "Failed to load GitHub repositories";
          setError(message);
          nextServerFetchRetryAt = Date.now() + SERVER_ERROR_COOLDOWN_MS;
          lastServerFetchErrorMessage = message;
        } finally {
          setFetching(false);
        }
      };

      const pending = executeLoad();
      inFlightLoadRef.current = pending;
      try {
        await pending;
      } finally {
        inFlightLoadRef.current = null;
      }
    },
    [githubLinked],
  );

  useEffect(() => {
    if (sessionLoading) {
      return;
    }
    void load();
  }, [sessionLoading, load]);

  const isLoading = sessionLoading || (githubLinked && fetching);

  const repos = [
    ...manualRepos,
    ...githubRepos.filter(
      (repo) => !manualRepos.some((manual) => manual.id === repo.id),
    ),
  ];

  const refetch = useCallback(async () => {
    await refreshSession();
    await load({ force: true });
  }, [load, refreshSession]);

  const linkPublicRepo = useCallback(
    async (repoUrl: string): Promise<LinkPublicRepoResult> => {
      const parsed = parseGithubRepoFromUrl(repoUrl);
      if (!parsed) {
        return {
          ok: false,
          message:
            "Enter a valid GitHub repository URL (for example: https://github.com/owner/repo)",
        };
      }

      try {
        const response = await fetch(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
          {
            headers: {
              Accept: "application/vnd.github+json",
            },
          },
        );

        if (response.status === 404) {
          return {
            ok: false,
            message:
              "Repository not found. Make sure the URL is public and correct.",
          };
        }

        if (!response.ok) {
          return {
            ok: false,
            message:
              "Unable to validate this repository right now. Please try again.",
          };
        }

        const payload = (await response.json()) as GithubPublicRepoApiResponse;
        const repo = mapGithubApiRepo(payload);

        if (repo.isPrivate) {
          return {
            ok: false,
            message: "Private repositories require connecting GitHub.",
          };
        }

        if (
          manualRepos.some((existing) => existing.id === repo.id) ||
          githubRepos.some((existing) => existing.id === repo.id)
        ) {
          return {
            ok: false,
            message: "This repository is already linked.",
          };
        }

        const nextManualRepos = [repo, ...manualRepos];
        setManualRepos(nextManualRepos);
        writeManualPublicRepos(nextManualRepos);
        return { ok: true };
      } catch {
        return {
          ok: false,
          message:
            "Unable to validate this repository right now. Please try again.",
        };
      }
    },
    [githubRepos, manualRepos],
  );

  return {
    repos,
    error,
    tokenInvalid,
    scopeInsufficient,
    githubLinked,
    isLoading,
    isSessionLoading: sessionLoading,
    refetch,
    linkPublicRepo,
  };
}

const MANUAL_REPOS_KEY = "apisentinel_manual_repos_v1";

function readManualRepos(): GithubRepo[] {
  try {
    const raw = localStorage.getItem(MANUAL_REPOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isGithubRepo);
  } catch {
    return [];
  }
}

function isGithubRepo(value: unknown): value is GithubRepo {
  if (!value || typeof value !== "object") return false;
  const v = value as any;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.fullName === "string" &&
    typeof v.url === "string" &&
    typeof v.isPrivate === "boolean" &&
    typeof v.isFork === "boolean" &&
    typeof v.stars === "number" &&
    typeof v.updatedAt === "string"
  );
}

function mergeRepos(a: GithubRepo[], b: GithubRepo[]): GithubRepo[] {
  const map = new Map<string, GithubRepo>();
  for (const r of a) map.set(r.id, r);
  for (const r of b) map.set(r.id, r);
  return Array.from(map.values());
}
