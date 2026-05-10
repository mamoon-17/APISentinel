import {
  DashboardDataProvider,
  DashboardStatsDto,
  RequestLogEntryDto,
} from "./contracts/dashboard-data.provider";

export class DashboardService {
  constructor(private readonly dataProvider: DashboardDataProvider) {}

  getStats(userId: string): Promise<DashboardStatsDto> {
    return this.dataProvider.getStatsForUser(userId);
  }

  getRequestLogs(userId: string, limit = 20): Promise<RequestLogEntryDto[]> {
    return this.dataProvider.getRequestLogsForUser(userId, limit);
  }
}
