import {
  DashboardDataProvider,
  DashboardStatsDto,
  RequestLogEntryDto,
} from "./contracts/dashboard-data.provider";

/**
 * Application service — Dashboard use-cases.
 *
 * This service lives in the application layer and depends only on the
 * DashboardDataProvider port. It has zero knowledge of Express, databases,
 * or any infrastructure detail.
 */
export class DashboardService {
  constructor(private readonly dataProvider: DashboardDataProvider) {}

  /**
   * Returns aggregate stats for the current user's dashboard.
   */
  getStats(userId: string): DashboardStatsDto {
    return this.dataProvider.getStatsForUser(userId);
  }

  /**
   * Returns recent health-check results as request-log entries,
   * ordered most-recent first.
   */
  getRequestLogs(userId: string, limit = 20): RequestLogEntryDto[] {
    return this.dataProvider.getRequestLogsForUser(userId, limit);
  }
}
