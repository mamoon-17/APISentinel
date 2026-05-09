import {
  DashboardDataProvider,
  DashboardStatsDto,
  RequestLogEntryDto,
} from "../../application/dashboard/contracts/dashboard-data.provider";
import { HealthCheckJobQueue, HealthCheckJob } from "./health-check-job-queue";

/**
 * Infrastructure adapter — implements DashboardDataProvider port using
 * the in-memory HealthCheckJobQueue.
 *
 * This is the ONLY place that couples dashboard aggregation to the concrete
 * job queue implementation.
 */
export class HealthCheckDashboardAdapter implements DashboardDataProvider {
  constructor(private readonly jobQueue: HealthCheckJobQueue) {}

  getStatsForUser(userId: string): DashboardStatsDto {
    const jobs = this.jobQueue.getAllJobsForUser(userId);
    const completed = jobs.filter((j) => j.status === "succeeded" && j.result);

    const healthChecksRun = completed.length;

    const uniqueRepos = new Set(completed.map((j) => j.repositoryId));
    const repositoriesAnalyzed = uniqueRepos.size;

    let totalInconsistencies = 0;
    let totalEndpoints = 0;
    let inSpecEndpoints = 0;

    for (const job of completed) {
      if (job.result) {
        totalInconsistencies += job.result.inconsistencies.length;

        for (const usage of job.result.endpointUsage) {
          totalEndpoints += 1;
          if (usage.inSpec) {
            inSpecEndpoints += 1;
          }
        }
      }
    }

    const complianceRate =
      totalEndpoints > 0
        ? Math.round((inSpecEndpoints / totalEndpoints) * 10000) / 100
        : 100;

    return {
      healthChecksRun,
      repositoriesAnalyzed,
      inconsistenciesFound: totalInconsistencies,
      complianceRate,
    };
  }

  getRequestLogsForUser(
    userId: string,
    limit = 20,
  ): RequestLogEntryDto[] {
    const jobs = this.jobQueue.getAllJobsForUser(userId);

    return jobs.slice(0, limit).map((job) => this.toLogEntry(job));
  }

  private toLogEntry(job: HealthCheckJob): RequestLogEntryDto {
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
        new Date(job.finishedAt).getTime() -
        new Date(job.startedAt).getTime();
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
}
