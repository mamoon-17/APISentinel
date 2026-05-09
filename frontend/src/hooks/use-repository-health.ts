import { useCallback, useState } from "react";
import { getApiBaseUrl } from "@/hooks/use-session";
import { REPOSITORIES_ANALYSIS_API_PATH } from "@/lib/api-paths";
import type {
  BackendRepositoryInconsistenciesView,
  RepositoryHealthData,
} from "@/types/api";

interface InconsistenciesResponseBody extends Partial<BackendRepositoryInconsistenciesView> {
  code?: string;
  message?: string;
}

/**
 * Maps the raw backend inconsistencies response into the RepositoryHealthData
 * shape consumed by the RepositoryDetail UI.
 *
 * Note: The backend now returns actual per-endpoint usage details based on the
 * repository snapshot.
 */
function toHealthData(
  raw: BackendRepositoryInconsistenciesView,
): RepositoryHealthData {
  return {
    repositoryId: raw.repositoryId,
    lastCheckedAt: new Date(raw.analyzedAt),
    totalApiCalls: raw.totalApiCalls,
    endpointUsage: raw.endpointUsage || [],
    inconsistencies: raw.inconsistencies,
  };
}

export interface UseRepositoryHealthReturn {
  healthData: RepositoryHealthData | null;
  isChecking: boolean;
  healthError: string | null;
  checkHealth: (repositoryId: string, specId?: string, repositoryFullName?: string) => Promise<void>;
  reset: () => void;
}

export function useRepositoryHealth(): UseRepositoryHealthReturn {
  const [healthData, setHealthData] = useState<RepositoryHealthData | null>(
    null,
  );
  const [isChecking, setIsChecking] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const checkHealth = useCallback(
    async (repositoryId: string, specId?: string, repositoryFullName?: string) => {
      setIsChecking(true);
      setHealthError(null);

      try {
        const url = new URL(
          `${getApiBaseUrl()}${REPOSITORIES_ANALYSIS_API_PATH}/${repositoryId}/inconsistencies`,
        );
        if (specId) {
          url.searchParams.set("specId", specId);
        }
        if (repositoryFullName) {
          url.searchParams.set("repositoryFullName", repositoryFullName);
        }

        const response = await fetch(url.toString(), {
          credentials: "include",
        });

        const payload = (await response
          .json()
          .catch(() => null)) as InconsistenciesResponseBody | null;

        if (!response.ok) {
          if (payload?.code === "SPEC_VERSION_NOT_FOUND") {
            setHealthError(
              "No active specification found. Upload/link a valid OpenAPI spec, then try again.",
            );
            return;
          }

          if (payload?.code === "SPEC_SELECTION_REQUIRED") {
            setHealthError(
              "Select a specification for this repository before running health check.",
            );
            return;
          }

          if (payload?.code === "SPEC_VERSION_NOT_ANALYZABLE") {
            setHealthError(
              "Selected specification has no analyzable endpoints. Choose a valid spec and try again.",
            );
            return;
          }

          if (payload?.code === "REPOSITORY_SNAPSHOT_EMPTY") {
            setHealthError(
              "No API endpoints were detected from this repository yet, so health analysis cannot run.",
            );
            return;
          }

          if (payload?.code === "GITHUB_RATE_LIMITED") {
            setHealthError(
              "GitHub rate limit exceeded while analyzing this repository. Wait a few minutes and retry.",
            );
            return;
          }

          if (payload?.code === "GITHUB_AUTH_REQUIRED") {
            setHealthError(
              "GitHub authorization failed. Reconnect your GitHub account and try again.",
            );
            return;
          }

          if (payload?.code === "GITHUB_NOT_LINKED") {
            setHealthError(
              "GitHub is not linked for your account. Link GitHub first, then retry.",
            );
            return;
          }

          setHealthError(
            payload?.message ?? "Failed to fetch repository health data",
          );
          return;
        }

        if (!payload?.repositoryId) {
          setHealthError("Unexpected response format from server");
          return;
        }

        setHealthData(
          toHealthData(payload as BackendRepositoryInconsistenciesView),
        );
      } catch {
        setHealthError("Network error — could not reach backend");
      } finally {
        setIsChecking(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setHealthData(null);
    setHealthError(null);
  }, []);

  return { healthData, isChecking, healthError, checkHealth, reset };
}
