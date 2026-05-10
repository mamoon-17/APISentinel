import { Request, Response } from "express";
import { AnalysisService } from "../../../application/analysis";
import { UserRepository } from "../../../domain/user";
import { configService } from "../../../shared/config/config.service";
import { verifySessionToken } from "../../../shared/auth/session-token";
import { AppError } from "../../../shared/errors/app-error";
import { GithubRepositoryCodeProvider } from "../../analysis/github-repository-code.provider";
import { HealthCheckJobQueue } from "../../health/health-check-job-queue";
import type { RepositoryInconsistenciesView } from "../../../application/analysis/analysis.service";
import type {
  AnalysisResultRepository,
  SavedAnalysisMode,
  SavedAnalysisPayload,
  SavedAnalysisVariant,
} from "../../../application/analysis/contracts/analysis-result.repository";

const SESSION_COOKIE_NAME = "api_sentinel_session";

interface AnalysisStateQuery {
  mode?: string;
  specId?: string;
}

export class RepositoryAnalysisController {
  constructor(
    private readonly analysisService: AnalysisService,
    private readonly userRepository: UserRepository,
    private readonly jobQueue?: HealthCheckJobQueue,
    private readonly analysisResultRepository?: AnalysisResultRepository,
  ) {}

  getInconsistencies = async (
    req: Request<
      { id: string },
      unknown,
      unknown,
      { specId?: string; repositoryFullName?: string }
    >,
    res: Response,
  ): Promise<void> => {
    const repositoryId = req.params.id;
    const specId =
      typeof req.query.specId === "string" && req.query.specId.length > 0
        ? req.query.specId
        : undefined;

    const repositoryFullName =
      typeof req.query.repositoryFullName === "string" &&
      req.query.repositoryFullName.length > 0
        ? req.query.repositoryFullName
        : repositoryId;

    const sessionToken =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    const sessionUser =
      sessionToken &&
      verifySessionToken(sessionToken, configService.getSessionSecret());

    if (!sessionUser) {
      res.status(401).json({
        code: "UNAUTHORIZED",
        message: "No active session",
      });
      return;
    }

    const userResult = await this.userRepository.findById(sessionUser.id);
    if (userResult.isErr() || !userResult.value) {
      res.status(401).json({
        code: "UNAUTHORIZED",
        message: "Unable to resolve session user",
      });
      return;
    }

    const githubAccessToken = userResult.value.githubAccessToken || undefined;
    if (!githubAccessToken) {
      res.status(409).json({
        code: "GITHUB_NOT_LINKED",
        message: "Connect GitHub before running repository analysis",
      });
      return;
    }

    const result = await this.analysisService.getRepositoryInconsistencies({
      repositoryId,
      specId,
      githubAccessToken,
    });

    result.match(
      (payload) => {
        void this.persistAnalysisResult({
          userId: sessionUser.id,
          repositoryId,
          repositoryFullName,
          analysisMode: specId ? "backend-spec" : "frontend-backend",
          resultVariant: "static",
          specId,
          payload,
        });
        if (!specId) {
          void this.deleteSavedAnalysisResult({
            userId: sessionUser.id,
            repositoryId,
            analysisMode: "frontend-backend",
            resultVariant: "ai",
          });
        }
        // Record this run in the job queue so the dashboard shows real activity.
        this.recordCompletedAnalysis({
          userId: sessionUser.id,
          repositoryId,
          repositoryFullName,
          specId: specId ?? "",
          specName: specId ? "Linked Spec" : "",
          payload,
        });
        res.json(payload);
      },
      (error: AppError) => {
        if (
          error.code === "REPOSITORY_SNAPSHOT_NOT_FOUND" ||
          error.code === "SPEC_VERSION_NOT_FOUND"
        ) {
          res.status(404).json(error.toJSON());
          return;
        }

        if (error.code === "SPEC_VERSION_NOT_ANALYZABLE") {
          res.status(400).json(error.toJSON());
          return;
        }

        if (error.code === "GITHUB_RATE_LIMITED") {
          res.status(429).json(error.toJSON());
          return;
        }

        if (error.code === "GITHUB_AUTH_REQUIRED") {
          res.status(401).json(error.toJSON());
          return;
        }

        if (error.code === "GITHUB_FETCH_FAILED") {
          res.status(502).json(error.toJSON());
          return;
        }

        if (error.code === "SPEC_SELECTION_REQUIRED") {
          res.status(400).json(error.toJSON());
          return;
        }

        if (error.code === "REPOSITORY_SNAPSHOT_EMPTY") {
          res.status(400).json(error.toJSON());
          return;
        }

        res.status(500).json(error.toJSON());
      },
    );
  };

  /**
   * Records a completed analysis run as a synthetic job in the HealthCheckJobQueue
   * so the dashboard displays real health-check history and stats.
   */
  private recordCompletedAnalysis(input: {
    userId: string;
    repositoryId: string;
    repositoryFullName: string;
    specId: string;
    specName: string;
    payload: RepositoryInconsistenciesView;
  }): void {
    if (!this.jobQueue) return;

    const now = new Date().toISOString();
    const startedAt = new Date(Date.now() - 3000).toISOString();
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Map inconsistencies to the job queue format
    const inconsistencies = (input.payload.inconsistencies ?? []).map(
      (inc: any, i: number) => ({
        id: `inc_${i}_${Date.now()}`,
        type: (inc.type ?? "schema_mismatch") as
          | "missing_endpoint"
          | "extra_endpoint"
          | "method_mismatch"
          | "schema_mismatch",
        endpoint: inc.endpoint,
        method: (inc.method ?? "GET") as
          | "GET"
          | "POST"
          | "PUT"
          | "PATCH"
          | "DELETE",
        message: inc.message ?? inc.type,
        severity: (inc.severity ?? "warning") as "warning" | "error",
      }),
    );

    // Map endpoint usage to the job queue format
    const endpointUsage = (input.payload.endpointUsage ?? []).map(
      (ep: any) => ({
        endpoint: ep.endpoint,
        method: ep.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        callCount: ep.callCount ?? 0,
        lastCalledAt: ep.lastCalledAt ?? now,
        inSpec: ep.inSpec ?? true,
      }),
    );

    // Directly inject a completed job into the queue's internal map via the
    // public recordCompletedJob method (we'll add that method below).
    this.jobQueue.recordCompletedJob({
      id: jobId,
      userId: input.userId,
      repositoryId: input.repositoryId,
      repositoryName: input.repositoryId.split("/").pop() ?? input.repositoryId,
      repositoryFullName: input.repositoryFullName,
      specId: input.specId || "frontend-backend",
      specName: input.specName || "Frontend ↔ Backend",
      trigger: "manual" as const,
      status: "succeeded" as const,
      attempts: 1,
      maxAttempts: 1,
      createdAt: startedAt,
      updatedAt: now,
      startedAt,
      finishedAt: now,
      result: {
        repositoryId: input.repositoryId,
        specId: input.specId || "frontend-backend",
        specName: input.specName || "Frontend ↔ Backend",
        checkedAt: now,
        totalApiCalls: endpointUsage.reduce(
          (s: number, e: any) => s + e.callCount,
          0,
        ),
        endpointUsage,
        inconsistencies,
        healthy: inconsistencies.length === 0,
      },
    });
  }

  getLlmFrontendBackendViolations = async (
    req: Request<{ id: string }>,
    res: Response,
  ): Promise<void> => {
    const repositoryId = req.params.id;

    const sessionToken =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    const sessionUser =
      sessionToken &&
      verifySessionToken(sessionToken, configService.getSessionSecret());

    if (!sessionUser) {
      res
        .status(401)
        .json({ code: "UNAUTHORIZED", message: "No active session" });
      return;
    }

    const userResult = await this.userRepository.findById(sessionUser.id);
    if (userResult.isErr() || !userResult.value) {
      res
        .status(401)
        .json({
          code: "UNAUTHORIZED",
          message: "Unable to resolve session user",
        });
      return;
    }

    const githubAccessToken = userResult.value.githubAccessToken || undefined;
    if (!githubAccessToken) {
      res.status(409).json({
        code: "GITHUB_NOT_LINKED",
        message: "Connect GitHub before running AI analysis",
      });
      return;
    }

    // Fetch repo files for the LLM to inspect.
    const codeProvider = new GithubRepositoryCodeProvider();
    const filesResult = await codeProvider.fetchFiles(
      repositoryId,
      githubAccessToken,
    );
    if (filesResult.isErr()) {
      const error = filesResult.error;
      const statusMap: Record<string, number> = {
        GITHUB_RATE_LIMITED: 429,
        GITHUB_AUTH_REQUIRED: 401,
        GITHUB_FETCH_FAILED: 502,
      };
      res.status(statusMap[error.code] ?? 500).json(error.toJSON());
      return;
    }

    const result = await this.analysisService.getLlmFrontendBackendViolations({
      repositoryId,
      files: filesResult.value,
      githubToken: githubAccessToken,
    });

    result.match(
      (payload) => {
        void this.persistAnalysisResult({
          userId: sessionUser.id,
          repositoryId,
          analysisMode: "frontend-backend",
          resultVariant: "ai",
          payload,
        });
        res.json(payload);
      },
      (error: AppError) => {
        const statusMap: Record<string, number> = {
          REPOSITORY_SNAPSHOT_NOT_FOUND: 404,
          REPOSITORY_SNAPSHOT_EMPTY: 400,
          GITHUB_RATE_LIMITED: 429,
          GITHUB_AUTH_REQUIRED: 401,
          GITHUB_FETCH_FAILED: 502,
          LLM_NOT_CONFIGURED: 503,
        };
        res.status(statusMap[error.code] ?? 500).json(error.toJSON());
      },
    );
  };

  getAnalysisState = async (
    req: Request<{ id: string }, unknown, unknown, AnalysisStateQuery>,
    res: Response,
  ): Promise<void> => {
    const repositoryId = req.params.id;
    const sessionToken =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    const sessionUser =
      sessionToken &&
      verifySessionToken(sessionToken, configService.getSessionSecret());

    if (!sessionUser) {
      res
        .status(401)
        .json({ code: "UNAUTHORIZED", message: "No active session" });
      return;
    }

    const analysisMode = normalizeAnalysisMode(req.query.mode);
    if (!analysisMode) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "mode must be 'frontend-backend' or 'backend-spec'",
      });
      return;
    }

    const specId =
      typeof req.query.specId === "string" && req.query.specId.trim().length > 0
        ? req.query.specId.trim()
        : undefined;

    const staticResult = await this.analysisResultRepository?.findLatest({
      userId: sessionUser.id,
      repositoryId,
      analysisMode,
      resultVariant: "static",
      specId,
    });
    if (staticResult?.isErr()) {
      res.status(500).json(staticResult.error.toJSON());
      return;
    }

    const aiResult = await this.analysisResultRepository?.findLatest({
      userId: sessionUser.id,
      repositoryId,
      analysisMode,
      resultVariant: "ai",
      specId: analysisMode === "backend-spec" ? specId : undefined,
    });
    if (aiResult?.isErr()) {
      res.status(500).json(aiResult.error.toJSON());
      return;
    }

    res.json({
      staticResult:
        staticResult && staticResult.isOk()
          ? (staticResult.value?.payload ?? null)
          : null,
      aiResult:
        aiResult && aiResult.isOk() ? (aiResult.value?.payload ?? null) : null,
    });
  };

  private persistAnalysisResult(input: {
    userId: string;
    repositoryId: string;
    repositoryFullName?: string;
    analysisMode: SavedAnalysisMode;
    resultVariant: SavedAnalysisVariant;
    specId?: string;
    payload: RepositoryInconsistenciesView;
  }): void {
    if (!this.analysisResultRepository) return;

    const payload: SavedAnalysisPayload = {
      repositoryId: input.payload.repositoryId,
      specId: input.payload.specId,
      analyzedAt: input.payload.analyzedAt,
      totalApiCalls: input.payload.totalApiCalls,
      endpointUsage: input.payload.endpointUsage,
      inconsistencies: input.payload.inconsistencies,
    };

    void this.analysisResultRepository.save({
      id: "",
      userId: input.userId,
      repositoryId: input.repositoryId,
      repositoryFullName: input.repositoryFullName,
      analysisMode: input.analysisMode,
      resultVariant: input.resultVariant,
      specId: input.specId,
      analyzedAt: new Date(input.payload.analyzedAt),
      payload,
    });
  }

  private deleteSavedAnalysisResult(input: {
    userId: string;
    repositoryId: string;
    analysisMode: SavedAnalysisMode;
    resultVariant: SavedAnalysisVariant;
    specId?: string;
  }): void {
    if (!this.analysisResultRepository) return;
    void this.analysisResultRepository.deleteMatching(input);
  }
}

function normalizeAnalysisMode(mode?: string): SavedAnalysisMode | null {
  if (mode === "frontend-backend" || mode === "backend-spec") {
    return mode;
  }
  return null;
}
