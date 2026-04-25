import { useCallback, useEffect, useState } from "react";
import { getApiBaseUrl, useSession } from "@/hooks/use-session";
import { REPOSITORIES_API_PATH } from "@/lib/api-paths";
import type { GithubRepo } from "@/types/api";

interface ReposResponseBody {
  repos?: GithubRepo[];
  code?: string;
  message?: string;
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
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [fetching, setFetching] = useState(false);

  const githubLinked = session?.githubLinked === true;

  const load = useCallback(async () => {
    if (!githubLinked) {
      setRepos([]);
      setError(null);
      setTokenInvalid(false);
      setFetching(false);
      return;
    }

    setFetching(true);
    setError(null);
    setTokenInvalid(false);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}${REPOSITORIES_API_PATH}`,
        { credentials: "include" },
      );
      const payload = (await response
        .json()
        .catch(() => null)) as ReposResponseBody | null;

      if (response.status === 401 && payload?.code === "GITHUB_TOKEN_INVALID") {
        setTokenInvalid(true);
        setRepos([]);
        return;
      }

      if (!response.ok) {
        setRepos([]);
        setError(
          payload?.message ?? "Failed to load GitHub repositories",
        );
        return;
      }

      setRepos(payload?.repos ?? []);
    } catch {
      setRepos([]);
      setError("Failed to load GitHub repositories");
    } finally {
      setFetching(false);
    }
  }, [githubLinked]);

  useEffect(() => {
    if (sessionLoading) {
      return;
    }
    void load();
  }, [sessionLoading, load]);

  const isLoading = sessionLoading || (githubLinked && fetching);

  const refetch = useCallback(async () => {
    await refreshSession();
    await load();
  }, [load, refreshSession]);

  return {
    repos,
    error,
    tokenInvalid,
    githubLinked,
    isLoading,
    isSessionLoading: sessionLoading,
    refetch,
  };
}
