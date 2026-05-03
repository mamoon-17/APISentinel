import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useDashboardStats, useRequestLogs } from "@/hooks/use-dashboard";

// ---------- Mock setup --------------------------------------------------------

const mockApiBaseUrl = "http://localhost:3000";

vi.mock("@/hooks/use-session", () => ({
  getApiBaseUrl: () => mockApiBaseUrl,
}));

// ---------- Helpers -----------------------------------------------------------

function mockFetchSuccess(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body ?? {}),
  });
}

function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new Error("Network error"));
}

// ---------- useDashboardStats tests -------------------------------------------

describe("useDashboardStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches stats from /dashboard/stats on mount", async () => {
    const statsData = {
      healthChecksRun: 12,
      repositoriesAnalyzed: 5,
      inconsistenciesFound: 3,
      complianceRate: 94,
    };

    global.fetch = mockFetchSuccess(statsData);

    const { result } = renderHook(() => useDashboardStats());

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats).toEqual(statsData);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      `${mockApiBaseUrl}/dashboard/stats`,
      { credentials: "include" },
    );
  });

  it("handles 401 by setting stats to null without error", async () => {
    global.fetch = mockFetchError(401);

    const { result } = renderHook(() => useDashboardStats());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("handles non-401 error responses", async () => {
    global.fetch = mockFetchError(500);

    const { result } = renderHook(() => useDashboardStats());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats).toBeNull();
    expect(result.current.error).toBe("Failed to load dashboard stats");
  });

  it("handles network errors", async () => {
    global.fetch = mockFetchNetworkError();

    const { result } = renderHook(() => useDashboardStats());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats).toBeNull();
    expect(result.current.error).toBe("Unable to connect to the server");
  });

  it("can refetch stats", async () => {
    const initialStats = {
      healthChecksRun: 5,
      repositoriesAnalyzed: 2,
      inconsistenciesFound: 1,
      complianceRate: 90,
    };
    const updatedStats = {
      healthChecksRun: 10,
      repositoriesAnalyzed: 4,
      inconsistenciesFound: 2,
      complianceRate: 85,
    };

    global.fetch = mockFetchSuccess(initialStats);
    const { result } = renderHook(() => useDashboardStats());

    await waitFor(() => {
      expect(result.current.stats).toEqual(initialStats);
    });

    global.fetch = mockFetchSuccess(updatedStats);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.stats).toEqual(updatedStats);
  });
});

// ---------- useRequestLogs tests ----------------------------------------------

describe("useRequestLogs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches logs from /dashboard/request-logs with limit", async () => {
    const logsData = [
      {
        id: "1",
        timestamp: "2026-05-03T08:00:00Z",
        repositoryName: "repo",
        repositoryFullName: "user/repo",
        specName: "Spec",
        status: "valid",
        jobStatus: "succeeded",
        inconsistencyCount: 0,
        endpointsCovered: 5,
        endpointsTotal: 5,
        trigger: "manual",
        durationMs: 500,
      },
    ];

    global.fetch = mockFetchSuccess(logsData);

    const { result } = renderHook(() => useRequestLogs(10));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.logs).toEqual(logsData);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      `${mockApiBaseUrl}/dashboard/request-logs?limit=10`,
      { credentials: "include" },
    );
  });

  it("uses default limit of 20", async () => {
    global.fetch = mockFetchSuccess([]);

    renderHook(() => useRequestLogs());

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `${mockApiBaseUrl}/dashboard/request-logs?limit=20`,
        { credentials: "include" },
      );
    });
  });

  it("handles 401 by setting logs to empty without error", async () => {
    global.fetch = mockFetchError(401);

    const { result } = renderHook(() => useRequestLogs());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.logs).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("handles server errors", async () => {
    global.fetch = mockFetchError(500);

    const { result } = renderHook(() => useRequestLogs());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.logs).toEqual([]);
    expect(result.current.error).toBe("Failed to load request logs");
  });

  it("handles network errors", async () => {
    global.fetch = mockFetchNetworkError();

    const { result } = renderHook(() => useRequestLogs());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.logs).toEqual([]);
    expect(result.current.error).toBe("Unable to connect to the server");
  });

  it("can refetch logs", async () => {
    const initialLogs = [
      {
        id: "old-1",
        timestamp: "2026-05-03T08:00:00Z",
        repositoryName: "repo",
        repositoryFullName: "user/repo",
        specName: "Spec",
        status: "valid",
        jobStatus: "succeeded",
        inconsistencyCount: 0,
        endpointsCovered: 5,
        endpointsTotal: 5,
        trigger: "manual",
        durationMs: 500,
      },
    ];
    const updatedLogs = [
      {
        id: "new-1",
        timestamp: "2026-05-03T09:00:00Z",
        repositoryName: "repo-2",
        repositoryFullName: "user/repo-2",
        specName: "Spec 2",
        status: "error",
        jobStatus: "failed",
        inconsistencyCount: 2,
        endpointsCovered: 3,
        endpointsTotal: 8,
        trigger: "manual",
        durationMs: 1000,
      },
    ];

    global.fetch = mockFetchSuccess(initialLogs);
    const { result } = renderHook(() => useRequestLogs());

    await waitFor(() => {
      expect(result.current.logs).toEqual(initialLogs);
    });

    global.fetch = mockFetchSuccess(updatedLogs);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.logs).toEqual(updatedLogs);
  });
});
