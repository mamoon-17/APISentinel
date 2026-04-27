import { useCallback, useEffect, useState } from "react";
import { getApiBaseUrl } from "@/hooks/use-session";
import type { DashboardStats } from "@/types/api";
import { DASHBOARD_STATS_API_PATH } from "@/lib/api-paths";

interface DashboardStatsResponseBody {
    totalRequests?: number;
    validRequests?: number;
    violations?: number;
    uptime?: number;
    code?: string;
    message?: string;
}

export function useDashboardStats(): {
    stats: DashboardStats | null;
    isLoading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
} {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(
                `${getApiBaseUrl()}${DASHBOARD_STATS_API_PATH}`,
                { credentials: "include" },
            );

            const payload = (await response
                .json()
                .catch(() => null)) as DashboardStatsResponseBody | null;

            if (!response.ok) {
                setStats(null);
                setError(payload?.message ?? "Failed to load dashboard stats");
                return;
            }

            setStats({
                totalRequests: payload?.totalRequests ?? 0,
                validRequests: payload?.validRequests ?? 0,
                violations: payload?.violations ?? 0,
                uptime: payload?.uptime ?? 0,
            });
        } catch {
            setStats(null);
            setError("Failed to load dashboard stats");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return { stats, isLoading, error, refresh };
}
