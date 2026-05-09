/**
 * Port interface — Dashboard data provider.
 *
 * The application layer depends on this abstraction.
 * Infrastructure adapters implement it.
 */

export interface DashboardStatsDto {
  healthChecksRun: number;
  repositoriesAnalyzed: number;
  inconsistenciesFound: number;
  complianceRate: number;
}

export interface RequestLogEntryDto {
  id: string;
  timestamp: string;
  /** GitHub repository node id (same as `/repositories/:id` route param) */
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

export interface DashboardDataProvider {
  /**
   * Aggregate dashboard stats for a specific user.
   */
  getStatsForUser(userId: string): DashboardStatsDto;

  /**
   * Recent health-check results as request log entries for a specific user.
   */
  getRequestLogsForUser(
    userId: string,
    limit?: number,
  ): RequestLogEntryDto[];
}
