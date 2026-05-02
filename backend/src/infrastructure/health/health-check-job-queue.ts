export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobTrigger = "manual" | "auto-on-link" | "retry";

export interface HealthCheckEndpointUsage {
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  callCount: number;
  lastCalledAt: string;
  inSpec: boolean;
}

export interface HealthCheckInconsistency {
  id: string;
  type:
    | "missing_endpoint"
    | "extra_endpoint"
    | "method_mismatch"
    | "schema_mismatch";
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  message: string;
  severity: "warning" | "error";
}

export interface HealthCheckResult {
  repositoryId: string;
  specId: string;
  specName: string;
  checkedAt: string;
  totalApiCalls: number;
  endpointUsage: HealthCheckEndpointUsage[];
  inconsistencies: HealthCheckInconsistency[];
  healthy: boolean;
}

export interface HealthCheckJob {
  id: string;
  userId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  specId: string;
  specName: string;
  trigger: JobTrigger;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  nextRetryAt?: string;
  errorMessage?: string;
  result?: HealthCheckResult;
  retryOfJobId?: string;
}

export interface RepositorySpecLink {
  userId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  specId: string;
  specName: string;
  linkedAt: string;
}

interface QueueError {
  code:
    | "VALIDATION_ERROR"
    | "SPEC_NOT_LINKED"
    | "JOB_NOT_FOUND"
    | "JOB_NOT_RETRYABLE";
  message: string;
}

type QueueResult<T> = { ok: true; value: T } | { ok: false; error: QueueError };

export interface EnqueueHealthCheckInput {
  userId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  specId?: string;
  specName?: string;
  trigger: JobTrigger;
  maxAttempts?: number;
  retryOfJobId?: string;
}

export interface LinkSpecToRepositoryInput {
  userId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  specId: string;
  specName: string;
  autoRunHealthCheck: boolean;
}

interface JobQueueSnapshot {
  job: HealthCheckJob;
  deduped: boolean;
}

interface RepositoryState {
  link: RepositorySpecLink | null;
  latestJob: HealthCheckJob | null;
  latestResult: HealthCheckResult | null;
}

export class HealthCheckJobQueue {
  private readonly jobs = new Map<string, HealthCheckJob>();

  private readonly pendingJobIds: string[] = [];

  private readonly repositoryLinks = new Map<string, RepositorySpecLink>();

  private readonly latestResultByRepository = new Map<
    string,
    HealthCheckResult
  >();

  private readonly latestJobIdByRepository = new Map<string, string>();

  private processing = false;

  enqueueHealthCheck(
    input: EnqueueHealthCheckInput,
  ): QueueResult<JobQueueSnapshot> {
    if (!input.repositoryId.trim()) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "repositoryId is required",
        },
      };
    }

    const repositoryKey = this.repositoryKey(input.userId, input.repositoryId);
    const linkedSpec = this.repositoryLinks.get(repositoryKey);

    const specId = input.specId?.trim() || linkedSpec?.specId;
    const specName = input.specName?.trim() || linkedSpec?.specName;

    if (!specId || !specName) {
      return {
        ok: false,
        error: {
          code: "SPEC_NOT_LINKED",
          message:
            "Link a specification before running a repository health check.",
        },
      };
    }

    const activeJob = this.findActiveJob(
      input.userId,
      input.repositoryId,
      specId,
    );
    if (activeJob) {
      return {
        ok: true,
        value: {
          job: this.clone(activeJob),
          deduped: true,
        },
      };
    }

    const timestamp = this.now();
    const job: HealthCheckJob = {
      id: this.generateId("job"),
      userId: input.userId,
      repositoryId: input.repositoryId,
      repositoryName: input.repositoryName,
      repositoryFullName: input.repositoryFullName,
      specId,
      specName,
      trigger: input.trigger,
      status: "queued",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      createdAt: timestamp,
      updatedAt: timestamp,
      retryOfJobId: input.retryOfJobId,
    };

    this.jobs.set(job.id, job);
    this.pendingJobIds.push(job.id);
    this.latestJobIdByRepository.set(repositoryKey, job.id);
    this.scheduleProcessing();

    return {
      ok: true,
      value: {
        job: this.clone(job),
        deduped: false,
      },
    };
  }

  linkSpecToRepository(
    input: LinkSpecToRepositoryInput,
  ): QueueResult<{ link: RepositorySpecLink; job: HealthCheckJob | null }> {
    if (!input.specId.trim() || !input.specName.trim()) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "specId and specName are required",
        },
      };
    }

    const link: RepositorySpecLink = {
      userId: input.userId,
      repositoryId: input.repositoryId,
      repositoryName: input.repositoryName,
      repositoryFullName: input.repositoryFullName,
      specId: input.specId,
      specName: input.specName,
      linkedAt: this.now(),
    };

    this.repositoryLinks.set(
      this.repositoryKey(input.userId, input.repositoryId),
      link,
    );

    if (!input.autoRunHealthCheck) {
      return {
        ok: true,
        value: {
          link: this.clone(link),
          job: null,
        },
      };
    }

    const queued = this.enqueueHealthCheck({
      userId: input.userId,
      repositoryId: input.repositoryId,
      repositoryName: input.repositoryName,
      repositoryFullName: input.repositoryFullName,
      specId: input.specId,
      specName: input.specName,
      trigger: "auto-on-link",
    });

    if (!queued.ok) {
      return queued;
    }

    return {
      ok: true,
      value: {
        link: this.clone(link),
        job: queued.value.job,
      },
    };
  }

  getJobForUser(userId: string, jobId: string): QueueResult<HealthCheckJob> {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return {
        ok: false,
        error: {
          code: "JOB_NOT_FOUND",
          message: "Job not found",
        },
      };
    }

    return {
      ok: true,
      value: this.clone(job),
    };
  }

  retryFailedJob(userId: string, jobId: string): QueueResult<JobQueueSnapshot> {
    const originalJob = this.jobs.get(jobId);
    if (!originalJob || originalJob.userId !== userId) {
      return {
        ok: false,
        error: {
          code: "JOB_NOT_FOUND",
          message: "Job not found",
        },
      };
    }

    if (originalJob.status !== "failed") {
      return {
        ok: false,
        error: {
          code: "JOB_NOT_RETRYABLE",
          message: "Only failed jobs can be retried",
        },
      };
    }

    return this.enqueueHealthCheck({
      userId: originalJob.userId,
      repositoryId: originalJob.repositoryId,
      repositoryName: originalJob.repositoryName,
      repositoryFullName: originalJob.repositoryFullName,
      specId: originalJob.specId,
      specName: originalJob.specName,
      trigger: "retry",
      maxAttempts: originalJob.maxAttempts,
      retryOfJobId: originalJob.id,
    });
  }

  getRepositoryState(userId: string, repositoryId: string): RepositoryState {
    const key = this.repositoryKey(userId, repositoryId);
    const link = this.repositoryLinks.get(key) ?? null;
    const latestResult = this.latestResultByRepository.get(key) ?? null;

    const latestJobId = this.latestJobIdByRepository.get(key);
    const latestJob = latestJobId ? (this.jobs.get(latestJobId) ?? null) : null;

    return {
      link: link ? this.clone(link) : null,
      latestJob: latestJob ? this.clone(latestJob) : null,
      latestResult: latestResult ? this.clone(latestResult) : null,
    };
  }

  /**
   * Returns all jobs for a given user, sorted most-recent-first.
   * Used by the dashboard to build request-log and stats views.
   */
  getAllJobsForUser(userId: string): HealthCheckJob[] {
    const result: HealthCheckJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.userId === userId) {
        result.push(this.clone(job));
      }
    }
    return result.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  /**
   * Returns all jobs across all users, sorted most-recent-first.
   * Used for admin / aggregate dashboard views.
   */
  getAllJobs(): HealthCheckJob[] {
    const result: HealthCheckJob[] = [];
    for (const job of this.jobs.values()) {
      result.push(this.clone(job));
    }
    return result.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  private scheduleProcessing(): void {
    if (this.processing) {
      return;
    }

    setTimeout(() => {
      void this.processQueue();
    }, 0);
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.pendingJobIds.length > 0) {
        const nextJobId = this.pendingJobIds.shift();
        if (!nextJobId) {
          continue;
        }

        const job = this.jobs.get(nextJobId);
        if (!job || job.status !== "queued") {
          continue;
        }

        await this.runJob(job);
      }
    } finally {
      this.processing = false;
      if (this.pendingJobIds.length > 0) {
        this.scheduleProcessing();
      }
    }
  }

  private async runJob(job: HealthCheckJob): Promise<void> {
    const startTime = this.now();
    job.status = "running";
    job.attempts += 1;
    job.startedAt = job.startedAt ?? startTime;
    job.updatedAt = startTime;
    job.errorMessage = undefined;
    job.nextRetryAt = undefined;

    try {
      await this.delay(1200);

      if (this.shouldFailFirstAttempt(job)) {
        throw new Error("Transient scanner initialization failure");
      }

      const result = this.buildResult(job);
      const finishTime = this.now();

      job.result = result;
      job.status = "succeeded";
      job.finishedAt = finishTime;
      job.updatedAt = finishTime;

      const key = this.repositoryKey(job.userId, job.repositoryId);
      this.latestResultByRepository.set(key, result);
      this.latestJobIdByRepository.set(key, job.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Health check failed";

      if (job.attempts < job.maxAttempts) {
        const retryDelayMs = this.getRetryDelayMs(job.attempts);

        job.status = "queued";
        job.errorMessage = message;
        job.updatedAt = this.now();
        job.nextRetryAt = new Date(Date.now() + retryDelayMs).toISOString();

        setTimeout(() => {
          const queuedJob = this.jobs.get(job.id);
          if (!queuedJob || queuedJob.status !== "queued") {
            return;
          }
          this.pendingJobIds.push(job.id);
          this.scheduleProcessing();
        }, retryDelayMs);

        return;
      }

      const finishTime = this.now();
      job.status = "failed";
      job.errorMessage = message;
      job.finishedAt = finishTime;
      job.updatedAt = finishTime;
      job.nextRetryAt = undefined;

      const key = this.repositoryKey(job.userId, job.repositoryId);
      this.latestJobIdByRepository.set(key, job.id);
    }
  }

  private buildResult(job: HealthCheckJob): HealthCheckResult {
    const seed = this.hash(`${job.repositoryId}:${job.specId}`);
    const totalApiCalls = 1200 + (seed % 7800);

    const methods: Array<"GET" | "POST" | "PUT" | "PATCH" | "DELETE"> = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
    ];

    const endpointUsage: HealthCheckEndpointUsage[] = [
      {
        endpoint: "/api/v1/health",
        method: methods[seed % methods.length] ?? "GET",
        callCount: 120 + (seed % 800),
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
        inSpec: true,
      },
      {
        endpoint: "/api/v1/resources",
        method: methods[(seed + 1) % methods.length] ?? "GET",
        callCount: 80 + ((seed >> 1) % 700),
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
        inSpec: true,
      },
      {
        endpoint: "/api/v1/resources/{id}",
        method: methods[(seed + 2) % methods.length] ?? "GET",
        callCount: 40 + ((seed >> 2) % 500),
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
        inSpec: seed % 3 !== 0,
      },
    ];

    const inconsistencies: HealthCheckInconsistency[] = [];

    if (seed % 2 === 0) {
      inconsistencies.push({
        id: this.generateId("inc"),
        type: "extra_endpoint",
        endpoint: "/api/v1/resources/bulk-sync",
        method: "POST",
        message:
          "Endpoint is used by the repository but is missing from the linked OpenAPI specification.",
        severity: "error",
      });
    }

    if (seed % 5 === 0) {
      inconsistencies.push({
        id: this.generateId("inc"),
        type: "missing_endpoint",
        endpoint: "/api/v1/resources/{id}/restore",
        method: "PATCH",
        message:
          "Endpoint exists in the specification but was not observed in repository traffic traces.",
        severity: "warning",
      });
    }

    return {
      repositoryId: job.repositoryId,
      specId: job.specId,
      specName: job.specName,
      checkedAt: this.now(),
      totalApiCalls,
      endpointUsage,
      inconsistencies,
      healthy: inconsistencies.length === 0,
    };
  }

  private findActiveJob(
    userId: string,
    repositoryId: string,
    specId: string,
  ): HealthCheckJob | null {
    for (const job of this.jobs.values()) {
      if (
        job.userId === userId &&
        job.repositoryId === repositoryId &&
        job.specId === specId &&
        (job.status === "queued" || job.status === "running")
      ) {
        return job;
      }
    }

    return null;
  }

  private shouldFailFirstAttempt(job: HealthCheckJob): boolean {
    return job.attempts === 1 && this.hash(job.repositoryId) % 17 === 0;
  }

  private repositoryKey(userId: string, repositoryId: string): string {
    return `${userId}:${repositoryId}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private getRetryDelayMs(attempts: number): number {
    return attempts * 1000;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private hash(input: string): number {
    let hashValue = 0;
    for (let index = 0; index < input.length; index += 1) {
      hashValue = (hashValue * 31 + input.charCodeAt(index)) >>> 0;
    }
    return hashValue;
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
