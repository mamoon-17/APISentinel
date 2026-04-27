import { useCallback, useEffect, useState } from "react";
import { getApiBaseUrl } from "@/hooks/use-session";
import { REQUEST_LOGS_API_PATH } from "@/lib/api-paths";
import type { RequestLog, RequestLogPayload } from "@/types/api";

interface RequestLogsResponseBody {
  logs?: RequestLogPayload[];
  total?: number;
  page?: number;
  pageSize?: number;
  code?: string;
  message?: string;
}

export interface RequestLogsQuery {
  page?: number;
  pageSize?: number;
  specId?: string;
  repositoryId?: string;
  status?: string;
  method?: string;
  from?: string;
  to?: string;
  search?: string;
}

export function useRequestLogs(query?: RequestLogsQuery): {
  logs: RequestLog[];
  total: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const url = new URL(`${getApiBaseUrl()}${REQUEST_LOGS_API_PATH}`);
      if (query?.page) url.searchParams.set("page", String(query.page));
      if (query?.pageSize) url.searchParams.set("pageSize", String(query.pageSize));
      if (query?.specId) url.searchParams.set("specId", query.specId);
      if (query?.repositoryId) url.searchParams.set("repositoryId", query.repositoryId);
      if (query?.status) url.searchParams.set("status", query.status);
      if (query?.method) url.searchParams.set("method", query.method);
      if (query?.from) url.searchParams.set("from", query.from);
      if (query?.to) url.searchParams.set("to", query.to);
      if (query?.search) url.searchParams.set("search", query.search);

      const response = await fetch(url.toString(), { credentials: "include" });
      const payload = (await response
        .json()
        .catch(() => null)) as RequestLogsResponseBody | null;

      if (!response.ok) {
        setLogs([]);
        setTotal(0);
        setError(payload?.message ?? "Failed to load request logs");
        return;
      }

      const parsedLogs = (payload?.logs ?? []).map(toRequestLog);
      setLogs(parsedLogs);
      setTotal(payload?.total ?? parsedLogs.length);
    } catch {
      setLogs([]);
      setTotal(0);
      setError("Failed to load request logs");
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { logs, total, isLoading, error, refresh };
}

function toRequestLog(payload: RequestLogPayload): RequestLog {
  return {
    id: payload.id,
    timestamp: new Date(payload.timestamp),
    method: payload.method,
    endpoint: payload.endpoint,
    status: payload.status,
    responseCode: payload.responseCode,
    latency: payload.latency,
    violations: payload.violations ?? [],
    specId: payload.specId ?? undefined,
    repositoryId: payload.repositoryId,
  };
}
