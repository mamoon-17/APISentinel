import { Request, Response } from "express";
import { configService } from "../../../shared/config/config.service";
import {
  AuthUser,
  verifySessionToken,
} from "../../../shared/auth/session-token";
import { HealthCheckJobQueue } from "../../health/health-check-job-queue";

interface CreateHealthCheckJobBody {
  repositoryId?: string;
  repositoryName?: string;
  repositoryFullName?: string;
  specId?: string;
  specName?: string;
}

interface LinkRepositorySpecBody {
  repositoryName?: string;
  repositoryFullName?: string;
  specId?: string;
  specName?: string;
  autoRunHealthCheck?: boolean;
}

const SESSION_COOKIE_NAME = "api_sentinel_session";

export class HealthCheckController {
  constructor(private readonly jobQueue: HealthCheckJobQueue) {}

  createJob = async (
    req: Request<Record<string, string>, unknown, CreateHealthCheckJobBody>,
    res: Response,
  ): Promise<void> => {
    const sessionUser = this.readSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const repositoryId = (req.body.repositoryId ?? "").trim();
    if (!repositoryId) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "repositoryId is required",
      });
      return;
    }

    const repositoryName =
      req.body.repositoryName?.trim() || repositoryId.slice(0, 32);
    const repositoryFullName =
      req.body.repositoryFullName?.trim() || repositoryName;

    const queued = this.jobQueue.enqueueHealthCheck({
      userId: sessionUser.id,
      repositoryId,
      repositoryName,
      repositoryFullName,
      specId: req.body.specId?.trim(),
      specName: req.body.specName?.trim(),
      trigger: "manual",
    });

    if (!queued.ok) {
      this.respondQueueError(res, queued.error.code, queued.error.message);
      return;
    }

    res.status(202).json({
      job: queued.value.job,
      deduped: queued.value.deduped,
    });
  };

  getJobStatus = async (
    req: Request<{ jobId: string }>,
    res: Response,
  ): Promise<void> => {
    const sessionUser = this.readSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const job = this.jobQueue.getJobForUser(sessionUser.id, req.params.jobId);
    if (!job.ok) {
      this.respondQueueError(res, job.error.code, job.error.message);
      return;
    }

    res.json({ job: job.value });
  };

  retryJob = async (
    req: Request<{ jobId: string }>,
    res: Response,
  ): Promise<void> => {
    const sessionUser = this.readSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const retryResult = this.jobQueue.retryFailedJob(
      sessionUser.id,
      req.params.jobId,
    );

    if (!retryResult.ok) {
      this.respondQueueError(
        res,
        retryResult.error.code,
        retryResult.error.message,
      );
      return;
    }

    res.status(202).json({
      job: retryResult.value.job,
      deduped: retryResult.value.deduped,
    });
  };

  linkSpec = async (
    req: Request<{ repositoryId: string }, unknown, LinkRepositorySpecBody>,
    res: Response,
  ): Promise<void> => {
    const sessionUser = this.readSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const repositoryId = req.params.repositoryId.trim();
    if (!repositoryId) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "repositoryId is required",
      });
      return;
    }

    const specId = (req.body.specId ?? "").trim();
    const specName = (req.body.specName ?? "").trim();

    const linked = this.jobQueue.linkSpecToRepository({
      userId: sessionUser.id,
      repositoryId,
      repositoryName:
        req.body.repositoryName?.trim() || repositoryId.slice(0, 32),
      repositoryFullName:
        req.body.repositoryFullName?.trim() ||
        req.body.repositoryName?.trim() ||
        repositoryId,
      specId,
      specName,
      autoRunHealthCheck: req.body.autoRunHealthCheck === true,
    });

    if (!linked.ok) {
      this.respondQueueError(res, linked.error.code, linked.error.message);
      return;
    }

    res.json({
      link: linked.value.link,
      job: linked.value.job,
    });
  };

  getRepositoryState = async (
    req: Request<{ repositoryId: string }>,
    res: Response,
  ): Promise<void> => {
    const sessionUser = this.readSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const repositoryId = req.params.repositoryId.trim();
    if (!repositoryId) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "repositoryId is required",
      });
      return;
    }

    const state = this.jobQueue.getRepositoryState(
      sessionUser.id,
      repositoryId,
    );
    res.json(state);
  };

  private readSessionUser(req: Request): AuthUser | null {
    const token =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    if (!token) {
      return null;
    }
    return verifySessionToken(token, configService.getSessionSecret());
  }

  private respondQueueError(
    res: Response,
    code: string,
    message: string,
  ): void {
    switch (code) {
      case "VALIDATION_ERROR":
      case "SPEC_NOT_LINKED":
        res.status(400).json({ code, message });
        return;
      case "JOB_NOT_FOUND":
        res.status(404).json({ code, message });
        return;
      case "JOB_NOT_RETRYABLE":
        res.status(409).json({ code, message });
        return;
      default:
        res.status(500).json({ code: "UNKNOWN_ERROR", message });
    }
  }
}
