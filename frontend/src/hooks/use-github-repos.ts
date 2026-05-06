import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl, useSession } from "@/hooks/use-session";
import {
  REPOSITORIES_API_PATH,
  REPOSITORY_BY_URL_API_PATH,
} from "@/lib/api-paths";
import type { GithubRepo } from "@/types/api";

interface ReposResponseBody {
  repos?: GithubRepo[];
  code?: string;
  message?: string;
}

interface LinkRepoByUrlResponseBody {
  repo?: GithubRepo;
  code?: string;
  message?: string;
}

interface LinkPublicRepoResult {
  ok: boolean;
  message?: string;
}

const SERVER_ERROR_COOLDOWN_MS = 5000;
let nextServerFetchRetryAt = 0;
let lastServerFetchErrorMessage: string | null = null;

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

export function useGithubRepoList() {
  const {
    session,
    isLoading: sessionLoading,
    refresh: refreshSession,
  } = useSession();
  const [repos, setRepos] = useState<GithubRepo[]>([]);
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
        if (!options?.force && Date.now() < nextServerFetchRetryAt) {
          setError(
            lastServerFetchErrorMessage ??
              "Repositories are temporarily unavailable. Please retry in a moment.",
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
            payload?.code === "GITHUB_TOKEN_INVALID" &&
            githubLinked
          ) {
            setTokenInvalid(true);
            setRepos([]);
            nextServerFetchRetryAt = 0;
            lastServerFetchErrorMessage = null;
            return;
          }

          if (
            response.status === 403 &&
            payload?.code === "GITHUB_SCOPE_INSUFFICIENT" &&
            githubLinked
          ) {
            setScopeInsufficient(true);
            setRepos([]);
            nextServerFetchRetryAt = 0;
            lastServerFetchErrorMessage = null;
            return;
          }

          if (!response.ok) {
            const message = payload?.message ?? "Failed to load repositories";
            setRepos([]);
            setError(message);
            if (response.status >= 500) {
              nextServerFetchRetryAt = Date.now() + SERVER_ERROR_COOLDOWN_MS;
              lastServerFetchErrorMessage = message;
            }
            return;
          }

          setRepos(payload?.repos ?? []);
          nextServerFetchRetryAt = 0;
          lastServerFetchErrorMessage = null;
        } catch {
          setRepos([]);
          const message = "Failed to load repositories";
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

  const isLoading = sessionLoading || fetching;

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
          `${getApiBaseUrl()}${REPOSITORY_BY_URL_API_PATH}`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: `https://github.com/${parsed.owner}/${parsed.repo}`,
            }),
          },
        );

        const payload = (await response
          .json()
          .catch(() => null)) as LinkRepoByUrlResponseBody | null;

        if (!response.ok) {
          if (payload?.code === "REPO_NOT_FOUND") {
            return {
              ok: false,
              message:
                "Repository not found. Make sure the URL is public and correct.",
            };
          }

          if (payload?.code === "PUBLIC_REPO_REQUIRED") {
            return {
              ok: false,
              message: "Only public repositories can be linked by URL.",
            };
          }

          return {
            ok: false,
            message: payload?.message ?? "Failed to link repository",
          };
        }

        const repo = payload?.repo;
        if (!repo) {
          return {
            ok: false,
            message: "Invalid response from server",
          };
        }

        setRepos((previous) => {
          const withoutRepo = previous.filter(
            (existing) =>
              existing.id !== repo.id &&
              existing.fullName.toLowerCase() !== repo.fullName.toLowerCase(),
          );
          return [repo, ...withoutRepo];
        });

        return { ok: true };
      } catch {
        return {
          ok: false,
          message: "Unable to validate this repository right now. Please try again.",
        };
      }
    },
    [],
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
