import { useCallback, useEffect, useState } from "react";
import { getApiBaseUrl } from "./use-session";

/* ── Types matching backend DTOs ─────────────────────────────────── */

export interface DashboardStats {
  healthChecksRun: number;
  repositoriesAnalyzed: number;
  inconsistenciesFound: number;
  complianceRate: number;
}

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  specName: string;
  status: "valid" | "warning" | "error";
  jobStatus: "queued" | "running" | "succeeded" | "failed";
  inconsistencyCount: number;
  endpointsCovered: number;
  endpointsTotal: number;
  trigger: "manual" | "auto-on-link" | "retry";
  durationMs: number | null;
}

/* ── Hook: Dashboard Stats ───────────────────────────────────────── */

export function useDashboardStats(): {
  stats: DashboardStats | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiBaseUrl = getApiBaseUrl();

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/dashboard/stats`, {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          setStats(null);
          return;
        }
        setError("Failed to load dashboard stats");
        return;
      }

      const data = (await response.json()) as DashboardStats;
      setStats(data);
    } catch {
      setError("Unable to connect to the server");
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { stats, isLoading, error, refetch };
}

/* ── Hook: Request Logs ──────────────────────────────────────────── */

export function useRequestLogs(limit = 20): {
  logs: RequestLogEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiBaseUrl = getApiBaseUrl();

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/dashboard/request-logs?limit=${limit}`,
        { credentials: "include" },
      );

      if (!response.ok) {
        if (response.status === 401) {
          setLogs([]);
          return;
        }
        setError("Failed to load request logs");
        return;
      }

      const data = (await response.json()) as RequestLogEntry[];
      setLogs(data);
    } catch {
      setError("Unable to connect to the server");
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, limit]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { logs, isLoading, error, refetch };
}
