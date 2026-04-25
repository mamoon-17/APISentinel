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

      const fetched = payload?.repos ?? [];
      const manual = readManualRepos();
      const merged = mergeRepos(fetched, manual);
      setRepos(merged);
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
