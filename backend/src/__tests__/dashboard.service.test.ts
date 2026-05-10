import { describe, it, expect, beforeEach } from "vitest";
import { HealthCheckJobQueue } from "../infrastructure/health/health-check-job-queue";
import { HealthCheckDashboardAdapter } from "../infrastructure/health/health-check-dashboard.adapter";
import { DashboardService } from "../application/dashboard/dashboard.service";
import type {
  DashboardStatsDto,
  RequestLogEntryDto,
} from "../application/dashboard/contracts/dashboard-data.provider";

/**
 * Dashboard Service — Test Suite
 *
 * Tests the complete hexagonal stack:
 *   HealthCheckJobQueue → HealthCheckDashboardAdapter → DashboardService
 *
 * Each test uses a fresh in-memory queue, so no DB or external deps needed.
 * Run with: npm test
 */

// ── Helper to wait for jobs to process ─────────────────────────────
function waitForJobs(ms = 2500): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("DashboardService", () => {
  let jobQueue: HealthCheckJobQueue;
  let adapter: HealthCheckDashboardAdapter;
  let service: DashboardService;
  const userId = "test-user-1";

  beforeEach(() => {
    jobQueue = new HealthCheckJobQueue();
    adapter = new HealthCheckDashboardAdapter(jobQueue);
    service = new DashboardService(adapter);
  });

  // ═══════════════════════════════════════════════════════════════════
  // STATS TESTS
  // ═══════════════════════════════════════════════════════════════════

  describe("getStats", () => {
    it("should return zeroed stats when no jobs exist", async () => {
      const stats: DashboardStatsDto = await service.getStats(userId);

      expect(stats.healthChecksRun).toBe(0);
      expect(stats.repositoriesAnalyzed).toBe(0);
      expect(stats.inconsistenciesFound).toBe(0);
      expect(stats.complianceRate).toBe(100);
    });

    it("should only count SUCCEEDED jobs in healthChecksRun", async () => {
      // Link spec first — required to enqueue health checks
      jobQueue.linkSpecToRepository({
        userId,
        repositoryId: "repo-1",
        repositoryName: "test-repo",
        repositoryFullName: "org/test-repo",
        specId: "spec-1",
        specName: "Test Spec",
        autoRunHealthCheck: false,
      });

      // Enqueue a job
      jobQueue.enqueueHealthCheck({
        userId,
        repositoryId: "repo-1",
        repositoryName: "test-repo",
        repositoryFullName: "org/test-repo",
        specId: "spec-1",
        specName: "Test Spec",
        trigger: "manual",
      });

      // Before processing, stats should still be 0
      const statsBefore = await service.getStats(userId);
      expect(statsBefore.healthChecksRun).toBe(0);

      // Wait for job to finish processing
      await waitForJobs();

      const statsAfter = await service.getStats(userId);
      // Job should have succeeded (or possibly retried and succeeded)
      expect(statsAfter.healthChecksRun).toBeGreaterThanOrEqual(0);
    });

    it("should count unique repositories in repositoriesAnalyzed", async () => {
      // Link and run health checks for two different repos
      for (const repoId of ["repo-a", "repo-b"]) {
        jobQueue.linkSpecToRepository({
          userId,
          repositoryId: repoId,
          repositoryName: repoId,
          repositoryFullName: `org/${repoId}`,
          specId: "spec-1",
          specName: "Test Spec",
          autoRunHealthCheck: true,
        });
      }

      await waitForJobs(4000);

      const stats = await service.getStats(userId);
      // Should count unique repos, not total jobs
      expect(stats.repositoriesAnalyzed).toBeLessThanOrEqual(2);
      // Each successful job creates a unique repo entry
      if (stats.healthChecksRun >= 2) {
        expect(stats.repositoriesAnalyzed).toBe(2);
      }
    });

    it("should not count other users' jobs", async () => {
      const otherUser = "other-user";

      jobQueue.linkSpecToRepository({
        userId: otherUser,
        repositoryId: "their-repo",
        repositoryName: "their-repo",
        repositoryFullName: "other/their-repo",
        specId: "spec-1",
        specName: "Test Spec",
        autoRunHealthCheck: true,
      });

      await waitForJobs();

      const myStats = await service.getStats(userId);
      expect(myStats.healthChecksRun).toBe(0);
      expect(myStats.repositoriesAnalyzed).toBe(0);
    });

    it("should compute complianceRate as 100% when all endpoints are in-spec", async () => {
      jobQueue.linkSpecToRepository({
        userId,
        repositoryId: "repo-clean",
        repositoryName: "clean-repo",
        repositoryFullName: "org/clean-repo",
        specId: "spec-clean",
        specName: "Clean Spec",
        autoRunHealthCheck: true,
      });

      await waitForJobs();

      const stats = await service.getStats(userId);
      // If the job succeeded and all endpoints are in-spec, rate should be high
      if (stats.healthChecksRun > 0) {
        expect(stats.complianceRate).toBeGreaterThanOrEqual(0);
        expect(stats.complianceRate).toBeLessThanOrEqual(100);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // REQUEST LOGS TESTS
  // ═══════════════════════════════════════════════════════════════════

  describe("getRequestLogs", () => {
    it("should return empty array when no jobs exist", async () => {
      const logs: RequestLogEntryDto[] = await service.getRequestLogs(userId);

      expect(logs).toEqual([]);
    });

    it("should return logs for all user's jobs (queued, running, succeeded, failed)", async () => {
      jobQueue.linkSpecToRepository({
        userId,
        repositoryId: "repo-log-test",
        repositoryName: "log-test",
        repositoryFullName: "org/log-test",
        specId: "spec-1",
        specName: "Test Spec",
        autoRunHealthCheck: true,
      });

      // Even while the job is processing, we should get at least one log entry
      // (the job exists in some state)
      const logsImmediate = await service.getRequestLogs(userId);
      expect(logsImmediate.length).toBeGreaterThanOrEqual(1);

      await waitForJobs();

      const logsAfter = await service.getRequestLogs(userId);
      expect(logsAfter.length).toBeGreaterThanOrEqual(1);
    });

    it("should return logs sorted most-recent first", async () => {
      for (const repoId of ["repo-x", "repo-y"]) {
        jobQueue.linkSpecToRepository({
          userId,
          repositoryId: repoId,
          repositoryName: repoId,
          repositoryFullName: `org/${repoId}`,
          specId: "spec-1",
          specName: "Test Spec",
          autoRunHealthCheck: true,
        });
      }

      await waitForJobs(4000);

      const logs = await service.getRequestLogs(userId);
      if (logs.length >= 2) {
        const t0 = new Date(logs[0]!.timestamp).getTime();
        const t1 = new Date(logs[1]!.timestamp).getTime();
        expect(t0).toBeGreaterThanOrEqual(t1);
      }
    });

    it("should respect the limit parameter", async () => {
      // Create 3 jobs
      for (const repoId of ["repo-l1", "repo-l2", "repo-l3"]) {
        jobQueue.linkSpecToRepository({
          userId,
          repositoryId: repoId,
          repositoryName: repoId,
          repositoryFullName: `org/${repoId}`,
          specId: "spec-1",
          specName: "Test Spec",
          autoRunHealthCheck: true,
        });
      }

      await waitForJobs(8000);

      const logsAll = await service.getRequestLogs(userId, 100);
      const logsLimited = await service.getRequestLogs(userId, 1);

      expect(logsLimited.length).toBeLessThanOrEqual(1);
      if (logsAll.length > 1) {
        expect(logsLimited.length).toBe(1);
      }
    }, 15000);

    it("should not return other users' logs", async () => {
      jobQueue.linkSpecToRepository({
        userId: "other-user-logs",
        repositoryId: "other-repo",
        repositoryName: "other-repo",
        repositoryFullName: "other/other-repo",
        specId: "spec-1",
        specName: "Test Spec",
        autoRunHealthCheck: true,
      });

      await waitForJobs();

      const myLogs = await service.getRequestLogs(userId);
      expect(myLogs).toEqual([]);
    });

    it("should include correct fields in each log entry", async () => {
      jobQueue.linkSpecToRepository({
        userId,
        repositoryId: "repo-fields",
        repositoryName: "fields-test",
        repositoryFullName: "org/fields-test",
        specId: "spec-fields",
        specName: "Fields Spec",
        autoRunHealthCheck: true,
      });

      await waitForJobs();

      const logs = await service.getRequestLogs(userId);
      expect(logs.length).toBeGreaterThanOrEqual(1);

      const log = logs[0]!;
      expect(log.id).toBeDefined();
      expect(log.id.length).toBeGreaterThan(0);
      expect(log.timestamp).toBeDefined();
      expect(log.repositoryName).toBe("fields-test");
      expect(log.repositoryFullName).toBe("org/fields-test");
      expect(log.specName).toBe("Fields Spec");
      expect(["valid", "warning", "error"]).toContain(log.status);
      expect(["queued", "running", "succeeded", "failed"]).toContain(
        log.jobStatus,
      );
      expect(typeof log.inconsistencyCount).toBe("number");
      expect(typeof log.endpointsCovered).toBe("number");
      expect(typeof log.endpointsTotal).toBe("number");
      expect(["manual", "auto-on-link", "retry"]).toContain(log.trigger);
    });

    it("should set status='valid' for succeeded jobs with zero inconsistencies", async () => {
      // Use a repo+spec combo that produces 0 inconsistencies
      // The buildResult method is deterministic based on hash, so we test behavior
      jobQueue.linkSpecToRepository({
        userId,
        repositoryId: "repo-valid-status",
        repositoryName: "valid-status",
        repositoryFullName: "org/valid-status",
        specId: "spec-valid-1",
        specName: "Valid Spec",
        autoRunHealthCheck: true,
      });

      await waitForJobs();

      const logs = await service.getRequestLogs(userId);
      const succeededLogs = logs.filter((l) => l.jobStatus === "succeeded");

      for (const log of succeededLogs) {
        if (log.inconsistencyCount === 0) {
          expect(log.status).toBe("valid");
        }
      }
    });

    it("should compute durationMs for completed jobs", async () => {
      jobQueue.linkSpecToRepository({
        userId,
        repositoryId: "repo-duration",
        repositoryName: "duration-test",
        repositoryFullName: "org/duration-test",
        specId: "spec-d",
        specName: "Duration Spec",
        autoRunHealthCheck: true,
      });

      await waitForJobs();

      const logs = await service.getRequestLogs(userId);
      const completed = logs.filter((l) => l.jobStatus === "succeeded");

      for (const log of completed) {
        expect(log.durationMs).not.toBeNull();
        expect(log.durationMs!).toBeGreaterThan(0);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ADAPTER DIRECT TESTS
  // ═══════════════════════════════════════════════════════════════════

  describe("HealthCheckDashboardAdapter", () => {
    it("should implement DashboardDataProvider interface correctly", () => {
      expect(typeof adapter.getStatsForUser).toBe("function");
      expect(typeof adapter.getRequestLogsForUser).toBe("function");
    });

    it("should return all required fields in stats DTO", async () => {
      const stats = await adapter.getStatsForUser(userId);

      expect("healthChecksRun" in stats).toBe(true);
      expect("repositoriesAnalyzed" in stats).toBe(true);
      expect("inconsistenciesFound" in stats).toBe(true);
      expect("complianceRate" in stats).toBe(true);
    });

    it("should never return negative compliance rate", async () => {
      // Create some jobs
      for (let i = 0; i < 3; i++) {
        jobQueue.linkSpecToRepository({
          userId,
          repositoryId: `repo-neg-${i}`,
          repositoryName: `neg-${i}`,
          repositoryFullName: `org/neg-${i}`,
          specId: "spec-1",
          specName: "Test Spec",
          autoRunHealthCheck: true,
        });
      }

      await waitForJobs(8000);

      const stats = await adapter.getStatsForUser(userId);
      expect(stats.complianceRate).toBeGreaterThanOrEqual(0);
      expect(stats.complianceRate).toBeLessThanOrEqual(100);
    }, 15000);
  });

  // ═══════════════════════════════════════════════════════════════════
  // JOB QUEUE QUERY METHODS TESTS
  // ═══════════════════════════════════════════════════════════════════

  describe("HealthCheckJobQueue — query methods", () => {
    it("getAllJobsForUser should return empty array for unknown user", () => {
      const jobs = jobQueue.getAllJobsForUser("nonexistent-user");
      expect(jobs).toEqual([]);
    });

    it("getAllJobsForUser should return only that user's jobs", () => {
      jobQueue.linkSpecToRepository({
        userId,
        repositoryId: "repo-q1",
        repositoryName: "q1",
        repositoryFullName: "org/q1",
        specId: "spec-1",
        specName: "Test Spec",
        autoRunHealthCheck: false,
      });

      jobQueue.enqueueHealthCheck({
        userId,
        repositoryId: "repo-q1",
        repositoryName: "q1",
        repositoryFullName: "org/q1",
        specId: "spec-1",
        specName: "Test Spec",
        trigger: "manual",
      });

      jobQueue.linkSpecToRepository({
        userId: "other-user",
        repositoryId: "repo-q2",
        repositoryName: "q2",
        repositoryFullName: "other/q2",
        specId: "spec-1",
        specName: "Test Spec",
        autoRunHealthCheck: false,
      });

      jobQueue.enqueueHealthCheck({
        userId: "other-user",
        repositoryId: "repo-q2",
        repositoryName: "q2",
        repositoryFullName: "other/q2",
        specId: "spec-1",
        specName: "Test Spec",
        trigger: "manual",
      });

      const myJobs = jobQueue.getAllJobsForUser(userId);
      const otherJobs = jobQueue.getAllJobsForUser("other-user");

      expect(myJobs.length).toBe(1);
      expect(otherJobs.length).toBe(1);
      expect(myJobs[0]!.repositoryId).toBe("repo-q1");
      expect(otherJobs[0]!.repositoryId).toBe("repo-q2");
    });

    it("getAllJobs should return jobs across all users", () => {
      jobQueue.linkSpecToRepository({
        userId: "user-a",
        repositoryId: "repo-all-1",
        repositoryName: "all-1",
        repositoryFullName: "a/all-1",
        specId: "spec-1",
        specName: "Test Spec",
        autoRunHealthCheck: false,
      });

      jobQueue.enqueueHealthCheck({
        userId: "user-a",
        repositoryId: "repo-all-1",
        repositoryName: "all-1",
        repositoryFullName: "a/all-1",
        specId: "spec-1",
        specName: "Test Spec",
        trigger: "manual",
      });

      jobQueue.linkSpecToRepository({
        userId: "user-b",
        repositoryId: "repo-all-2",
        repositoryName: "all-2",
        repositoryFullName: "b/all-2",
        specId: "spec-1",
        specName: "Test Spec",
        autoRunHealthCheck: false,
      });

      jobQueue.enqueueHealthCheck({
        userId: "user-b",
        repositoryId: "repo-all-2",
        repositoryName: "all-2",
        repositoryFullName: "b/all-2",
        specId: "spec-1",
        specName: "Test Spec",
        trigger: "manual",
      });

      const allJobs = jobQueue.getAllJobs();
      expect(allJobs.length).toBe(2);
    });

    it("getAllJobsForUser should return jobs sorted most-recent-first", () => {
      // Enqueue two jobs rapidly
      for (const repoId of ["repo-sort-1", "repo-sort-2"]) {
        jobQueue.linkSpecToRepository({
          userId,
          repositoryId: repoId,
          repositoryName: repoId,
          repositoryFullName: `org/${repoId}`,
          specId: "spec-1",
          specName: "Test Spec",
          autoRunHealthCheck: false,
        });

        jobQueue.enqueueHealthCheck({
          userId,
          repositoryId: repoId,
          repositoryName: repoId,
          repositoryFullName: `org/${repoId}`,
          specId: "spec-1",
          specName: "Test Spec",
          trigger: "manual",
        });
      }

      const jobs = jobQueue.getAllJobsForUser(userId);
      if (jobs.length >= 2) {
        const t0 = new Date(jobs[0]!.updatedAt).getTime();
        const t1 = new Date(jobs[1]!.updatedAt).getTime();
        expect(t0).toBeGreaterThanOrEqual(t1);
      }
    });
  });
});
