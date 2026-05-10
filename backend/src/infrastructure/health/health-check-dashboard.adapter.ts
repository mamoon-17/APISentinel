import {
  DashboardDataProvider,
  DashboardStatsDto,
  RequestLogEntryDto,
} from "../../application/dashboard/contracts/dashboard-data.provider";
import type { AnalysisResultRepository, SavedAnalysisResult } from "../../application/analysis/contracts/analysis-result.repository";
import { HealthCheckJobQueue, HealthCheckJob } from "./health-check-job-queue";

export class HealthCheckDashboardAdapter implements DashboardDataProvider {
  constructor(
    private readonly jobQueue: HealthCheckJobQueue,
    private readonly analysisResultRepository?: AnalysisResultRepository,
  ) {}

  async getStatsForUser(userId: string): Promise<DashboardStatsDto> {
    const logs = await this.getRequestLogsForUser(userId, 500);
    const completed = logs.filter((l) => l.jobStatus === "succeeded");

    const uniqueRepos = new Set(completed.map((l) => l.repositoryId));
    let totalInconsistencies = 0;
    let totalEndpoints = 0;
    let inSpecEndpoints = 0;

    for (const log of completed) {
      totalInconsistencies += log.inconsistencyCount;
      totalEndpoints += log.endpointsTotal;
      inSpecEndpoints += log.endpointsCovered;
    }

    return {
      healthChecksRun: completed.length,
      repositoriesAnalyzed: uniqueRepos.size,
      inconsistenciesFound: totalInconsistencies,
      complianceRate:
        totalEndpoints > 0
          ? Math.round((inSpecEndpoints / totalEndpoints) * 10000) / 100
          : 100,
    };
  }

  async getRequestLogsForUser(
    userId: string,
    limit = 20,
  ): Promise<RequestLogEntryDto[]> {
    const inMemory = this.jobQueue
      .getAllJobsForUser(userId)
      .map((job) => this.jobToLogEntry(job));

    if (!this.analysisResultRepository) {
      return inMemory.slice(0, limit);
    }

    const dbResult = await this.analysisResultRepository.findRecentForUser(
      userId,
      limit * 3,
    );
    if (dbResult.isErr()) {
      return inMemory.slice(0, limit);
    }

    const dbEntries = dbResult.value.map((r) => this.dbResultToLogEntry(r));

    // Merge: in-memory wins for dedup (it has live status), DB fills history gaps.
    const merged = [...inMemory];
    for (const dbEntry of dbEntries) {
      const isDuplicate = inMemory.some((e) => {
        if (e.repositoryId !== dbEntry.repositoryId) return false;
        const diff = Math.abs(
          new Date(e.timestamp).getTime() - new Date(dbEntry.timestamp).getTime(),
        );
        return diff < 60_000;
      });
      if (!isDuplicate) {
        merged.push(dbEntry);
      }
    }

    merged.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return merged.slice(0, limit);
  }

  private jobToLogEntry(job: HealthCheckJob): RequestLogEntryDto {
    const inconsistencyCount = job.result?.inconsistencies.length ?? 0;
    const endpointsTotal = job.result?.endpointUsage.length ?? 0;
    const endpointsCovered = job.result
      ? job.result.endpointUsage.filter((e) => e.inSpec).length
      : 0;

    let status: "valid" | "warning" | "error";
    if (job.status === "failed") {
      status = "error";
    } else if (job.status !== "succeeded") {
      status = "warning";
    } else if (inconsistencyCount === 0) {
      status = "valid";
    } else {
      const hasErrors = job.result?.inconsistencies.some(
        (i) => i.severity === "error",
      );
      status = hasErrors ? "error" : "warning";
    }

    let durationMs: number | null = null;
    if (job.startedAt && job.finishedAt) {
      durationMs =
        new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
    }

    return {
      id: job.id,
      timestamp: job.updatedAt,
      repositoryId: job.repositoryId,
      repositoryName: job.repositoryName,
      repositoryFullName: job.repositoryFullName,
      specName: job.specName,
      status,
      jobStatus: job.status,
      inconsistencyCount,
      endpointsCovered,
      endpointsTotal,
      trigger: job.trigger,
      durationMs,
    };
  }

  private dbResultToLogEntry(result: SavedAnalysisResult): RequestLogEntryDto {
    const payload = result.payload;
    const inconsistencyCount = payload.inconsistencies.length;
    const endpointsTotal = payload.endpointUsage.length;
    const endpointsCovered = payload.endpointUsage.filter((e) => e.inSpec).length;

    const hasErrors = payload.inconsistencies.some((i) => i.severity === "error");
    const status: "valid" | "warning" | "error" =
      inconsistencyCount === 0 ? "valid" : hasErrors ? "error" : "warning";

    const fullName = result.repositoryFullName ?? result.repositoryId;
    const repoName = fullName.includes("/")
      ? (fullName.split("/").pop() ?? fullName)
      : fullName;

    const specName =
      result.analysisMode === "frontend-backend"
        ? "Frontend ↔ Backend"
        : result.specId
          ? "Linked Spec"
          : "Backend ↔ Spec";

    return {
      id: result.id,
      timestamp: result.analyzedAt.toISOString(),
      repositoryId: result.repositoryId,
      repositoryName: repoName,
      repositoryFullName: fullName,
      specName,
      status,
      jobStatus: "succeeded",
      inconsistencyCount,
      endpointsCovered,
      endpointsTotal,
      trigger: "manual",
      durationMs: null,
    };
  }
}
